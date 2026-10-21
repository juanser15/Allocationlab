import { fork, type ChildProcess } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, realpathSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkbenchRepositoryRoot } from "./repository-root";

export const WORKBENCH_ADAPTER_VERSION = "workbench-b1-capital-adapter-1.0.0";
export const WORKBENCH_PIT_CLASSIFICATION =
  "PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED";
export const WORKBENCH_STORAGE_STATUS = "TEMPORARY_RESEARCH_STORAGE";
export const WORKBENCH_REAL_MONEY_BOUNDARY = "RESEARCH_ONLY";
export const WORKBENCH_MAX_LOG_BYTES = 1024 * 1024;

export type SupportedTransactionCostBps = 0 | 5;

export interface CapitalExecutionInput {
  runId: string;
  executionAttemptId: string;
  transactionCostBps: SupportedTransactionCostBps;
}
export interface CapitalScenarioMetrics {
  scenario: SupportedTransactionCostBps;
  observations: number;
  cagr: number;
  net_sharpe: number;
  max_drawdown: number;
  return_drawdown_ratio: number;
  volatility: number;
  turnover: number;
  turnover_annualized: number;
  costs: number;
  exposure: number;
  final_index: number;
}

export interface CapitalSelectedFold {
  outer_fold: number;
  train_start: string;
  train_end: string;
  test_start: string;
  test_end: string;
  selection_metric: string;
  selection_cost_bps: number;
  candidate_id: string;
  score: number;
  rank: number;
  scoring_hash: string;
  status: "SELECTED";
}

export interface CapitalSelectedJob {
  outer_fold: number;
  candidate_id: string;
  scenario: SupportedTransactionCostBps;
  job_hash: string;
  result_hash: string;
  fit_keys: string[];
  targets: Record<string, unknown>[];
  artifact: string;
}

export interface CapitalTimeSeriesPoint {
  outer_fold: number;
  candidate_id: string;
  date: string;
  index: number;
  drawdown: number;
  net_return: number;
  exposure: number;
}

export interface CapitalResultArtifact {
  kind: string;
  path: string;
  sha256: string;
  selector?: string;
  selected_rows_sha256?: string;
}

export interface CapitalExecutionEvidence {
  adapter_version: typeof WORKBENCH_ADAPTER_VERSION;
  pit_classification: typeof WORKBENCH_PIT_CLASSIFICATION;
  storage_status: typeof WORKBENCH_STORAGE_STATUS;
  real_money_boundary: typeof WORKBENCH_REAL_MONEY_BOUNDARY;
  requested_transaction_cost_bps: SupportedTransactionCostBps;
  engine: {
    engine_version: string;
    experiment_id: string;
    experiment_hash: string;
    code_hash: string;
    data_csv_sha256: string;
    parsed_data_hash: string;
    campaign_config_sha256: string;
    new_jobs: number;
    reused_jobs: number;
  };
  scenario_metrics: CapitalScenarioMetrics;
  selected_folds: CapitalSelectedFold[];
  selected_jobs: CapitalSelectedJob[];
  time_series: CapitalTimeSeriesPoint[];
  result_artifacts: CapitalResultArtifact[];
  financial_result_hash: string;
  runtime_hash: string;
  warnings: string[];
  blockers: string[];
}

export interface CapitalExecutionOutcome {
  engineRoot: string;
  result: CapitalExecutionEvidence;
  boundedLogs: string;
}

export type CapitalExecutionErrorClass =
  | "WORKBENCH_EXECUTION_BUSY"
  | "WORKBENCH_INVALID_EXECUTION_INPUT"
  | "WORKBENCH_UNSAFE_STORAGE_ROOT"
  | "WORKBENCH_ATTEMPT_ALREADY_EXISTS"
  | "WORKBENCH_EXECUTION_TIMEOUT"
  | "WORKBENCH_OUTPUT_LIMIT_EXCEEDED"
  | "WORKBENCH_LOG_LIMIT_EXCEEDED"
  | "WORKBENCH_WORKER_FAILED"
  | "WORKBENCH_WORKER_PROTOCOL_ERROR";

