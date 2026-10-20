import { createHash } from "node:crypto";
import {
  type CapitalExecutionInput,
  type CapitalExecutionOutcome,
  CapitalExecutionError,
  executeCapitalResearchAttempt,
} from "./execution-adapter";
import {
  PIT_CLASSIFICATION,
  RESEARCH_BOUNDARY,
  RESEARCH_RUN_RESULT_VERSION,
  STORAGE_CLASSIFICATION,
  type NormalizedResearchRunSpec,
  type ResearchRunResult,
  type ResearchRunSpec,
  type SupportedTransactionCostBps,
  normalizeResearchRunSpec,
} from "./contracts";
import { WORKBENCH_CAPABILITIES } from "./capabilities";
import { canonicalJson, calculateRunId, createResearchRunSpec, isRunId } from "./identity";
import {
  type AttemptRef,
  type AttemptView,
  type EngineArtifactManifest,
  type ExecutionLeaseRecord,
  type StoredRunView,
  WorkbenchRunStore,
  WorkbenchRunStoreError,
  type WorkbenchRunStoreOptions,
} from "./run-store";

export const WORKBENCH_EXECUTION_TIMEOUT_MS = 120_000;

export type WorkbenchAttemptExecutor = (
  input: CapitalExecutionInput,
) => Promise<CapitalExecutionOutcome>;

export interface WorkbenchServiceOptions {
  store?: WorkbenchRunStore;
  storeOptions?: WorkbenchRunStoreOptions;
  executeAttempt?: WorkbenchAttemptExecutor;
  now?: () => string;
}

export interface WorkbenchSubmissionReceipt {
  research_boundary: typeof RESEARCH_BOUNDARY;
  pit_classification: typeof PIT_CLASSIFICATION;
  storage_classification: typeof STORAGE_CLASSIFICATION;
  run_id: string;
  execution_attempt_id: string;
  status: AttemptView["status"];
  stage: string;
  reused_existing_attempt: boolean;
  execution_requested: boolean;
}

const boundary = () => ({
  research_boundary: RESEARCH_BOUNDARY,
  pit_classification: PIT_CLASSIFICATION,
  storage_classification: STORAGE_CLASSIFICATION,
});

const resultBoundary = () => ({
  real_money_boundary: RESEARCH_BOUNDARY,
  pit_classification: PIT_CLASSIFICATION,
  storage_classification: STORAGE_CLASSIFICATION,
});

function fullStoredSpec(view: StoredRunView): ResearchRunSpec {
  return {
    ...(view.normalized_spec as NormalizedResearchRunSpec),
    run_id: view.run.run_id,
    created_at: view.run.created_at,
    requested_by: "WORKBENCH_API_CLIENT",
    storage_policy: {
      kind: STORAGE_CLASSIFICATION,
      durability: "NOT_GUARANTEED",
      root_source: "SERVER_CONFIGURED",
      attempt_policy: "IMMUTABLE_APPEND_ONLY",
    },
  };
}

function receipt(attempt: AttemptView, reused: boolean, executionRequested: boolean): WorkbenchSubmissionReceipt {
  return {
    ...boundary(),
    run_id: attempt.attempt.run_id,
    execution_attempt_id: attempt.attempt.execution_attempt_id,
    status: attempt.status,
    stage: attempt.stage,
    reused_existing_attempt: reused,
    execution_requested: executionRequested,
  };
}

function resultArtifactPath(ref: AttemptRef, path: string): string {
  return `runs/${ref.runId}/attempts/${ref.executionAttemptId}/engine/${path}`;
}

