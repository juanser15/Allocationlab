import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  readFile,
  writeFile,
  link,
  unlink,
  realpath,
} from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { canonicalJson } from "./identity";
import {
  campaignV2,
  loadDatasetV2,
  planCalendarV2,
  type NormalizedSpecV2,
} from "./calendar-v2";
import { WorkbenchRunStore, type AttemptRef } from "./run-store";
const { generateCandidates, hash } =
  require("../../../../../research/capital/spec") as {
    generateCandidates(c: unknown): { candidates: any[] };
    hash(value: unknown): string;
  };
const { select } = require("../../../../../research/capital/metrics") as {
  select(c: unknown, ranked: any[]): { ranking: any[]; winner?: unknown };
};
const digest = (x: string | Buffer) =>
  createHash("sha256").update(x).digest("hex");
const VERSION = "workbench-failure-diagnostic-1.0.0";
export interface SafeFailure {
  error_class: string;
  failed_stage: string;
  failed_fold_id: number | null;
  failed_decision_date: string | null;
  safe_message: string;
  actionable_explanation: string;
  suggested_user_action: string;
  diagnostic_reference: string;
}
export function attachSafeFailure(
  value: any,
  diagnostic: SafeFailure & Record<string, unknown>,
) {
  const {
    error_class,
    failed_stage,
    failed_fold_id,
    failed_decision_date,
    safe_message,
    actionable_explanation,
    suggested_user_action,
    diagnostic_reference,
  } = diagnostic;
  // Diagnostic schema version is separate from the result's V2 contract.
  return {
    ...value,
    error_class,
    failed_stage,
    failed_fold_id,
    failed_decision_date,
    safe_message,
    actionable_explanation,
    suggested_user_action,
    diagnostic_reference,
    error_message: safe_message,
    failure_diagnostic: diagnostic,
  };
}
const defaultAction =
  "Do not resubmit repeatedly. The owner must inspect the preserved private diagnostic and resolve the reported cause before an explicit rerun. No input was changed automatically.";
function failure(
  error_class: string,
  failed_stage: string,
  safe_message: string,
  actionable_explanation: string,
  suggested_user_action = defaultAction,
): SafeFailure {
  return {
    error_class,
    failed_stage,
    failed_fold_id: null,
    failed_decision_date: null,
    safe_message,
    actionable_explanation,
    suggested_user_action,
    diagnostic_reference: "NOT_AVAILABLE",
  };
}
/** Map only allowlisted classes and known bounded evidence. Never copy raw
 * messages, stacks, stderr, paths or environment values to a public field. */
