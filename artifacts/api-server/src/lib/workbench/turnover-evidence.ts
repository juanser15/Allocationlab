import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve, relative, sep, isAbsolute } from "node:path";
import { type EngineArtifactManifest, WorkbenchRunStore } from "./run-store";
import { sha256, type DatasetV2, campaignV2 } from "./calendar-v2";
import { RECURRING_V2, TOTAL_V1, productModelDefinition } from "./turnover-product";
const { ledgerTurnover, turnoverConstraint } = require("../../../../../research/workbench/turnover-selection") as {
  ledgerTurnover(ledger: any[], count: number, bps: number): any;
  turnoverConstraint(e: any, limit: number, version: string): any;
};
const { generateCandidates, hash } = require("../../../../../research/capital/spec") as { generateCandidates(c: unknown): { candidates: any[] }; hash(x: unknown): string };
export const methodologyOf = (spec: any) => spec.turnover_constraint_methodology_version ?? TOTAL_V1;

/** Additive public evidence, never a rewrite of an original result or hash. */
export async function enrichTurnoverEvidence(run: any, store: WorkbenchRunStore, data: DatasetV2) {
  const version = methodologyOf(run.spec);
  const publicFailure = (value: any) => {
    if (version !== RECURRING_V2 || !value || value.status !== "FAILED" || !value.safe_message) return value;
    // A failure is a presentation envelope, not a new financial result. Do not
    // embed the whole immutable result recursively inside an attempt diagnostic.
    const d = value.failure_diagnostic?.failure_diagnostic ?? value.failure_diagnostic;
    const reference = `runs/${run.run_id}/attempts/${value.execution_attempt_id}/diagnostic.json`;
    return { ...value, diagnostic_reference: reference, failure_diagnostic: {
      candidates: Array.isArray(d?.candidates) ? d.candidates : [],
      turnover_constraint_methodology_version: version, private_content_exposed: false,
    } };
  };
  async function enrich(result: any) {
    if (!result || typeof result !== "object") return result;
    const metadata = { turnover_constraint_methodology_version: version,
      provenance: { ...result.provenance, turnover_constraint_methodology_version: version } };
    if (result.status !== "SUCCESS") return { ...publicFailure(result), ...metadata };
    await store.getAttempt({ runId: result.run_id, executionAttemptId: result.execution_attempt_id });
    async function boundedFile(file: string, maximum: number) {
      const rel = relative(store.root, file);
      if (!rel || isAbsolute(rel) || rel.split(sep).includes("..")) throw new Error("Unsafe turnover evidence path");
      let cursor = store.root;
      for (const part of rel.split(sep)) { cursor = resolve(cursor, part); if ((await lstat(cursor)).isSymbolicLink()) throw new Error("Unsafe turnover evidence symlink"); }
      const info = await lstat(file);
      if (!info.isFile() || info.size > maximum || !(await realpath(file)).startsWith(store.root + sep)) throw new Error("Unbounded turnover evidence");
      return readFile(file);
    }
    const manifest: EngineArtifactManifest = JSON.parse((await boundedFile(resolve(store.root, "runs", result.run_id, "attempts", result.execution_attempt_id, "artifact-manifest.json"), store.limits.maxMetadataBytes)).toString());
    if (manifest.run_id !== result.run_id || manifest.execution_attempt_id !== result.execution_attempt_id) throw new Error("Turnover manifest identity differs");
    const entries = new Map(manifest.files.map(f => [f.path, f]));
    const base = resolve(store.root, "runs", result.run_id, "attempts", result.execution_attempt_id, "engine");
    async function readJob(path: string) {
      const entry = entries.get(path);
      if (!entry) throw new Error("Turnover evidence is absent from the sealed artifact manifest");
      let cursor = store.root;
      const file = resolve(base, path), rel = relative(store.root, file);
      if (isAbsolute(rel) || rel.split(sep).includes("..")) throw new Error("Unsafe turnover evidence path");
      for (const part of rel.split(sep)) { cursor = resolve(cursor, part); if ((await lstat(cursor)).isSymbolicLink()) throw new Error("Unsafe turnover evidence symlink"); }
      if (!(await realpath(file)).startsWith(store.root + sep) || (await lstat(file)).size > store.limits.maxEngineOutputBytes) throw new Error("Unbounded turnover evidence");
      const bytes = await readFile(file);
      if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error("Sealed turnover evidence changed");
      const envelope = JSON.parse(bytes.toString());
      if (envelope.result_hash !== hash(envelope.result) || envelope.job_hash !== hash(envelope.identity)) throw new Error("Turnover job hash differs");
      return envelope.result;
    }
    const candidates = generateCandidates(campaignV2(run.spec, data)).candidates;
    const selected = result.validation_diagnostics.selected_jobs;
    const byFold: any[] = [], candidateEvidence: any[] = [];
    const totals = { initial_implementation_turnover: 0, recurring_gross_turnover: 0, total_gross_turnover: 0,
      initial_implementation_cost: 0, recurring_simulated_cost: 0, realized_simulated_cost: 0 };
    for (const selectedJob of selected) {
      const foldId = selectedJob.outer_fold;
      const outer = await readJob(`jobs/${selectedJob.candidate_id}/outer-${foldId}/inner-outer/scenario-${run.spec.transaction_cost_bps}.json`);
      const oos = ledgerTurnover(outer.ledger, outer.observations.length, run.spec.transaction_cost_bps);
      for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += oos[key];
      const trainingCandidates = [];
      for (const candidate of candidates) {
        const job = await readJob(`jobs/${candidate.candidate_id}/outer-${foldId}/inner-train/scenario-${run.spec.selection_cost_bps}.json`);
        const evidence = job.status === "VALID" ? turnoverConstraint(ledgerTurnover(job.ledger, job.observations.length, run.spec.selection_cost_bps), data.fixture.constraints.max_turnover, version) : { status: "NOT_SUPPORTED", reason: job.status };
        trainingCandidates.push({ candidate_id: candidate.candidate_id, exposure_policy: candidate.spec.exposure_policy, parameters: candidate.spec.exposure_parameters,
          selection_metric: job.metrics?.net_sharpe ?? "NOT_SUPPORTED", ...evidence });
      }
      const train = trainingCandidates.find(c => c.candidate_id === selectedJob.candidate_id);
      candidateEvidence.push({ fold_id: foldId, candidates: trainingCandidates });
      byFold.push({ fold_id: foldId, candidate_id: selectedJob.candidate_id, ...train, oos_turnover: oos });
    }
    const n = result.metrics.observations;
    const aggregate = { ...totals, annualized_total_turnover: totals.total_gross_turnover * 252 / n,
      annualized_recurring_turnover: totals.recurring_gross_turnover * 252 / n, annualization_observations: n,
      meaning: "Sum of independent OOS fold books: each fold has its own costed implementation; annualization uses the full aligned OOS observation count." };
    const benchmarkTurnover: Record<string, unknown> = {};
    if (result.benchmark_tracks && typeof result.benchmark_tracks === "object") {
      for (const [name, track] of Object.entries(result.benchmark_tracks) as [string, any][]) {
        if (!Array.isArray(track.points) || !track.points.length) { benchmarkTurnover[name] = "NOT_SUPPORTED"; continue; }
        const perFold = new Map<number, any[]>();
        for (const p of track.points) { const rows = perFold.get(p.fold_id) ?? []; rows.push(p); perFold.set(p.fold_id, rows); }
        const books = [...perFold].map(([fold_id, points]) => {
          if (name === "DYNAMIC_EXPOSURE") return { fold_id, ...byFold.find(f => f.fold_id === fold_id)?.oos_turnover };
          // These are the control engine's actual self-financing fills, not
          // target differences. Pre-cost NAV = ending NAV + actual fill cost.
          const ledger = points.map((p: any) => ({ date: p.date, trades: p.actual_traded_notional > 0 ? [{ notional: p.actual_traded_notional }] : [],
            beginningNav: p.ending_nav + p.realized_cost, etfPnl: 0, cashPnl: 0, transactionCosts: p.realized_cost }));
          return { fold_id, ...ledgerTurnover(ledger, points.length, run.spec.transaction_cost_bps) };
        });
        benchmarkTurnover[name] = { per_fold: books, total_gross_turnover: books.reduce((s,b) => s + b.total_gross_turnover, 0),
          recurring_gross_turnover: books.reduce((s,b) => s + b.recurring_gross_turnover, 0),
          initial_implementation_turnover: books.reduce((s,b) => s + b.initial_implementation_turnover, 0),
          realized_simulated_cost: books.reduce((s,b) => s + b.realized_simulated_cost, 0),
          source: "ACTUAL_CONTROL_FILL_LEDGER_OUTPUTS", benchmark_hash_unchanged: true };
      }
    }
    const current = version === RECURRING_V2;
    return { ...result, ...metadata, model_definition: current ? productModelDefinition(data) : { ...result.model_definition, turnover_constraint_methodology_version: version },
      turnover: { methodology_version: version, candidate_training_by_fold: candidateEvidence, selected_policy_by_fold: byFold, oos: aggregate, benchmark_tracks: benchmarkTurnover },
      metrics: current ? { ...result.metrics, ...aggregate } : result.metrics,
      selected_policy_by_fold: Array.isArray(result.selected_policy_by_fold) ? result.selected_policy_by_fold.map((p: any) => ({ ...p,
        turnover_constraint_methodology_version: version, training_turnover: byFold.find(f => f.fold_id === (p.fold_id ?? p.outer_fold ?? p.fold)),
        oos_turnover: byFold.find(f => f.fold_id === (p.fold_id ?? p.outer_fold ?? p.fold))?.oos_turnover })) : result.selected_policy_by_fold,
      warnings: [...result.warnings, ...(current && byFold.some(f => f.warnings?.includes("NO_RECURRING_REBALANCE_OBSERVED")) ? ["NO_RECURRING_REBALANCE_OBSERVED"] : [])] };
  }
  const success = await enrich(run.latest_successful_result);
  const latest = run.latest_result?.execution_attempt_id && run.latest_result.execution_attempt_id === run.latest_successful_result?.execution_attempt_id
    ? success : await enrich(run.latest_result);
  return { ...run, turnover_constraint_methodology_version: version,
    attempt_history: run.attempt_history.map(publicFailure), latest_attempt: publicFailure(run.latest_attempt),
    latest_result: latest, latest_successful_result: success,
    provenance: { ...run.provenance, turnover_constraint_methodology_version: version } };
}