function successfulResult(
  ref: AttemptRef,
  attempt: AttemptView,
  outcome: CapitalExecutionOutcome,
  manifest: EngineArtifactManifest,
  completedAt: string,
): ResearchRunResult {
  const evidence = outcome.result;
  const metrics = evidence.scenario_metrics;
  const artifactByKind = new Map(evidence.result_artifacts.map((item) => [item.kind, item]));
  const ledger = artifactByKind.get("OOS_LEDGER");
  const equity = artifactByKind.get("OOS_EQUITY");
  const selectedJobs = evidence.selected_jobs.map((job) => ({
    outer_fold: job.outer_fold,
    candidate_id: job.candidate_id,
    scenario: job.scenario,
    job_hash: job.job_hash,
    result_hash: job.result_hash,
    fit_keys: job.fit_keys,
    targets: job.targets,
    artifact: resultArtifactPath(ref, job.artifact),
  }));
  return {
    contract_version: RESEARCH_RUN_RESULT_VERSION,
    run_id: ref.runId,
    execution_attempt_id: ref.executionAttemptId,
    status: "SUCCESS",
    started_at: attempt.started_at ?? "NOT_APPLICABLE",
    completed_at: completedAt,
    input_spec_reference: `runs/${ref.runId}/normalized-spec.json`,
    stage: "OUTER_OOS_AGGREGATE",
    ...resultBoundary(),
    result_artifacts: evidence.result_artifacts.map((item) => ({
      path: resultArtifactPath(ref, item.path),
      sha256: item.sha256,
      ...(item.selector ? { selector: item.selector } : {}),
      ...(item.selected_rows_sha256 ? { selected_rows_sha256: item.selected_rows_sha256 } : {}),
    })),
    metrics: {
      observations: metrics.observations,
      cagr: metrics.cagr,
      net_sharpe: metrics.net_sharpe,
      max_drawdown: metrics.max_drawdown,
      return_drawdown_ratio: metrics.return_drawdown_ratio,
      annualized_volatility: metrics.volatility,
      gross_turnover: metrics.turnover,
      annualized_turnover: metrics.turnover_annualized,
      mean_beginning_risky_exposure: metrics.exposure,
      final_research_index: metrics.final_index,
      economic_claim: "NONE",
    },
    time_series: {
      status: "AVAILABLE",
      meaning: "Outer-OOS research index for independent fold sleeves.",
      observations: evidence.time_series.length,
      points: evidence.time_series,
      artifact: equity ? resultArtifactPath(ref, equity.path) : "NOT_SUPPORTED",
      selected_rows_sha256: equity?.selected_rows_sha256 ?? "NOT_SUPPORTED",
    },
    weights_or_positions: {
      status: "AVAILABLE_AT_DAILY_LEDGER_LEVEL",
      meaning: "Beginning and ending SPY positions and cash in independent OOS sleeves; not multi-asset final NAV weights.",
      artifact: ledger ? resultArtifactPath(ref, ledger.path) : "NOT_SUPPORTED",
      selector: `scenario=${evidence.requested_transaction_cost_bps}`,
    },
    trades_or_rebalances: {
      status: "AVAILABLE_AT_DAILY_LEDGER_LEVEL",
      execution: "next_close",
      artifact: ledger ? resultArtifactPath(ref, ledger.path) : "NOT_SUPPORTED",
      selector: `scenario=${evidence.requested_transaction_cost_bps}`,
    },
    costs: {
      transaction_cost_bps: evidence.requested_transaction_cost_bps,
      realized_transaction_cost: metrics.costs,
      cost_basis: "actual absolute traded notional",
      slippage_bps: 0,
      gross_and_net_distinction: evidence.requested_transaction_cost_bps === 0
        ? "Net equals gross because the explicitly stored transaction cost is zero."
        : "Net returns include fees charged on actual absolute traded notional.",
    },
    risk_diagnostics: {
      annualized_volatility: metrics.volatility,
      max_drawdown: metrics.max_drawdown,
      mean_beginning_risky_exposure: metrics.exposure,
      expected_beta: "NOT_SUPPORTED",
      realized_beta: "NOT_SUPPORTED",
    },
    validation_diagnostics: {
      mode: "TRADITIONAL_WALK_FORWARD",
      outer_folds: evidence.selected_folds,
      selected_jobs: selectedJobs,
      job_hashes: selectedJobs.map((job) => job.job_hash),
      result_hashes: selectedJobs.map((job) => job.result_hash),
      selected_candidates: selectedJobs.map((job) => job.candidate_id),
      pit_diagnostics: {
        label: PIT_CLASSIFICATION,
        pit_mechanics_status: "VERIFIED_STRICT_CUTOFF",
        pit_data_status: "BLOCKED_MISSING_HISTORICAL_DATA_AVAILABILITY",
        data_snapshot_as_of: "2026-10-13T13:36:42.846Z",
        promotion_state_as_of: "NOT_APPLICABLE",
        activation_state_as_of: "NOT_APPLICABLE",
      },
      dsr: "NOT_SUPPORTED",
    },
    warnings: evidence.warnings,
    blockers: evidence.blockers,
    error_class: null,
    error_message: null,
    provenance: {
      certified_engine_commit: WORKBENCH_CAPABILITIES.engine_identity.certified_engine_commit,
      adapter_version: evidence.adapter_version,
      engine_version: evidence.engine.engine_version,
      experiment_id: evidence.engine.experiment_id,
      experiment_hash: evidence.engine.experiment_hash,
      code_hash: evidence.engine.code_hash,
      data_sha256: evidence.engine.data_csv_sha256,
      parsed_data_hash: evidence.engine.parsed_data_hash,
      campaign_config_sha256: evidence.engine.campaign_config_sha256,
      data_vintage_limitation: PIT_CLASSIFICATION,
    },
    reproducibility: {
      financial_result_hash: evidence.financial_result_hash,
      runtime_hash: evidence.runtime_hash,
      new_jobs: evidence.engine.new_jobs,
      reused_jobs: evidence.engine.reused_jobs,
      fresh_attempt_root: true,
      financial_hash_excludes: [
        "timestamps", "memory readings", "runtime counters", "progress.json", "logs", "execution_attempt_id",
      ],
    },
    financial_result_hash: evidence.financial_result_hash,
    runtime_hash: evidence.runtime_hash,
    execution: {
      whole_campaign_new_jobs: evidence.engine.new_jobs,
      whole_campaign_reused_jobs: evidence.engine.reused_jobs,
      artifact_file_count: manifest.file_count,
      artifact_total_bytes: manifest.total_bytes,
      full_campaign_financial_artifact_hash: manifest.financial_result_hash,
      runtime_artifact_hash: manifest.runtime_hash,
    },
  };
}