export function infrastructureFailure(
  code: string | null,
  privateDetail: string,
): SafeFailure {
  if (
    [
      "WORKBENCH_OUTPUT_LIMIT_EXCEEDED",
      "WORKBENCH_LOG_LIMIT_EXCEEDED",
      "ENGINE_FILE_LIMIT_EXCEEDED",
      "ENGINE_OUTPUT_LIMIT_EXCEEDED",
    ].includes(code ?? "") ||
    /Engine output exceeds its (file-count|byte) limit/.test(privateDetail)
  ) {
    return failure(
      "OUTPUT_OR_LOG_LIMIT",
      "OUTPUT_OR_LOG_BOUND",
      "The attempt exceeded an unchanged research output or log bound.",
      "The worker output, log, message or immutable artifact budget could not accommodate this exact design. The private evidence identifies the bound.",
    );
  }
  if (code === "WORKBENCH_EXECUTION_TIMEOUT")
    return failure(
      "WORKER_EXECUTION_TIMEOUT",
      "WORKER_EXECUTION",
      "The attempt reached its bounded execution timeout.",
      "This is a worker resource boundary, not evidence of an invalid financial selection metric.",
    );
  if (
    code === "WORKBENCH_WORKER_PROTOCOL_ERROR" ||
    /result exceeded|returned an invalid protocol|identity.*match/i.test(
      privateDetail,
    )
  )
    return failure(
      "WORKER_PROTOCOL_FAILURE",
      "WORKER_PROTOCOL",
      "The parent could not accept the empirical worker result.",
      "The worker protocol or result identity could not be verified. This is an infrastructure issue; changing the training window is not a verified remedy.",
    );
  if (
    code === "WORKBENCH_UNSAFE_STORAGE_ROOT" ||
    /could not be started|exit_code=|signal=/.test(privateDetail)
  )
    return failure(
      "WORKER_PROTOCOL_FAILURE",
      "WORKER_EXECUTION",
      "The empirical worker could not complete its process lifecycle.",
      "No validated financial result was received. The preserved private diagnostic identifies the worker or storage lifecycle failure.",
    );
  return failure(
    "UNCLASSIFIED_EXECUTION_FAILURE",
    "EMPIRICAL_EXECUTION",
    "The attempt failed without sufficient structured evidence to classify its cause.",
    "The original bounded internal diagnostic is preserved privately. No financial-design diagnosis or corrective window change is inferred from the generic worker message.",
  );
}
async function boundedRead(
  store: WorkbenchRunStore,
  path: string,
  maxBytes: number,
) {
  const rel = relative(store.root, path);
  if (!rel || isAbsolute(rel) || rel.split(sep).includes(".."))
    throw new Error("Unsafe diagnostic reference");
  let current = store.root;
  for (const part of rel.split(sep)) {
    current = resolve(current, part);
    if ((await lstat(current)).isSymbolicLink())
      throw new Error("Unsafe diagnostic symlink");
  }
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.size > maxBytes ||
    !(await realpath(path)).startsWith(store.root + sep)
  )
    throw new Error("Unbounded diagnostic evidence");
  return readFile(path);
}
async function createDiagnostic(
  store: WorkbenchRunStore,
  ref: AttemptRef,
  spec: NormalizedSpecV2,
) {
  const attempt = await store.getAttempt(ref);
  if (attempt.status !== "FAILED") return undefined;
  const prefix = `runs/${ref.runId}/attempts/${ref.executionAttemptId}`;
  const reference = `${prefix}/failure-diagnostic-v1.json`,
    destination = resolve(store.root, reference);
  const evidenceHashes: Record<string, string> = {};
  const read = async (
    rel: string,
    maxBytes = store.limits.maxMetadataBytes,
  ) => {
    const bytes = await boundedRead(
      store,
      resolve(store.root, prefix, rel),
      maxBytes,
    );
    evidenceHashes[rel] = digest(bytes);
    return JSON.parse(bytes.toString());
  };
  try {
    const cached = JSON.parse(
      (
        await boundedRead(store, destination, store.limits.maxMetadataBytes)
      ).toString(),
    );
    if (
      cached.sha256 !== digest(canonicalJson(cached.payload)) ||
      cached.payload.contract_version !== VERSION
    )
      throw new Error("Immutable diagnostic hash mismatch");
    for (const [path, expected] of Object.entries(
      cached.payload.evidence_sha256 as Record<string, string>,
    )) {
      if (!/^[a-f0-9]{64}$/.test(expected)) continue;
      const bytes = await boundedRead(
        store,
        resolve(store.root, prefix, path),
        Math.min(store.limits.maxEngineOutputBytes, 8 * 1024 * 1024),
      );
      if (digest(bytes) !== expected)
        throw new Error("Original failed-attempt evidence changed");
    }
    return cached.payload;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const internal = await read("diagnostic.json");
  let safe = infrastructureFailure(
    attempt.terminal?.error_class ?? null,
    JSON.stringify(internal),
  );
  let candidateEvidence: unknown[] = [];
  try {
    const summary = await read("engine/summary.json");
    const first = summary.selected_by_fold?.find(
      (f: any) => f.status === "NO_ELIGIBLE_CANDIDATE",
    );
    if (
      first &&
      Number.isSafeInteger(first.outer_fold) &&
      first.outer_fold >= 0
    ) {
      const data = loadDatasetV2(),
        campaign = campaignV2(spec, data);
      const fold = planCalendarV2(spec, data).folds.find(
        (f) => f.fold_id === first.outer_fold,
      );
      if (!fold) throw new Error("Unknown failure fold");
      const candidates = generateCandidates(campaign).candidates;
      const raw = await Promise.all(
        candidates.map(async (c) => {
          const job = await read(
            `engine/jobs/${c.candidate_id}/outer-${fold.fold_id}/inner-train/scenario-${spec.selection_cost_bps}.json`,
            Math.min(store.limits.maxEngineOutputBytes, 8 * 1024 * 1024),
          );
          if (
            job.job_hash !== hash(job.identity) ||
            job.result_hash !== hash(job.result) ||
            job.result.candidate_id !== c.candidate_id ||
            job.result.outer_fold !== fold.fold_id ||
            job.result.stage !== "train" ||
            job.result.scenario !== spec.selection_cost_bps
          )
            throw new Error("Training job diagnostic identity mismatch");
          return { candidate: c, job: job.result };
        }),
      );
      const ranked = select(
        campaign,
        raw.map(({ candidate, job }) => ({
          candidate,
          status: job.status,
          metrics: job.metrics,
          complexity: 0,
        })),
      ).ranking;
      if (ranked.some((r) => r.status === "VALID"))
        throw new Error("Selection evidence disagrees with summary");
      candidateEvidence = raw.map(({ candidate, job }) => {
        const r = ranked.find(
          (r) => r.candidate.candidate_id === candidate.candidate_id,
        );
        const m = job.metrics;
        const breaches = !m
          ? []
          : [
              ...(m.turnover_annualized > campaign.constraints.max_turnover
                ? ["MAXIMUM_ANNUALIZED_TURNOVER"]
                : []),
              ...(-m.max_drawdown > campaign.constraints.max_drawdown
                ? ["MAXIMUM_DRAWDOWN"]
                : []),
              ...(m.exposure < campaign.constraints.min_exposure
                ? ["MINIMUM_EXPOSURE"]
                : []),
              ...(m.exposure > campaign.constraints.max_exposure
                ? ["MAXIMUM_EXPOSURE"]
                : []),
            ];
        return {
          candidate_id: candidate.candidate_id,
          exposure_policy: candidate.spec.exposure_policy,
          parameters: candidate.spec.exposure_parameters,
          training_observations: job.observations.length,
          selection_metric_value:
            typeof m?.net_sharpe === "number" ? m.net_sharpe : "UNDEFINED",
          annualized_turnover: m?.turnover_annualized ?? "NOT_SUPPORTED",
          maximum_drawdown: m?.max_drawdown ?? "NOT_SUPPORTED",
          average_exposure: m?.exposure ?? "NOT_SUPPORTED",
          validity_status: job.status,
          constraint_status: r.status,
          violated_constraints: breaches,
        };
      });
      const defined = raw.filter(({ job }) =>
        Number.isFinite(job.metrics?.net_sharpe),
      );
      if (
        raw.every(({ job }) => job.status === "VALID") &&
        defined.length === raw.length &&
        ranked.every((r) => r.status === "CONSTRAINT_REJECTED")
      ) {
        safe = failure(
          "NO_VALID_CANDIDATE",
          "CANDIDATE_SELECTION",
          `All exposure policies were rejected in fold ${fold.fold_id} by the configured research constraints.`,
          `The ${fold.training_observations}-observation training interval produced defined net-Sharpe scores, but none passed the fixed constraints. Candidate-level constraint breaches are recorded below.`,
          "Review the rejected constraint and training sample, then preview a revised design. No dates, training window, model, policies or constraints were changed automatically.",
        );
      } else if (
        raw.every(({ job }) => job.status === "VALID") &&
        !defined.length
      ) {
        safe = failure(
          "INSUFFICIENT_SELECTION_HISTORY",
          "CANDIDATE_SELECTION",
          `No candidate-selection metric was defined in fold ${fold.fold_id}.`,
          `The training interval contains ${fold.training_observations} observations, but the certified net-Sharpe calculation is undefined for every policy.`,
          "Review the usable training returns and their variance. Preview a revised design; a longer window is not assumed to cure undefined variance.",
        );
      } else if (
        raw.some(({ job }) =>
          /Incomplete regime information history|Missing.*price|Insufficient.*data|Need at least/.test(
            String(job.error ?? ""),
          ),
        )
      ) {
        safe = failure(
          "DATA_AVAILABILITY_FAILURE",
          "CANDIDATE_INPUT",
          `The information universe was incomplete at the decision date for fold ${fold.fold_id}.`,
          "One or more actual candidate jobs could not obtain the required point-in-time information history.",
          "Review the requested data coverage and history requirements. The dataset has not been substituted and no dates were moved.",
        );
      } else {
        safe = failure(
          "UNCLASSIFIED_CANDIDATE_FAILURE",
          "CANDIDATE_EXECUTION",
          `The committed engine could not produce an eligible candidate in fold ${fold.fold_id}.`,
          "Actual job statuses do not support a simple history-only or constraint-only explanation. The owner must review the preserved internal evidence; no model or constraint has been changed.",
        );
      }
      safe.failed_fold_id = fold.fold_id;
      safe.failed_decision_date = fold.decision_date;
    }
  } catch (error) {
    // If a partial engine tree cannot be safely consumed, retain the explicit
    // infrastructure/unclassified diagnostic. Never expose that read error.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      evidenceHashes["structured_evidence_status"] = "NOT_SAFELY_AVAILABLE";
  }
  safe.diagnostic_reference = reference;
  const payload = {
    ...safe,
    contract_version: VERSION,
    candidates: candidateEvidence,
    private_diagnostic_reference: `${prefix}/diagnostic.json`,
    private_content_exposed: false,
    evidence_sha256: evidenceHashes,
  };
  const bytes = Buffer.from(
    canonicalJson({ sha256: digest(canonicalJson(payload)), payload }),
  );
  if (bytes.length > store.limits.maxMetadataBytes)
    throw new Error("Bounded failure diagnostic too large");
  const pending = resolve(
    store.root,
    prefix,
    `.failure-pending-${randomUUID()}`,
  );
  await writeFile(pending, bytes, { flag: "wx", mode: 0o600 });
  try {
    await link(pending, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (
      !(
        await boundedRead(store, destination, store.limits.maxMetadataBytes)
      ).equals(bytes)
    )
      throw new Error("Immutable failure evidence differs");
  } finally {
    await unlink(pending);
  }
  return payload;
}
/** Append-only diagnostic enrichment. All original attempt/result/engine bytes
 * and prior financial identities remain untouched, including existing failures. */
export async function enrichFailureDiagnostics<
  T extends {
    spec: unknown;
    attempt_history: any[];
    latest_attempt: any;
    latest_result: any;
    run_id: string;
  },
>(run: T, store: WorkbenchRunStore) {
  const diagnostics = new Map<
    string,
    Awaited<ReturnType<typeof createDiagnostic>>
  >();
  for (const a of run.attempt_history)
    if (a.status === "FAILED") {
      const ref = {
        runId: run.run_id,
        executionAttemptId: a.execution_attempt_id,
      };
      try {
        diagnostics.set(
          a.execution_attempt_id,
          await createDiagnostic(store, ref, run.spec as NormalizedSpecV2),
        );
      } catch {
        diagnostics.set(a.execution_attempt_id, {
          ...failure(
            "DIAGNOSTIC_EVIDENCE_UNAVAILABLE",
            "DIAGNOSTIC_READ",
            "Failure evidence could not be read safely.",
            "The original failed attempt is retained. The owner must inspect its private storage integrity before retrying.",
          ),
          diagnostic_reference: "NOT_SAFELY_AVAILABLE",
          contract_version: VERSION,
          candidates: [],
          private_diagnostic_reference: "NOT_SAFELY_AVAILABLE",
          private_content_exposed: false,
          evidence_sha256: {},
        });
      }
    }
  const decorate = (a: any) => {
    const d = a && diagnostics.get(a.execution_attempt_id);
    return d ? attachSafeFailure(a, d) : a;
  };
  return {
    ...run,
    attempt_history: run.attempt_history.map(decorate),
    latest_attempt: decorate(run.latest_attempt),
    latest_result: decorate(run.latest_result),
  };
}
