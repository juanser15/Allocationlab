import { Router, type IRouter } from "express";
import { WorkbenchServiceV2 } from "../lib/workbench/service-v2";
import { boundaryV2, capabilitiesV2, loadDatasetV2, parseSubmissionV2, planCalendarV2, CalendarContractError } from "../lib/workbench/calendar-v2";
import { safeError } from "./workbench";
import { exposureModelDefinition } from "../lib/workbench/exposure-model-definition";
import { enrichExposureRun } from "../lib/workbench/exposure-attribution";
import { BENCHMARK_METHODOLOGY_VERSION } from "../lib/workbench/exposure-controls";
import { validatedWorkbenchPlan, PREFLIGHT_VERSION } from "../lib/workbench/design-preflight";
import { enrichFailureDiagnostics } from "../lib/workbench/failure-diagnostics";
import { requestFromStored } from "../lib/workbench/service-v2";
import { type NormalizedSpecV2 } from "../lib/workbench/calendar-v2";
import { DEFAULT_STORE_LIMITS } from "../lib/workbench/run-store";

import { RecurringTurnoverService } from "../lib/workbench/turnover-service";
import { PRODUCT_SPEC, productCapabilities, productPlan, requestFromProduct, TOTAL_V1, RECURRING_V2 } from "../lib/workbench/turnover-product";
import { enrichTurnoverEvidence, methodologyOf } from "../lib/workbench/turnover-evidence";
import { enrichRecurringFailures } from "../lib/workbench/turnover-failure";
import { compareTurnoverRuns } from "../lib/workbench/turnover-comparison";

export function createWorkbenchV2Router(): IRouter {
  const router = Router();
  let cached: Promise<WorkbenchServiceV2> | undefined;
  const service = () => cached ??= WorkbenchServiceV2.open();
  let productCached: Promise<RecurringTurnoverService> | undefined;
  const product = () => productCached ??= RecurringTurnoverService.open();
  const isProduct = (body: any) => body?.contract_version === PRODUCT_SPEC;
  const plan = (body: unknown) => isProduct(body) ? productPlan(body) : validatedWorkbenchPlan(parseSubmissionV2(body), loadDatasetV2());
  const forRun = async (id: string) => {
    const api = await service(); const stored = await api.store.getRun(id);
    return isProduct(stored.normalized_spec) ? product() : api;
  };
  router.use("/workbench", (req, res, next) => {
    if (req.path.startsWith("/v1/")) { next(); return; }
    const allowed = req.path === "/compare" ? ["leftRunId", "rightRunId"] : [];
    if (Object.keys(req.query).some(key => !allowed.includes(key))) {
      res.status(400).json({ ...boundaryV2, error: { code: "INVALID_QUERY", message: "Unsupported Workbench query fields." } }); return;
    }
    next();
  });
  router.get("/workbench/capabilities", (req, res) => {
    try { const data = loadDatasetV2(); res.json({ ...productCapabilities(data), benchmark_methodology_version: BENCHMARK_METHODOLOGY_VERSION,
      selection_preflight: { version: "workbench-recurring-necessity-2.0.0", turnover_constraint_methodology_version: RECURRING_V2, necessary_conditions_only: true, candidate_viability_guaranteed: false, financial_backtests_executed: 0 },
      diagnostic_contract_version: "workbench-failure-diagnostic-1.0.0", legacy_turnover_methodology: TOTAL_V1 }); } catch (error) { safeError(req, res, error); }
  });
  router.post("/workbench/plan", (req, res) => {
    res.setHeader("X-Workbench-Turnover-Methodology", isProduct(req.body) ? RECURRING_V2 : TOTAL_V1);
    try { res.json(plan(req.body)); }
    catch (error) { safeError(req, res, error); }
  });
  router.post("/workbench/runs", async (req, res) => {
    try {
      res.setHeader("X-Workbench-Turnover-Methodology", isProduct(req.body) ? RECURRING_V2 : TOTAL_V1);
      plan(req.body);
      const receipt = await (await (isProduct(req.body) ? product() : service())).submit(req.body);
      res.status(receipt.status === "BLOCKED" ? 429 : receipt.execution_requested || ["RUNNING", "PENDING"].includes(receipt.status) ? 202 : 200).json(receipt);
    } catch (error) { safeError(req, res, error); }
  });
  router.get("/workbench/runs", async (req, res) => {
    try { const [old, current] = await Promise.all([(await service()).listRuns(), (await product()).listRuns()]); res.json({ ...current, runs: [...old.runs, ...current.runs].sort((a,b) => b.created_at.localeCompare(a.created_at)) }); } catch (error) { safeError(req, res, error); }
  });
  router.get("/workbench/runs/:runId", async (req, res) => {
    try { const api = await forRun(String(req.params.runId)); let run: any = await api.getRun(String(req.params.runId)); if (!isProduct(run.spec)) run = await enrichFailureDiagnostics(run, api.store); else run = await enrichRecurringFailures(run, api.store); run = await enrichExposureRun(run, api.store); res.json(await enrichTurnoverEvidence(run, api.store, loadDatasetV2())); } catch (error) { safeError(req, res, error); }
  });
  router.post("/workbench/runs/:runId/rerun", async (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length) throw new CalendarContractError("UNEXPECTED_RERUN_FIELDS", "Rerun requires an empty object.");
      const api = await forRun(String(req.params.runId)); const stored = await api.store.getRun(String(req.params.runId));
      if (!["workbench-research-run-spec-2.0.0", PRODUCT_SPEC].includes((stored.normalized_spec as NormalizedSpecV2).contract_version)) throw new CalendarContractError("INVALID_CONTRACT_VERSION", "This run uses another contract version.");
      plan(isProduct(stored.normalized_spec) ? requestFromProduct(stored.normalized_spec as any) : requestFromStored(stored.normalized_spec as NormalizedSpecV2));
      const receipt = await api.rerun(String(req.params.runId));
      res.status(receipt.status === "BLOCKED" ? 429 : 202).json(receipt);
    } catch (error) { safeError(req, res, error); }
  });
  router.get("/workbench/compare", async (req, res) => {
    try {
      if (typeof req.query.leftRunId !== "string" || typeof req.query.rightRunId !== "string") throw new CalendarContractError("INVALID_COMPARE_REQUEST", "Two run identifiers are required.");
      const store = (await service()).store;
      const [left, right] = await Promise.all([store.getRun(req.query.leftRunId), store.getRun(req.query.rightRunId)]);
      res.json(!isProduct(left.normalized_spec) && !isProduct(right.normalized_spec)
        ? await (await service()).compare(req.query.leftRunId, req.query.rightRunId)
        : await compareTurnoverRuns(store, req.query.leftRunId, req.query.rightRunId));
    } catch (error) { safeError(req, res, error); }
  });
  return router;
}
export default createWorkbenchV2Router();