function terminalResult(
  ref: AttemptRef,
  attempt: AttemptView,
  status: "FAILED" | "BLOCKED",
  input: { errorClass?: string; safeMessage?: string; blocker?: unknown },
  completedAt: string,
): ResearchRunResult {
  const blocker = input.blocker ?? attempt.terminal?.blocker;
  const attemptReference = `runs/${ref.runId}/attempts/${ref.executionAttemptId}`;
  return {
    contract_version: RESEARCH_RUN_RESULT_VERSION,
    run_id: ref.runId,
    execution_attempt_id: ref.executionAttemptId,
    status,
    started_at: attempt.started_at ?? "NOT_APPLICABLE",
    completed_at: completedAt,
    input_spec_reference: `runs/${ref.runId}/normalized-spec.json`,
    stage: status === "BLOCKED" ? "EXECUTION_CAPACITY" : "EMPIRICAL_EXECUTION",
    ...resultBoundary(),
    result_artifacts: [],
    metrics: "NOT_SUPPORTED",
    time_series: "NOT_SUPPORTED",
    weights_or_positions: "NOT_SUPPORTED",
    trades_or_rebalances: "NOT_SUPPORTED",
    costs: "NOT_SUPPORTED",
    risk_diagnostics: "NOT_SUPPORTED",
    validation_diagnostics: "NOT_SUPPORTED",
    warnings: [PIT_CLASSIFICATION],
    blockers: blocker === undefined ? [] : [blocker as string | Record<string, unknown>],
    error_class: input.errorClass ?? null,
    error_message: input.safeMessage ?? null,
    provenance: {
      certified_engine_commit: WORKBENCH_CAPABILITIES.engine_identity.certified_engine_commit,
      adapter_version: WORKBENCH_CAPABILITIES.engine_identity.adapter_version,
      data_vintage_limitation: PIT_CLASSIFICATION,
    },
    reproducibility: "NOT_SUPPORTED",
    financial_result_hash: "NOT_SUPPORTED",
    runtime_hash: "NOT_SUPPORTED",
    execution: status === "FAILED"
      ? {
          runtime_diagnostic_reference: `${attemptReference}/diagnostic.json`,
          runtime_log_reference: `${attemptReference}/diagnostic.json`,
          runtime_log_storage: "BOUNDED_LOGS_EMBEDDED_WHEN_AVAILABLE",
          diagnostic_content_exposed_by_api: false,
        }
      : {
          runtime_diagnostic_reference: "NOT_APPLICABLE",
          runtime_log_reference: "NOT_APPLICABLE",
        },
  };
}