export class CapitalExecutionError extends Error {
  constructor(
    readonly errorClass: CapitalExecutionErrorClass,
    safeMessage: string,
    readonly diagnostics = "",
  ) {
    super(safeMessage);
    this.name = "CapitalExecutionError";
  }
}

interface AdapterLimits {
  timeoutMs: number;
  maxOutputBytes: number;
  maxLogBytes: number;
  maxResultMessageBytes: number;
  outputPollMs: number;
}

const DEFAULT_LIMITS: AdapterLimits = {
  timeoutMs: 120_000,
  maxOutputBytes: 64 * 1024 * 1024,
  maxLogBytes: WORKBENCH_MAX_LOG_BYTES,
  maxResultMessageBytes: 1024 * 1024,
  outputPollMs: 250,
};

/** Internal test seam. API request data must never populate these values. */
export interface CapitalExecutionAdapterOptions {
  limits?: Partial<AdapterLimits>;
}

type WorkerSuccess = {
  type: "workbench-capital-result";
  protocol_version: 1;
  result: CapitalExecutionEvidence;
};

type WorkerFailure = {
  type: "workbench-capital-error";
  protocol_version: 1;
  error_class: string;
  safe_message: string;
  diagnostic: string;
};

let executionActive = false;

const RUN_ID_PATTERN = /^rr_[0-9a-f]{64}$/;
const EXECUTION_ATTEMPT_ID_PATTERN =
  /^ea_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/** Resolve existing ancestors before creation so symlinked parents cannot
 * defer a repository-overlap check until after mkdir has already written. */
function projectedRealPath(path: string): string {
  let cursor = resolve(path);
  const missing: string[] = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(basename(cursor));
    cursor = parent;
  }
  return resolve(realpathSync(cursor), ...missing);
}

function overlapsRepository(repositoryRoot: string, candidate: string): boolean {
  return isWithin(repositoryRoot, candidate) || isWithin(candidate, repositoryRoot);
}

function ensureNoSymlinkComponents(base: string, candidate: string): void {
  if (!isWithin(base, candidate)) {
    throw new CapitalExecutionError(
      "WORKBENCH_UNSAFE_STORAGE_ROOT",
      "The execution directory is outside the configured temporary run store.",
    );
  }
  const rel = relative(base, candidate);
  let cursor = base;
  for (const part of rel.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new CapitalExecutionError(
        "WORKBENCH_UNSAFE_STORAGE_ROOT",
        "Symbolic links are not allowed in an execution-attempt path.",
      );
    }
  }
}

function directorySize(path: string): number {
  if (!existsSync(path)) return 0;
  let found;
  try {
    found = lstatSync(path);
  } catch (error) {
    // The certified engine atomically renames temporary files. A file listed
    // by the monitor can legitimately disappear before lstat observes it.
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }
  if (found.isSymbolicLink()) {
    throw new CapitalExecutionError(
      "WORKBENCH_UNSAFE_STORAGE_ROOT",
      "Symbolic links are not allowed in engine output.",
    );
  }
  if (found.isFile()) return found.size;
  if (!found.isDirectory()) return 0;
  let names: string[];
  try {
    names = readdirSync(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }
  return names.reduce((sum, name) => sum + directorySize(resolve(path, name)), 0);
}

function validatedLimits(overrides: Partial<AdapterLimits> = {}): AdapterLimits {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new CapitalExecutionError(
        "WORKBENCH_INVALID_EXECUTION_INPUT",
        `Invalid internal execution limit: ${name}.`,
      );
    }
  }
  return limits;
}

function appendBoundedLog(
  current: string,
  chunk: Buffer | string,
  maximum: number,
): { text: string; exceeded: boolean } {
  const addition = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
  const combined = current + addition;
  if (Buffer.byteLength(combined) <= maximum) return { text: combined, exceeded: false };
  return {
    text: Buffer.from(combined).subarray(0, maximum).toString("utf8"),
    exceeded: true,
  };
}

