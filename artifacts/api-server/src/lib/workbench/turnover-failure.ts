import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { type AttemptRef, WorkbenchRunStore } from "./run-store";
import { attachSafeFailure, infrastructureFailure } from "./failure-diagnostics";
import { RECURRING_V2, productCampaign, type NormalizedProduct } from "./turnover-product";
import { loadDatasetV2 } from "./calendar-v2";
const { hash, generateCandidates } = require("../../../../../research/capital/spec") as any;
const { selectRecurring } = require("../../../../../research/workbench/turnover-selection") as any;

/** Exact actual-job classification; no worker text/stack is exposed. */
export async function recurringFailure(ref: AttemptRef, store: WorkbenchRunStore, spec: NormalizedProduct, errorClass: string) {
  const fallback = { ...infrastructureFailure(errorClass, "") };
  const base = resolve(store.root, "runs", ref.runId, "attempts", ref.executionAttemptId, "engine");
  async function read(path: string) {
    const file = resolve(base, path), rel = relative(store.root, file);
    if (isAbsolute(rel) || rel.split(sep).includes("..")) throw new Error("Unsafe failure evidence");
    let cursor = store.root;
    for (const part of rel.split(sep)) { cursor = resolve(cursor, part); if ((await lstat(cursor)).isSymbolicLink()) throw new Error("Unsafe failure symlink"); }
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > store.limits.maxEngineOutputBytes || !(await realpath(file)).startsWith(store.root + sep)) throw new Error("Unbounded failure evidence");
    return JSON.parse((await readFile(file)).toString());
  }
  try {
    const summary = await read("summary.json");
    const fold = summary.selected_by_fold.find((f: any) => f.status === "NO_ELIGIBLE_CANDIDATE");
    if (!fold) return fallback;
    const campaign = productCampaign(spec, loadDatasetV2());
    const candidates = generateCandidates(campaign).candidates;
    const jobs = await Promise.all(candidates.map(async (c: any) => {
      const envelope = await read(`jobs/${c.candidate_id}/outer-${fold.outer_fold}/inner-train/scenario-${spec.selection_cost_bps}.json`);
      if (envelope.result_hash !== hash(envelope.result) || envelope.job_hash !== hash(envelope.identity)) throw new Error("Failure job hash mismatch");
      return envelope.result;
    }));
    const selected = selectRecurring(campaign, candidates.map((c: any, i: number) => ({ candidate: c, status: jobs[i].status,
      metrics: jobs[i].metrics, complexity: Object.keys(c.spec.model_parameters).length + c.spec.transformations.length + Object.keys(c.spec.exposure_parameters).length })), jobs, fold.outer_fold);
    if (selected.winner) return fallback;
    const status = selected.ranking.every((r: any) => r.status === "CONSTRAINT_REJECTED") ? "NO_VALID_CANDIDATE"
      : jobs.every(j => j.status === "VALID" && j.metrics?.net_sharpe === null) ? "INSUFFICIENT_SELECTION_HISTORY"
      : "UNCLASSIFIED_CANDIDATE_FAILURE";
    const allTurnoverRejected = selected.ranking.every((r: any) => selected.turnover_evidence[r.candidate.candidate_id]?.turnover_constraint_status === "CONSTRAINT_REJECTED");
    const message = status === "NO_VALID_CANDIDATE" ? allTurnoverRejected
      ? `No exposure policy satisfied the recurring-turnover constraint in training fold ${fold.outer_fold}.`
      : `No exposure policy satisfied the configured research constraints in training fold ${fold.outer_fold}.`
      : status === "INSUFFICIENT_SELECTION_HISTORY" ? `The candidate-selection score was undefined in training fold ${fold.outer_fold}.`
      : `Candidate execution in fold ${fold.outer_fold} needs owner review.`;
    const safe = { error_class: status, failed_stage: "CANDIDATE_SELECTION", failed_fold_id: fold.outer_fold,
      failed_decision_date: spec.evaluation_start, safe_message: message,
      actionable_explanation: "The actual training ledgers and candidate scores were inspected under the recurring-turnover V2 rule. Initial implementation was still costed and was excluded only from the turnover eligibility numerator.",
      suggested_user_action: "Review the verified rejected constraint in technical details, then explicitly preview a revised design.",
      diagnostic_reference: `runs/${ref.runId}/attempts/${ref.executionAttemptId}/diagnostic.json`,
      turnover_constraint_methodology_version: RECURRING_V2,
      candidates: selected.ranking.map((r: any) => ({ candidate_id: r.candidate.candidate_id, exposure_policy: r.candidate.spec.exposure_policy,
        parameters: r.candidate.spec.exposure_parameters, status: r.status, reason: r.reason, ...selected.turnover_evidence[r.candidate.candidate_id] })) };
    safe.failed_decision_date = loadDatasetV2().rows.find(r => r.date >= fold.test_start)!.date;
    return safe;
  } catch { return fallback; }
}
export async function enrichRecurringFailures(run: any, store: WorkbenchRunStore) {
  const evidence = new Map<string, any>();
  for (const a of run.attempt_history) if (a.status === "FAILED") {
    const result = await store.readAttemptResult({ runId: run.run_id, executionAttemptId: a.execution_attempt_id }) as any;
    if (result?.safe_message && result?.error_class) evidence.set(a.execution_attempt_id, result);
  }
  const decorate = (a: any) => a && evidence.has(a.execution_attempt_id) ? attachSafeFailure(a, evidence.get(a.execution_attempt_id)) : a;
  return { ...run, attempt_history: run.attempt_history.map(decorate), latest_attempt: decorate(run.latest_attempt) };
}