function publicAttempt(attempt: AttemptView) {
  const attemptReference =
    `runs/${attempt.attempt.run_id}/attempts/${attempt.attempt.execution_attempt_id}`;
  return {
    run_id: attempt.attempt.run_id,
    execution_attempt_id: attempt.attempt.execution_attempt_id,
    source: attempt.attempt.source,
    requested_at: attempt.attempt.requested_at,
    status: attempt.status,
    stage: attempt.stage,
    started_at: attempt.started_at,
    completed_at: attempt.completed_at,
    error_class: attempt.terminal?.error_class ?? null,
    error_message: attempt.terminal?.error_message ?? null,
    blocker: attempt.terminal?.blocker ?? null,
    runtime_diagnostic_reference: attempt.status === "FAILED"
      ? `${attemptReference}/diagnostic.json`
      : "NOT_APPLICABLE",
  };
}

function safeDiagnostic(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: (error.stack ?? "").slice(0, 64 * 1024),
      ...(error instanceof CapitalExecutionError ? { diagnostics: error.diagnostics.slice(0, 128 * 1024) } : {}),
    };
  }
  return { value: String(error).slice(0, 64 * 1024) };
}

function errorDetails(error: unknown): { errorClass: string; safeMessage: string } {
  if (error instanceof CapitalExecutionError) {
    return { errorClass: error.errorClass, safeMessage: error.message };
  }
  if (error instanceof WorkbenchRunStoreError) {
    return { errorClass: error.code, safeMessage: "The immutable research evidence could not be stored." };
  }
  return {
    errorClass: "WORKBENCH_EMPIRICAL_EXECUTION_FAILED",
    safeMessage: "The empirical research attempt failed.",
  };
}

function jsonPointerEscape(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function specDifferences(left: unknown, right: unknown, path = ""): Array<{
  path: string; left: unknown; right: unknown;
}> {
  if (canonicalJson(left) === canonicalJson(right)) return [];
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    return Array.from({ length }, (_, index) => specDifferences(left[index], right[index], `${path}/${index}`)).flat();
  }
  if (left && right && typeof left === "object" && typeof right === "object" &&
      !Array.isArray(left) && !Array.isArray(right)) {
    const l = left as Record<string, unknown>;
    const r = right as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(l), ...Object.keys(r)])].sort();
    return keys.flatMap((key) => specDifferences(l[key], r[key], `${path}/${jsonPointerEscape(key)}`));
  }
  return [{ path: path || "/", left: left ?? "NOT_PRESENT", right: right ?? "NOT_PRESENT" }];
}

export class WorkbenchService {
  private constructor(
    readonly store: WorkbenchRunStore,
    private readonly executeAttempt: WorkbenchAttemptExecutor,
    private readonly now: () => string,
  ) {}

  static async open(options: WorkbenchServiceOptions = {}): Promise<WorkbenchService> {
    const store = options.store ?? await WorkbenchRunStore.open(options.storeOptions);
    return new WorkbenchService(store, options.executeAttempt ?? executeCapitalResearchAttempt,
      options.now ?? (() => new Date().toISOString()));
  }

  capabilities() {
    return WORKBENCH_CAPABILITIES;
  }

