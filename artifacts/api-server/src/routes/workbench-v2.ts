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

export function createWorkbenchV2Router(): IRouter {
  const router = Router();
  let cached: Promise<WorkbenchServiceV2> | undefined;
  const service = () => cached ??= WorkbenchServiceV2.open();
  router.use("/workbench", (req, res, next) => {
    if (req.path.startsWith("/v1/")) { next(); return; }
    const allowed = req.path === "/compare" ? ["leftRunId", "rightRunId"] : [];
    if (Object.keys(req.query).some(key => !allowed.includes(key))) {
      res.status(400).json({ ...boundaryV2, error: { code: "INVALID_QUERY", message: "Unsupported Workbench query fields." } }); return;
    }
    next();
  });
  router.get("/workbench/capabilities", (req, res) => {
    try { const data = loadDatasetV2(); res.json({ ...capabilitiesV2(data), model_definition: exposureModelDefinition(data), benchmark_methodology_version: BENCHMARK_METHODOLOGY_VERSION,
      selection_preflight: { version: PREFLIGHT_VERSION, necessary_conditions_only: true, candidate_viability_guaranteed: false, financial_backtests_executed: 0 },
      diagnostic_contract_version: "workbench-failure-diagnostic-1.0.0", max_engine_files: DEFAULT_STORE_LIMITS.maxEngineFiles }); } catch (error) { safeError(req, res, error); }
  });
  router.post("/workbench/plan", (req, res) => {
    try { res.json(validatedWorkbenchPlan(parseSubmissionV2(req.body), loadDatasetV2())); }
    catch (error) { safeError(req, res, error); }
  });
  router.post("/workbench/runs", async (req, res) => {
    try {
      validatedWorkbenchPlan(parseSubmissionV2(req.body), loadDatasetV2());
      const receipt = await (await service()).submit(req.body);
      res.status(receipt.status === "BLOCKED" ? 429 : receipt.execution_requested || ["RUNNING", "PENDING"].includes(receipt.status) ? 202 : 200).json(receipt);
    } catch (error) { safeError(req, res, error); }
  });
  router.get("/workbench/runs", async (req, res) => {
    try { res.json(await (await service()).listRuns()); } catch (error) { safeError(req, res, error); }
  });
  router.get("/workbench/runs/:runId", async (req, res) => {
    try { const api = await service(); const run = await enrichFailureDiagnostics(await api.getRun(String(req.params.runId)), api.store); res.json(await enrichExposureRun(run, api.store)); } catch (error) { safeError(req, res, error); }
  });
  router.post("/workbench/runs/:runId/rerun", async (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length) throw new CalendarContractError("UNEXPECTED_RERUN_FIELDS", "Rerun requires an empty object.");
      const api = await service(); const stored = await api.store.getRun(String(req.params.runId));
      if ((stored.normalized_spec as NormalizedSpecV2).contract_version !== "workbench-research-run-spec-2.0.0") throw new CalendarContractError("INVALID_CONTRACT_VERSION", "This run uses another contract version.");
      validatedWorkbenchPlan(requestFromStored(stored.normalized_spec as NormalizedSpecV2), loadDatasetV2());
      const receipt = await (await service()).rerun(String(req.params.runId));
      res.status(receipt.status === "BLOCKED" ? 429 : 202).json(receipt);
    } catch (error) { safeError(req, res, error); }
  });
  router.get("/workbench/compare", async (req, res) => {
    try {
      if (typeof req.query.leftRunId !== "string" || typeof req.query.rightRunId !== "string") throw new CalendarContractError("INVALID_COMPARE_REQUEST", "Two run identifiers are required.");
      res.json(await (await service()).compare(req.query.leftRunId, req.query.rightRunId));
    } catch (error) { safeError(req, res, error); }
  });
  return router;
}
export default createWorkbenchV2Router();
