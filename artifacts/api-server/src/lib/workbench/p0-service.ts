import { researchFailureCategory, researchFailureAction, researchFailureStage } from "./research-error-category";
import { persistentDatasetStore } from "./persistent-datasets";
import { DurableResearchStore, DURABLE_RESEARCH } from "./durable-research-store";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  WorkbenchRunStore,
  DEFAULT_STORE_LIMITS,
  type AttemptRef,
} from "./run-store";
import { readExecutionCapacity, researchExecutionBudget } from "./execution-capacity";
import { executionWatchdog } from "./execution-watchdog";
import {
  normalizeP0,
  p0RunId,
  planP0,
  P0_NAMESPACE,
  requestFromP0Spec,
  type P0Spec,
  type ResearchSubmission,
} from "./p0-calendar";
import { boundaryV2, CalendarContractError } from "./calendar-v2";
// The financial engine lives outside the API package, using its existing typed
// fixed-module convention. Results cross a fixed, size-bounded IPC boundary.
type CompactResult = any;
export class P0Service {
  private worker?: ChildProcess;
  private progress = new Map<string, any>();
  private constructor(readonly store: DurableResearchStore) {}
  static async open() {
    const c = readExecutionCapacity();
    return new P0Service(
      await DurableResearchStore.open({
        limits: {
          maxMetadataBytes: Math.max(
            DEFAULT_STORE_LIMITS.maxEngineOutputBytes,
            c.max_output_bytes,
          ),
          maxEngineOutputBytes: c.max_output_bytes,
          maxEngineFiles: c.max_engine_files,
        },
      }),
    );
  }
  async submit(value: unknown) {
    const spec = await normalizeP0(value),
      id = p0RunId(spec);
    return this.store.withSubmissionLock(async () => {
      await persistentDatasetStore.reference(spec.dataset_id, id);
      await this.store.ensureRun(id, spec);
      const run = await this.store.getRun(id);
      const existing =
        [...run.attempt_history]
          .reverse()
          .find((a) => ["RUNNING", "PENDING"].includes(a.status)) ??
        run.latest_successful_attempt ??
        run.latest_attempt;
      if (existing)
        return {
          ...boundaryV2,
          run_id: id,
          execution_attempt_id: existing.attempt.execution_attempt_id,
          status: existing.status,
          reused_existing_attempt: true,
          execution_requested: false,
        };
      return this.start(id, spec, "SUBMIT");
    });
  }
  async rerun(id: string) {
    return this.store.withSubmissionLock(async () => {
      const run = await this.store.getRun(id),
        stored = run.normalized_spec as P0Spec;
      const request = this.request(stored),
        spec = await normalizeP0(request);
      if (p0RunId(spec) !== id)
        throw new CalendarContractError(
          "RUN_IDENTITY_MISMATCH",
          "The engine or data changed. Duplicate the configuration to create a new experiment.",
          {},
          409,
        );
      return this.start(id, spec, "RERUN");
    });
  }
  private request(spec: P0Spec): ResearchSubmission {
    return requestFromP0Spec(spec);
  }
  private async start(
    id: string,
    spec: P0Spec,
    source: "SUBMIT" | "RERUN",
  ) {
    const c = readExecutionCapacity(),
      active = await this.store.inspectExecutionLease();
    if (active)
      throw new CalendarContractError(
        "BLOCKED_EXECUTION_CAPACITY",
        "Another empirical run is using the available research worker.",
        {
          active_run_id: active.run_id,
          owner_recovery_requirement:
            "If the worker was abandoned after a crash, the preview owner must inspect and recover the lease. There is no automatic lease clearing.",
        },
        429,
      );
    // Resolve the pinned data before creating an attempt or taking a lease.
    const plan = await planP0(this.request(spec));
    const attempt = await this.store.createAttempt(id, { source }),
      ref = {
        runId: id,
        executionAttemptId: attempt.attempt.execution_attempt_id,
      };
    const budget = researchExecutionBudget(spec, c);
    const lease = await this.store.acquireExecutionLease(ref, budget.execution_timeout_ms);
    if (!lease.acquired) {
      await this.store.completeBlocked(ref, {
        code: "BLOCKED_EXECUTION_CAPACITY",
        explanation: "Another research execution holds the worker.",
      });
      return {
        ...boundaryV2,
        run_id: id,
        execution_attempt_id: ref.executionAttemptId,
        status: "BLOCKED",
        reused_existing_attempt: false,
        execution_requested: false,
      };
    }
    await this.store.markRunning(ref, { stage: "PREPARING_DATA" });
    this.progress.set(ref.executionAttemptId, {
      status: "RUNNING",
      stage: "Preparing data",
      completed_work_units: 0,
      total_work_units: plan.total_work_units,
      percent_complete: 0,
      current_fold: 0,
      total_folds: plan.number_of_folds,
      completed_candidates: 0,
      total_candidates: 0,
      elapsed_ms: 0,
      estimated_remaining_ms: null,
      eta_confidence: "ESTIMATING",
      ...budget,
      last_progress_at: new Date().toISOString(),
    });
    void this.execute(ref, spec, lease.lease.token).catch(() => {});
    return {
      ...boundaryV2,
      run_id: id,
      execution_attempt_id: ref.executionAttemptId,
      status: "RUNNING",
      reused_existing_attempt: false,
      execution_requested: true,
    };
  }
  private createWorker() {
    const worker = fork(
      fileURLToPath(
        new URL("./workbench-p0-worker.mjs", import.meta.url),
      ),
      [],
      {
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        execArgv: ["--max-old-space-size=768"],
      },
    );
    const stop = () => worker.kill("SIGTERM");
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    worker.once("exit", () => {
      if (this.worker === worker) this.worker = undefined;
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
    });
    return worker;
  }
  private async execute(ref: AttemptRef, spec: P0Spec, lease: string) {
    const c = readExecutionCapacity(),
      started = Date.now();
    const budget = researchExecutionBudget(spec, c);
    let logs = "";
    try {
      const result = await new Promise<CompactResult>((resolve, reject) => {
        const worker = (this.worker ??= this.createWorker());
        let done = false;
        const clean = () => {
          watchdog.stop();
          worker.off("message", message);
          worker.off("error", failure);
          worker.off("exit", exit);
          worker.stdout?.off("data", log);
          worker.stderr?.off("data", log);
        };
        const failure = (e: unknown) => {
          if (done) return;
          done = true;
          clean();
          reject(e);
        };
        const log = (chunk: Buffer) => {
          logs += chunk.toString();
          if (Buffer.byteLength(logs) > this.store.limits.maxLogBytes) {
            this.worker = undefined;
            worker.kill("SIGKILL");
            failure(
              Object.assign(new Error("Worker log limit exceeded"), {
                code: "OUTPUT_OR_LOG_LIMIT",
              }),
            );
          }
        };
        const exit = (code: number | null, signal: NodeJS.Signals | null) => {
          this.worker = undefined;
          failure(
            Object.assign(
              new Error("Worker exited before publishing a result"),
              {
                code: "INTERACTIVE_WORKER_FAILURE",
                private_diagnostic: { exit_code: code, signal },
              },
            ),
          );
        };
        const message = (m: any) => {
          if (m.run_id !== ref.runId) return;
          if (m.type === "PROGRESS") {
            const previous = this.progress.get(ref.executionAttemptId);
            if (
              m.progress.completed_work_units >=
                previous.completed_work_units &&
              m.progress.completed_work_units <= previous.total_work_units
            )
              {
                this.progress.set(ref.executionAttemptId, {
                  ...m.progress, ...budget, last_progress_at: new Date().toISOString(),
                });
                watchdog.advance(m.progress.completed_work_units);
              }
          } else if (m.type === "RESULT") {
            if (
              Buffer.byteLength(JSON.stringify(m.result)) > c.max_output_bytes
            ) {
              failure(
                Object.assign(
                  new Error("Output exceeded the configured bound"),
                  { code: "OUTPUT_OR_LOG_LIMIT" },
                ),
              );
              return;
            }
            if (done) return;
            done = true;
            clean();
            resolve(m.result);
          } else if (m.type === "FAILURE")
            failure(
              Object.assign(new Error(m.safe_message), {
                code: m.code,
                details: m.details,
                private_diagnostic: m.private_diagnostic,
              }),
            );
        };
        const watchdog = executionWatchdog(budget, (code) => {
          this.worker = undefined;
          worker.kill("SIGKILL");
          failure(
            Object.assign(
              new Error(
                code === "EXECUTION_STALLED"
                  ? "This attempt stopped because the worker made no forward progress within the allowed interval."
                  : "This attempt reached its execution time limit and was stopped.",
              ),
              { code, details: budget },
            ),
          );
        });
        worker.on("message", message);
        worker.once("error", failure);
        worker.once("exit", exit);
        worker.stdout?.on("data", log);
        worker.stderr?.on("data", log);
        worker.send(
          {
            type: "EXECUTE",
            request: this.request(spec),
            run_id: ref.runId,
            max_output_bytes: c.max_output_bytes,
          },
          (e) => {
            if (e) failure(e);
          },
        );
      });
      const expected = await planP0(this.request(spec));
      if (result.plan.plan_hash !== expected.plan_hash)
        throw new Error("Worker plan mismatch");
      const final = {
        ...boundaryV2,
        ...result,
         storage_classification: DURABLE_RESEARCH,
         storage_status: DURABLE_RESEARCH,
        run_id: ref.runId,
        execution_attempt_id: ref.executionAttemptId,
        execution_kind: "PERSISTENT_DATASET_RESEARCH",
        dataset_id: spec.dataset_id, dataset_version: spec.dataset_version, dataset_hash: spec.dataset_hash, dataset_source: spec.dataset_source,
         storage_policy: DURABLE_RESEARCH,
        certification_status: "NOT_CERTIFIED",
        provenance: {
          dataset_id: spec.dataset_id, dataset_version: spec.dataset_version, dataset_hash: spec.dataset_hash, dataset_source: spec.dataset_source,
          code_version: spec.code_version,
          runtime_versions: spec.runtime_versions,
          engine_version: spec.engine_version,
          data_snapshot: spec.data_snapshot,
          methodology: spec.methodology,
        },
        runtime_progress: this.progress.get(ref.executionAttemptId),
        started_at: new Date(started).toISOString(),
        completed_at: new Date().toISOString(),
      };
      if (Buffer.byteLength(JSON.stringify(final)) > c.max_output_bytes)
        throw Object.assign(
          new Error(
            "The complete result exceeded the current output-size limit.",
          ),
          { code: "OUTPUT_OR_LOG_LIMIT" },
        );
      await this.store.completeSuccess(ref, final, { stage: "RESULTS_READY" });
    } catch (error) {
      const e = error as any;
      const code =
        typeof e.code === "string" && /^[A-Z_]+$/.test(e.code)
          ? e.code
          : "INTERACTIVE_WORKER_FAILURE";
      const known = [
        "PORTFOLIO_CONSTRAINT", "DATA_COVERAGE", "SOLVER_INFEASIBLE", "NUMERICAL_FAILURE", "FROZEN_COMPOSITION_EXPOSURE_CONFLICT",
        "DATASET_UNAVAILABLE",
        "SIGNAL_HISTORY_REQUIRED", "SIGNAL_UNIVERSE_REQUIRED", "FORECAST_TRAINING_REQUIRED", "FORECAST_NUMERICAL_FAILURE", "INVALID_FORECAST",
        "HMM_NUMERICAL_FAILURE",
        "HMM_HISTORY_REQUIRED",
        "HMM_DEGENERATE",
        "HMM_NOT_CONVERGED",
        "OPTIMIZATION_INVALID_RISK",
        "OPTIMIZER_NOT_CONVERGED",
        "OPTIMIZATION_INFEASIBLE",
        "NO_VALID_CANDIDATE",
        "INSUFFICIENT_SELECTION_HISTORY",
         "CASH_HISTORY_REQUIRED", "MANDATE_BREACH", "QUALITY_GATE_REQUIRED", "QUALITY_GATE_BLOCKED",
        "EXECUTION_ACCOUNTING_FAILURE",
        "OUTPUT_OR_LOG_LIMIT",
        "EXECUTION_TIMEOUT",
        "EXECUTION_STALLED",
      ].includes(code);
      const details =
        known && e.details && typeof e.details === "object" ? e.details : {};
      const failure = {
        ...boundaryV2,
        status: "FAILED",
        run_id: ref.runId,
        execution_attempt_id: ref.executionAttemptId,
        error_class: code,
        ...(researchFailureCategory(code) ? { error_category: researchFailureCategory(code) } : {}),
        safe_message: known
          ? e.message
          : "The research worker could not complete this attempt.",
        actionable_explanation:
          code === "NO_VALID_CANDIDATE"
            ? "The model could not select a policy under its existing constraints. No inputs were changed."
            : "No inputs were changed and no result was substituted.",
        suggested_user_action: researchFailureAction(researchFailureCategory(code)) ?? ([
          "OUTPUT_OR_LOG_LIMIT",
          "EXECUTION_TIMEOUT",
          "EXECUTION_STALLED",
        ].includes(code)
          ? "Ask the preview owner to review current execution capacity before explicitly rerunning."
          : known
            ? "Review the design and the technical evidence before explicitly rerunning."
            : "Ask the preview owner to inspect the private diagnostic before rerunning."),
        failed_fold_id: details.fold_id ?? null,
        failed_decision_date: details.decision_date ?? null,
        failed_stage: researchFailureStage(details, this.progress.get(ref.executionAttemptId)?.stage),
        diagnostic_reference: "PRIVATE_ATTEMPT_DIAGNOSTIC",
        technical_details: details,
        runtime_progress: {
          ...this.progress.get(ref.executionAttemptId),
          ...budget, status: "FAILED", elapsed_ms: Date.now() - started,
          estimated_remaining_ms: null, error_class: code,
        },
      };
      await this.store.completeFailure(ref, {
        errorClass: code,
        safeMessage: failure.safe_message,
        result: failure,
        diagnostic: {
          detail: String(e.stack ?? e).slice(0, 65536),
          worker: e.private_diagnostic ?? null,
          details,
          logs: logs.slice(0, 65536),
        },
        stage: failure.failed_stage,
      });
      this.progress.set(ref.executionAttemptId, {
        ...this.progress.get(ref.executionAttemptId),
        status: "FAILED",
        stage: failure.failed_stage,
        elapsed_ms: Date.now() - started,
        estimated_remaining_ms: null,
      });
    } finally {
      this.progress.delete(ref.executionAttemptId);
      await this.store.releaseExecutionLease(lease);
    }
  }
  async get(id: string) {
    const run = await this.store.getRun(id);
    if ((run.normalized_spec as any).identity_namespace !== P0_NAMESPACE)
      throw new CalendarContractError(
        "UNSUPPORTED_RUN_VERSION",
        "This run belongs to the prior certification contract.",
        {},
        409,
      );
    const latest = run.latest_attempt,
      success = run.latest_successful_attempt;
    const result =
      latest && ["SUCCESS", "FAILED", "BLOCKED"].includes(latest.status)
        ? await this.store.readAttemptResult({
            runId: id,
            executionAttemptId: latest.attempt.execution_attempt_id,
          })
        : null;
    const good = success
      ? latest === success
        ? result
        : await this.store.readResult({
            runId: id,
            executionAttemptId: success.attempt.execution_attempt_id,
          })
      : null;
    let progress = latest
      ? (this.progress.get(latest.attempt.execution_attempt_id) ??
        (result as any)?.runtime_progress ??
        null)
      : null;
    if (progress && latest) {
      progress = { ...progress, status: latest.status };
      if (latest.status === "RUNNING") {
        const elapsed = Math.max(
          progress.elapsed_ms,
          Date.now() -
            Date.parse(latest.started_at ?? latest.attempt.requested_at),
        );
        progress = {
          ...progress,
          elapsed_ms: elapsed,
          estimated_remaining_ms:
            progress.completed_work_units > 1
              ? Math.max(
                  0,
                  ((progress.total_work_units - progress.completed_work_units) *
                    elapsed) /
                    progress.completed_work_units,
                )
              : null,
        };
      }
    }
    return {
      ...boundaryV2,
      storage_classification: run.run.storage_status,
      storage_status: run.run.storage_status,
      run_id: id,
      spec: run.normalized_spec,
      created_at: run.run.created_at,
      latest_status: run.latest_status,
      latest_attempt: latest,
      attempt_history: run.attempt_history,
      latest_result: result,
      latest_successful_result: good,
      progress,
    };
  }
  async list() {
    const runs = (await this.store.listRuns()).filter(
      (r) => (r.normalized_spec as any).identity_namespace === P0_NAMESPACE,
    );
    return {
      ...boundaryV2,
      storage_classification: DURABLE_RESEARCH,
      runs: await Promise.all(
        runs.map(async (r) => {
          const success = r.latest_successful_attempt;
          const result: any = success
            ? await this.store.readResult({
                runId: r.run.run_id,
                executionAttemptId: success.attempt.execution_attempt_id,
              })
            : null;
          return {
            run_id: r.run.run_id,
             storage_status: r.run.storage_status,
             review_state: (await this.store.reviews(r.run.run_id)).state,
            created_at: r.run.created_at,
            spec: r.normalized_spec,
            status: r.latest_status,
            latest_attempt: r.latest_attempt,
            metrics: result?.metrics ?? "NOT_SUPPORTED",
            fold_count: result?.plan.number_of_folds ?? null,
          };
        }),
      ),
    };
  }
  async close() {
    this.worker?.kill("SIGTERM");
    this.worker = undefined;
  }
}