  async submit(value: unknown): Promise<WorkbenchSubmissionReceipt> {
    const requested = createResearchRunSpec(value, { createdAt: this.now() });
    const normalized = normalizeResearchRunSpec(value);
    return this.store.withSubmissionLock(async () => {
      await this.store.ensureRun(requested.run_id, normalized, { createdAt: requested.created_at });
      const existing = await this.store.getRun(requested.run_id);
      const newestFirst = [...existing.attempt_history].reverse();
      const reusable = newestFirst.find((attempt) => attempt.status === "PENDING" || attempt.status === "RUNNING")
        ?? newestFirst.find((attempt) => attempt.status === "SUCCESS")
        ?? existing.latest_attempt;
      if (reusable) return receipt(reusable, true, false);
      return this.createAndStart(requested.run_id, normalized.transaction_cost_bps, "SUBMIT");
    });
  }

  async rerun(runId: string): Promise<WorkbenchSubmissionReceipt> {
    if (!isRunId(runId)) throw new WorkbenchRunStoreError("INVALID_RUN_ID", "run_id has an invalid format.");
    return this.store.withSubmissionLock(async () => {
      const view = await this.store.getRun(runId);
      const spec = view.normalized_spec as NormalizedResearchRunSpec;
      return this.createAndStart(runId, spec.transaction_cost_bps, "RERUN");
    });
  }

  private async createAndStart(
    runId: string,
    cost: SupportedTransactionCostBps,
    source: "SUBMIT" | "RERUN",
  ): Promise<WorkbenchSubmissionReceipt> {
    const activeLease = await this.store.inspectExecutionLease();
    if (activeLease) {
      const view = await this.store.getRun(runId);
      const reusableBlocked = [...view.attempt_history].reverse().find((candidate) => {
        if (candidate.status !== "BLOCKED" || !candidate.terminal?.blocker ||
            typeof candidate.terminal.blocker !== "object") return false;
        const blocker = candidate.terminal.blocker as Record<string, unknown>;
        return blocker.code === "BLOCKED_EXECUTION_CAPACITY" &&
          blocker.active_run_id === activeLease.run_id &&
          blocker.active_execution_attempt_id === activeLease.execution_attempt_id;
      });
      if (reusableBlocked) return receipt(reusableBlocked, true, false);
      const blockedAttempt = await this.store.createAttempt(runId, {
        source, requestedAt: this.now(),
      });
      return this.blockForCapacity(blockedAttempt, activeLease);
    }

    const attempt = await this.store.createAttempt(runId, { source, requestedAt: this.now() });
    const ref = { runId, executionAttemptId: attempt.attempt.execution_attempt_id };
    const lease = await this.store.acquireExecutionLease(ref, WORKBENCH_EXECUTION_TIMEOUT_MS);
    if (!lease.acquired) {
      return this.blockForCapacity(attempt, lease.lease);
    }
    let running: AttemptView;
    try {
      running = await this.store.markRunning(ref, {
        startedAt: this.now(), stage: "CAPITAL_ENGINE",
      });
    } catch (error) {
      await this.store.releaseExecutionLease(lease.lease.token).catch(() => undefined);
      throw error;
    }
    void this.executeLifecycle(ref, running, cost, lease.lease.token).catch((error) => {
      // Store failures are deliberately kept out of client responses. A later
      // poll will expose the last immutable state instead of a prior result.
      process.stderr.write(`Workbench execution lifecycle error: ${String(error)}\n`);
    });
    return receipt(running, false, true);
  }

  private async blockForCapacity(
    attempt: AttemptView,
    activeLease: ExecutionLeaseRecord,
  ): Promise<WorkbenchSubmissionReceipt> {
    const ref = {
      runId: attempt.attempt.run_id,
      executionAttemptId: attempt.attempt.execution_attempt_id,
    };
    const blocker = {
      code: "BLOCKED_EXECUTION_CAPACITY",
      explanation: "Phase B1 permits at most one concurrent empirical execution.",
      active_run_id: activeLease.run_id,
      active_execution_attempt_id: activeLease.execution_attempt_id,
    };
    const completedAt = this.now();
    const blocked = terminalResult(ref, attempt, "BLOCKED", { blocker }, completedAt);
    const finished = await this.store.completeBlocked(ref, blocker, {
      result: blocked, completedAt, stage: "EXECUTION_CAPACITY",
    });
    return receipt(finished, false, false);
  }

