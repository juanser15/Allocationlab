import { canonicalJson } from "./identity";
import { type CapitalExecutionOutcome, executeCapitalResearchAttempt, CapitalExecutionError } from "./execution-adapter";
import { WorkbenchRunStore, WorkbenchRunStoreError, type AttemptRef, type AttemptView } from "./run-store";
import { WorkbenchService, receipt, successfulResult, terminalResult } from "./service";
import {
  ADAPTER_V2, SPEC_V2, boundaryV2, capabilitiesV2, loadDatasetV2, normalizedSpecV2, parseSubmissionV2,
  planCalendarV2, runIdV2, type DatasetV2, type NormalizedSpecV2,
} from "./calendar-v2";

export class WorkbenchServiceV2 {
  private constructor(readonly store: WorkbenchRunStore, private readonly dataset: DatasetV2, private readonly reader: WorkbenchService) {}
  static async open() {
    const dataset = loadDatasetV2();
    const store = await WorkbenchRunStore.open();
    return new WorkbenchServiceV2(store, dataset, await WorkbenchService.open({ store }));
  }
  capabilities() { return capabilitiesV2(this.dataset); }
  plan(value: unknown) { return planCalendarV2(parseSubmissionV2(value), this.dataset); }
  private async v2Run(runId: string) {
    const view = await this.store.getRun(runId);
    if ((view.normalized_spec as NormalizedSpecV2).contract_version !== SPEC_V2) throw new WorkbenchRunStoreError("INVALID_CONTRACT_VERSION", "This run uses the V1 fixture contract; use the explicit V1 API.");
    return view;
  }
  async submit(value: unknown) {
    const spec = normalizedSpecV2(value, this.dataset);
    const runId = runIdV2(spec);
    return this.store.withSubmissionLock(async () => {
      await this.store.ensureRun(runId, spec);
      const view = await this.v2Run(runId);
      const newest = [...view.attempt_history].reverse();
      const reusable = newest.find(a => a.status === "RUNNING" || a.status === "PENDING") ?? newest.find(a => a.status === "SUCCESS") ?? newest[0];
      if (reusable) return receipt(reusable, true, false);
      return this.start(runId, spec, "SUBMIT");
    });
  }
  async rerun(runId: string) {
    return this.store.withSubmissionLock(async () => {
      const view = await this.v2Run(runId);
      const stored = view.normalized_spec as NormalizedSpecV2;
      const spec = normalizedSpecV2(requestFromStored(stored), this.dataset);
      if (runIdV2(spec) !== runId) throw new WorkbenchRunStoreError("RUN_IDENTITY_MISMATCH", "The source or data version changed; submit a new experiment instead of overwriting the old identity.");
      return this.start(runId, stored, "RERUN");
    });
  }
  private async start(runId: string, spec: NormalizedSpecV2, source: "SUBMIT" | "RERUN") {
    const attempt = await this.store.createAttempt(runId, { source });
    const ref = { runId, executionAttemptId: attempt.attempt.execution_attempt_id };
    const lease = await this.store.acquireExecutionLease(ref, 120000);
    if (!lease.acquired) {
      const blocker = { code: "BLOCKED_EXECUTION_CAPACITY", explanation: "One empirical execution is already using the research worker.", active_run_id: lease.lease.run_id, active_execution_attempt_id: lease.lease.execution_attempt_id };
      const base = terminalResult(ref, attempt, "BLOCKED", { blocker }, new Date().toISOString());
      const result = { ...base, contract_version: "workbench-research-run-result-2.0.0",
        provenance: { ...base.provenance, adapter_version: ADAPTER_V2, code_version: spec.code_version, data_snapshot: spec.data_snapshot } };
      const finished = await this.store.completeBlocked(ref, blocker, { result, stage: "EXECUTION_CAPACITY" });
      return receipt(finished, false, false);
    }
    let running: AttemptView;
    try { running = await this.store.markRunning(ref, { stage: "CAPITAL_ENGINE" }); }
    catch (error) { await this.store.releaseExecutionLease(lease.lease.token); throw error; }
    void this.execute(ref, running, spec, lease.lease.token).catch(error => process.stderr.write(`Workbench V2 lifecycle error: ${String(error)}\n`));
    return receipt(running, false, true);
  }
  private async execute(ref: AttemptRef, running: AttemptView, spec: NormalizedSpecV2, lease: string) {
    try {
      const outcome: CapitalExecutionOutcome = await executeCapitalResearchAttempt({ runId: ref.runId, executionAttemptId: ref.executionAttemptId,
        transactionCostBps: spec.transaction_cost_bps, productSpec: requestFromStored(spec) });
      if (outcome.boundedLogs) await this.store.appendLog(ref, outcome.boundedLogs);
      const manifest = await this.store.sealEngineArtifacts(ref);
      const base = successfulResult(ref, running, outcome, manifest, new Date().toISOString());
      const foldPlan = planCalendarV2(requestFromStored(spec), this.dataset);
      const evaluation = { evaluation_start: spec.evaluation_start, evaluation_end_exclusive: spec.evaluation_end_exclusive,
        fold_count: foldPlan.number_of_folds, window_type: spec.window_type, training_window_months: spec.training_window_months, rebalance_frequency: spec.rebalance_frequency };
      const result = { ...base, contract_version: "workbench-research-run-result-2.0.0", evaluation,
        metrics: { ...(base.metrics as object), evaluation },
        costs: { ...(base.costs as object), selection_cost_bps: spec.selection_cost_bps, selection_cost_meaning: "Training candidate ranking scenario", transaction_cost_meaning: "Selected-candidate OOS evaluation fee" },
        validation_diagnostics: { ...(base.validation_diagnostics as object), exact_fold_plan: foldPlan.folds,
          timing_semantics: { rebalance_equals_reselection_equals_oos_start: true },
          pit_diagnostics: { label: boundaryV2.pit_classification, data_snapshot_as_of: "NOT_INDEPENDENTLY_ESTABLISHED", fit_rows_strictly_before_cutoff: true, model_fit: "STATELESS_PRODUCTION_REGIME" } },
        provenance: { ...(base.provenance as object), adapter_version: ADAPTER_V2, code_version: spec.code_version, data_snapshot: spec.data_snapshot },
      };
      await this.store.completeSuccess(ref, result, { stage: "OUTER_OOS_AGGREGATE", artifactManifest: manifest });
    } catch (error) {
      const errorClass = error instanceof CapitalExecutionError ? error.errorClass : "WORKBENCH_EMPIRICAL_EXECUTION_FAILED";
      const safeMessage = error instanceof CapitalExecutionError ? error.message : "The empirical research attempt failed.";
      const base = terminalResult(ref, running, "FAILED", { errorClass, safeMessage }, new Date().toISOString());
      const result = { ...base, contract_version: "workbench-research-run-result-2.0.0",
        provenance: { ...base.provenance, adapter_version: ADAPTER_V2, code_version: spec.code_version, data_snapshot: spec.data_snapshot } };
      await this.store.completeFailure(ref, { errorClass, safeMessage, diagnostic: { detail: error instanceof Error ? error.stack?.slice(0, 65536) : String(error),
        worker: error instanceof CapitalExecutionError ? error.diagnostics.slice(0, 131072) : "NOT_APPLICABLE" }, result, stage: "EMPIRICAL_EXECUTION" });
    } finally { await this.store.releaseExecutionLease(lease); }
  }
  async getRun(runId: string) {
    const view = await this.v2Run(runId);
    const spec = view.normalized_spec as NormalizedSpecV2;
    const run = await this.reader.getRun(runId);
    return { ...run, contract_version: SPEC_V2, provenance: { ...run.provenance, adapter_version: ADAPTER_V2, code_version: spec.code_version } };
  }
  async listRuns() {
    const runs = await this.store.listRuns();
    return { ...boundaryV2, contract_version: SPEC_V2, runs: runs.filter(view => (view.normalized_spec as NormalizedSpecV2).contract_version === SPEC_V2)
      .map(view => ({ run_id: view.run.run_id, created_at: view.run.created_at, latest_status: view.latest_status,
        latest_execution_attempt_id: view.latest_attempt?.attempt.execution_attempt_id ?? "NOT_SUPPORTED", spec: view.normalized_spec })) };
  }
  async compare(leftRunId: string, rightRunId: string) {
    const [left, right] = await Promise.all([this.v2Run(leftRunId), this.v2Run(rightRunId)]);
    const result = await this.reader.compare(leftRunId, rightRunId);
    const fields = ["evaluation_start", "evaluation_end_exclusive", "window_type", "training_window_months", "rebalance_frequency", "transaction_cost_bps", "selection_cost_bps"] as const;
    const l = left.normalized_spec as NormalizedSpecV2, r = right.normalized_spec as NormalizedSpecV2;
    const differences = fields.filter(field => canonicalJson(l[field]) !== canonicalJson(r[field])).map(field => ({ path: `/${field}`, left: l[field], right: r[field] }));
    return { ...result, contract_version: "workbench-comparison-2.0.0", financial_input_differences: differences,
      warnings: [...result.warnings, ...(differences.some(item => item.path !== "/transaction_cost_bps") ? ["Research designs differ; fold calendars or selection economics may differ. These are mechanical comparisons only."] : [])] };
  }
}
export function requestFromStored(spec: NormalizedSpecV2) {
  const { contract_version, research_mode, execution_scope, universe, validation_protocol, evaluation_start, evaluation_end_exclusive,
    window_type, training_window_months, rebalance_frequency, transaction_cost_bps, selection_cost_bps } = spec;
  return { contract_version, research_mode, execution_scope, universe, validation_protocol, evaluation_start, evaluation_end_exclusive,
    window_type, training_window_months, rebalance_frequency, transaction_cost_bps, selection_cost_bps };
}