function isWorkerSuccess(message: unknown): message is WorkerSuccess {
  if (!message || typeof message !== "object") return false;
  const value = message as Partial<WorkerSuccess>;
  return (
    value.type === "workbench-capital-result" &&
    value.protocol_version === 1 &&
    Boolean(value.result) &&
    typeof value.result === "object"
  );
}

function isWorkerFailure(message: unknown): message is WorkerFailure {
  if (!message || typeof message !== "object") return false;
  const value = message as Partial<WorkerFailure>;
  return (
    value.type === "workbench-capital-error" &&
    value.protocol_version === 1 &&
    typeof value.error_class === "string" &&
    typeof value.safe_message === "string" &&
    typeof value.diagnostic === "string"
  );
}

function terminateWorker(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const hardKill = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 2_000);
  hardKill.unref();
}

export async function executeCapitalResearchAttempt(
  input: CapitalExecutionInput,
  options: CapitalExecutionAdapterOptions = {},
): Promise<CapitalExecutionOutcome> {
  if (executionActive) {
    throw new CapitalExecutionError(
      "WORKBENCH_EXECUTION_BUSY",
      "One empirical research execution is already running.",
    );
  }
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).sort().join("|") !==
      "executionAttemptId|runId|transactionCostBps" ||
    !RUN_ID_PATTERN.test(input.runId) ||
    !EXECUTION_ATTEMPT_ID_PATTERN.test(input.executionAttemptId) ||
    (input.transactionCostBps !== 0 && input.transactionCostBps !== 5)
  ) {
    throw new CapitalExecutionError(
      "WORKBENCH_INVALID_EXECUTION_INPUT",
      "The capital execution request is outside the Phase B1 allowlist.",
    );
  }

  const limits = validatedLimits(options.limits);
  let repositoryRoot: string;
  try {
    repositoryRoot = resolveWorkbenchRepositoryRoot({ moduleUrl: import.meta.url });
  } catch (error) {
    throw new CapitalExecutionError(
      "WORKBENCH_UNSAFE_STORAGE_ROOT",
      "The fixed Allocation Lab repository root could not be resolved.",
      error instanceof Error ? error.message : "Repository marker discovery failed.",
    );
  }
  const configuredRoot = process.env.WORKBENCH_RUN_DIR ?? "/tmp/allocationlab-workbench-runs";
  if (!isAbsolute(configuredRoot)) {
    throw new CapitalExecutionError(
      "WORKBENCH_UNSAFE_STORAGE_ROOT",
      "WORKBENCH_RUN_DIR must be an absolute temporary-storage path.",
    );
  }
  const projectedStorageRoot = projectedRealPath(configuredRoot);
  if (
    projectedStorageRoot === "/" ||
    projectedStorageRoot === realpathSync(tmpdir()) ||
    overlapsRepository(repositoryRoot, projectedStorageRoot)
  ) {
    throw new CapitalExecutionError(
      "WORKBENCH_UNSAFE_STORAGE_ROOT",
      "The temporary run store may not overlap the repository.",
    );
  }
  mkdirSync(configuredRoot, { recursive: true });
  if (lstatSync(configuredRoot).isSymbolicLink()) {
    throw new CapitalExecutionError(
      "WORKBENCH_UNSAFE_STORAGE_ROOT",
      "WORKBENCH_RUN_DIR must be a real directory, not a symbolic link.",
    );
  }
  const storageRoot = realpathSync(configuredRoot);
  if (storageRoot === "/" || storageRoot === realpathSync(tmpdir()) ||
      overlapsRepository(repositoryRoot, storageRoot)) {
    throw new CapitalExecutionError(
      "WORKBENCH_UNSAFE_STORAGE_ROOT",
      "The temporary run store may not overlap the repository.",
    );
  }

  const attemptRoot = resolve(
    storageRoot,
    "runs",
    input.runId,
    "attempts",
    input.executionAttemptId,
  );
  const engineRoot = resolve(attemptRoot, "engine");
  ensureNoSymlinkComponents(storageRoot, attemptRoot);
  if (existsSync(engineRoot)) {
    throw new CapitalExecutionError(
      "WORKBENCH_ATTEMPT_ALREADY_EXISTS",
      "This immutable execution attempt already contains engine evidence.",
    );
  }
  mkdirSync(attemptRoot, { recursive: true });
  ensureNoSymlinkComponents(storageRoot, attemptRoot);
  if (!isWithin(storageRoot, realpathSync(attemptRoot))) {
    throw new CapitalExecutionError(
      "WORKBENCH_UNSAFE_STORAGE_ROOT",
      "The execution-attempt path escaped the temporary run store.",
    );
  }

  const workerPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "workbench-run-worker.mjs",
  );
  executionActive = true;
  try {
    return await new Promise<CapitalExecutionOutcome>((resolvePromise, rejectPromise) => {
      let settled = false;
      let boundedLogs = "";
      const child = fork(workerPath, [], {
        env: { ...process.env, WORKBENCH_RUN_DIR: storageRoot },
        execArgv: [],
        serialization: "json",
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });

      const finish = (
        error?: CapitalExecutionError,
        result?: CapitalExecutionEvidence,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearInterval(outputMonitor);
        let terminalError = error ?? (result ? undefined : new CapitalExecutionError(
          "WORKBENCH_WORKER_PROTOCOL_ERROR",
          "The empirical worker returned no result.",
          boundedLogs,
        ));
        let gracefulExitTimer: NodeJS.Timeout | undefined;
        const settleAfterExit = (code: number | null, signal: NodeJS.Signals | null) => {
          if (gracefulExitTimer) clearTimeout(gracefulExitTimer);
          if (terminalError) {
            rejectPromise(terminalError);
            return;
          }
          if (code !== 0 || signal !== null) {
            rejectPromise(new CapitalExecutionError(
              "WORKBENCH_WORKER_FAILED",
              "The empirical worker exited abnormally after returning its result.",
              `exit_code=${String(code)} signal=${String(signal)}\n${boundedLogs}`,
            ));
            return;
          }
          resolvePromise({ engineRoot, result: result!, boundedLogs });
        };

        if (terminalError) terminateWorker(child);
        else {
          try {
            if (child.connected) child.disconnect();
          } catch (disconnectError) {
            terminalError = new CapitalExecutionError(
              "WORKBENCH_WORKER_FAILED",
              "The empirical worker could not close after returning its result.",
              String(disconnectError),
            );
            terminateWorker(child);
          }
          if (!terminalError) {
            gracefulExitTimer = setTimeout(() => {
              terminalError = new CapitalExecutionError(
                "WORKBENCH_EXECUTION_TIMEOUT",
                "The empirical worker did not exit within its bounded completion window.",
                boundedLogs,
              );
              terminateWorker(child);
            }, 2_000);
            gracefulExitTimer.unref();
          }
        }
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
          settleAfterExit(child.exitCode, child.signalCode);
        } else {
          // Do not release the global execution lease until the fixed child is
          // confirmed dead. This prevents a timed-out process from overlapping
          // a subsequent attempt while SIGTERM/SIGKILL is still in flight.
          child.once("exit", settleAfterExit);
        }
      };

      const capture = (chunk: Buffer | string) => {
        const next = appendBoundedLog(boundedLogs, chunk, limits.maxLogBytes);
        boundedLogs = next.text;
        if (next.exceeded) {
          finish(
            new CapitalExecutionError(
              "WORKBENCH_LOG_LIMIT_EXCEEDED",
              "The empirical worker exceeded its log-size limit.",
              boundedLogs,
            ),
          );
        }
      };
      child.stdout?.on("data", capture);
      child.stderr?.on("data", capture);

      const timeout = setTimeout(() => {
        finish(
          new CapitalExecutionError(
            "WORKBENCH_EXECUTION_TIMEOUT",
            "The empirical execution exceeded its bounded timeout.",
            boundedLogs,
          ),
        );
      }, limits.timeoutMs);

      const outputMonitor = setInterval(() => {
        if (settled) return;
        try {
          if (directorySize(engineRoot) > limits.maxOutputBytes) {
            finish(
              new CapitalExecutionError(
                "WORKBENCH_OUTPUT_LIMIT_EXCEEDED",
                "The empirical execution exceeded its output-size limit.",
                boundedLogs,
              ),
            );
          }
        } catch (error) {
          finish(
            error instanceof CapitalExecutionError
              ? error
              : new CapitalExecutionError(
                  "WORKBENCH_WORKER_FAILED",
                  "The empirical output directory could not be inspected safely.",
                  String(error),
                ),
          );
        }
      }, limits.outputPollMs);

      child.on("message", (message: unknown) => {
        let encodedBytes: number;
        try {
          encodedBytes = Buffer.byteLength(JSON.stringify(message));
        } catch {
          encodedBytes = limits.maxResultMessageBytes + 1;
        }
        if (encodedBytes > limits.maxResultMessageBytes) {
          finish(
            new CapitalExecutionError(
              "WORKBENCH_OUTPUT_LIMIT_EXCEEDED",
              "The empirical worker result exceeded its response-size limit.",
              boundedLogs,
            ),
          );
          return;
        }
        if (isWorkerSuccess(message)) {
          if (
            message.result.adapter_version !== WORKBENCH_ADAPTER_VERSION ||
            message.result.pit_classification !== WORKBENCH_PIT_CLASSIFICATION ||
            message.result.storage_status !== WORKBENCH_STORAGE_STATUS ||
            message.result.real_money_boundary !== WORKBENCH_REAL_MONEY_BOUNDARY ||
            message.result.requested_transaction_cost_bps !== input.transactionCostBps
          ) {
            finish(
              new CapitalExecutionError(
                "WORKBENCH_WORKER_PROTOCOL_ERROR",
                "The empirical worker returned inconsistent execution metadata.",
                boundedLogs,
              ),
            );
            return;
          }
          try {
            if (directorySize(engineRoot) > limits.maxOutputBytes) {
              finish(
                new CapitalExecutionError(
                  "WORKBENCH_OUTPUT_LIMIT_EXCEEDED",
                  "The empirical execution exceeded its output-size limit.",
                  boundedLogs,
                ),
              );
              return;
            }
          } catch (error) {
            finish(
              new CapitalExecutionError(
                "WORKBENCH_WORKER_FAILED",
                "The completed empirical output could not be inspected safely.",
                String(error),
              ),
            );
            return;
          }
          finish(undefined, message.result);
          return;
        }
        if (isWorkerFailure(message)) {
          finish(
            new CapitalExecutionError(
              "WORKBENCH_WORKER_FAILED",
              message.safe_message,
              [message.error_class, message.diagnostic, boundedLogs].filter(Boolean).join("\n"),
            ),
          );
          return;
        }
        finish(
          new CapitalExecutionError(
            "WORKBENCH_WORKER_PROTOCOL_ERROR",
            "The empirical worker returned an invalid protocol message.",
            boundedLogs,
          ),
        );
      });

      child.once("error", (error) => {
        finish(
          new CapitalExecutionError(
            "WORKBENCH_WORKER_FAILED",
            "The empirical worker could not be started.",
            `${String(error)}\n${boundedLogs}`,
          ),
        );
      });
      child.once("exit", (code, signal) => {
        if (!settled) {
          finish(
            new CapitalExecutionError(
              "WORKBENCH_WORKER_FAILED",
              "The empirical worker exited before returning a result.",
              `exit_code=${String(code)} signal=${String(signal)}\n${boundedLogs}`,
            ),
          );
        }
      });

      child.send({
        type: "execute-workbench-capital",
        protocol_version: 1,
        run_id: input.runId,
        execution_attempt_id: input.executionAttemptId,
        transaction_cost_bps: input.transactionCostBps,
      });
    });
  } finally {
    executionActive = false;
  }
}