  private async executeLifecycle(
    ref: AttemptRef,
    running: AttemptView,
    cost: SupportedTransactionCostBps,
    leaseToken: string,
  ): Promise<void> {
    try {
      const outcome = await this.executeAttempt({
        runId: ref.runId,
        executionAttemptId: ref.executionAttemptId,
        transactionCostBps: cost,
      });
      if (outcome.boundedLogs) await this.store.appendLog(ref, outcome.boundedLogs);
      const manifest = await this.store.sealEngineArtifacts(ref, this.now());
      const completedAt = this.now();
      const result = successfulResult(ref, running, outcome, manifest, completedAt);
      await this.store.completeSuccess(ref, result, {
        completedAt: result.completed_at,
        stage: "OUTER_OOS_AGGREGATE",
        artifactManifest: manifest,
      });
    } catch (error) {
      const detail = errorDetails(error);
      const current = await this.store.getAttempt(ref);
      const completedAt = this.now();
      const result = terminalResult(ref, current, "FAILED", detail, completedAt);
      await this.store.completeFailure(ref, {
        ...detail,
        diagnostic: safeDiagnostic(error),
        result,
        stage: "EMPIRICAL_EXECUTION",
        completedAt,
      });
    } finally {
      await this.store.releaseExecutionLease(leaseToken);
    }
  }

  async getRun(runId: string) {
    if (!isRunId(runId)) throw new WorkbenchRunStoreError("INVALID_RUN_ID", "run_id has an invalid format.");
    const view = await this.store.getRun(runId);
    const latest = view.latest_attempt;
    let latestResult: unknown = latest ? "NOT_AVAILABLE_WHILE_PENDING_OR_RUNNING" : "NOT_SUPPORTED";
    if (latest && latest.status !== "PENDING" && latest.status !== "RUNNING") {
      latestResult = await this.store.readAttemptResult({
        runId, executionAttemptId: latest.attempt.execution_attempt_id,
      });
    }
    let latestSuccessfulResult: unknown = "NOT_SUPPORTED";
    if (view.latest_successful_attempt) {
      latestSuccessfulResult = await this.store.readResult({
        runId,
        executionAttemptId: view.latest_successful_attempt.attempt.execution_attempt_id,
      });
    }
    return {
      ...boundary(),
      run_id: runId,
      spec: fullStoredSpec(view),
      attempt_history: view.attempt_history.map(publicAttempt),
      latest_status: view.latest_status,
      latest_attempt: latest ? publicAttempt(latest) : null,
      latest_result: latestResult,
      latest_successful_result: latestSuccessfulResult,
      warnings: [PIT_CLASSIFICATION],
      blockers: latest?.terminal?.blocker === undefined ? [] : [latest.terminal.blocker],
      provenance: {
        certified_engine_commit: WORKBENCH_CAPABILITIES.engine_identity.certified_engine_commit,
        adapter_version: WORKBENCH_CAPABILITIES.engine_identity.adapter_version,
      },
    };
  }

  async listRuns() {
    const runs = await this.store.listRuns();
    return {
      ...boundary(),
      runs: runs.map((view) => ({
        run_id: view.run.run_id,
        created_at: view.run.created_at,
        latest_status: view.latest_status,
        latest_execution_attempt_id: view.latest_attempt?.attempt.execution_attempt_id ?? null,
        successful_execution_attempt_id: view.latest_successful_attempt?.attempt.execution_attempt_id ?? null,
        transaction_cost_bps: (view.normalized_spec as NormalizedResearchRunSpec).transaction_cost_bps,
      })),
    };
  }

  async compare(leftRunId: string, rightRunId: string) {
    if (!isRunId(leftRunId) || !isRunId(rightRunId))
      throw new WorkbenchRunStoreError("INVALID_RUN_ID", "Both compare run IDs must have canonical format.");
    const [left, right] = await Promise.all([this.store.getRun(leftRunId), this.store.getRun(rightRunId)]);
    if (!left.latest_successful_attempt || !right.latest_successful_attempt)
      throw new WorkbenchRunStoreError("COMPARE_REQUIRES_SUCCESS", "Compare requires two successful immutable attempts.");
    const leftRef = {
      runId: leftRunId,
      executionAttemptId: left.latest_successful_attempt.attempt.execution_attempt_id,
    };
    const rightRef = {
      runId: rightRunId,
      executionAttemptId: right.latest_successful_attempt.attempt.execution_attempt_id,
    };
    const [leftResult, rightResult] = await Promise.all([
      this.store.readResult(leftRef), this.store.readResult(rightRef),
    ]) as [ResearchRunResult, ResearchRunResult];
    const differences = specDifferences(left.normalized_spec, right.normalized_spec);
    if (typeof leftResult.metrics === "string" || typeof rightResult.metrics === "string" ||
        typeof leftResult.costs === "string" || typeof rightResult.costs === "string") {
      throw new WorkbenchRunStoreError("COMPARE_RESULT_INCOMPLETE", "Compare inputs lack supported financial outputs.");
    }
    const leftMetrics = leftResult.metrics;
    const rightMetrics = rightResult.metrics;
    const leftCosts = leftResult.costs as Record<string, unknown>;
    const rightCosts = rightResult.costs as Record<string, unknown>;
    const comparedValues = {
      left_transaction_cost_bps: leftCosts.transaction_cost_bps,
      right_transaction_cost_bps: rightCosts.transaction_cost_bps,
      left_realized_cost: leftCosts.realized_transaction_cost,
      right_realized_cost: rightCosts.realized_transaction_cost,
      left_observations: leftMetrics.observations,
      right_observations: rightMetrics.observations,
      left_final_research_index: leftMetrics.final_research_index,
      right_final_research_index: rightMetrics.final_research_index,
    };
    if (Object.values(comparedValues).some((value) =>
      typeof value !== "number" || !Number.isFinite(value))) {
      throw new WorkbenchRunStoreError(
        "COMPARE_RESULT_INCOMPLETE",
        "Compare inputs lack finite supported financial outputs.",
      );
    }
    const values = comparedValues as Record<keyof typeof comparedValues, number>;
    const comparisonId = `cmp_${createHash("sha256").update(canonicalJson({ leftRef, rightRef })).digest("hex")}`;
    return {
      ...boundary(),
      comparison_id: comparisonId,
      calculation: "READ_ONLY_NO_RECALCULATION",
      left: {
        run_id: leftRunId,
        execution_attempt_id: leftRef.executionAttemptId,
        financial_result_hash: leftResult.financial_result_hash,
      },
      right: {
        run_id: rightRunId,
        execution_attempt_id: rightRef.executionAttemptId,
        financial_result_hash: rightResult.financial_result_hash,
      },
      spec_differences: differences,
      financial_input_differences: differences.filter((item) => item.path === "/transaction_cost_bps"),
      transaction_cost_difference_bps:
        values.right_transaction_cost_bps - values.left_transaction_cost_bps,
      oos_observation_difference:
        values.right_observations - values.left_observations,
      final_research_index_difference:
        values.right_final_research_index - values.left_final_research_index,
      realized_cost_difference:
        values.right_realized_cost - values.left_realized_cost,
      warnings: [
        PIT_CLASSIFICATION,
        "Comparison reports mechanical differences and does not rank, recommend, or declare a winner.",
      ],
    };
  }
}

export async function createWorkbenchService(options: WorkbenchServiceOptions = {}): Promise<WorkbenchService> {
  return WorkbenchService.open(options);
}

export function runIdFromSubmission(value: unknown): string {
  return calculateRunId(normalizeResearchRunSpec(value));
}
