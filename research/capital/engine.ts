import assert from "node:assert/strict";
import { existsSync, readdirSync, appendFileSync, readFileSync } from "node:fs";
import { runBacktestEngine, defaultBacktestConfig, type PriceRow, type BacktestLedgerEntry } from "../../artifacts/api-server/src/lib/calculator";
import { canonical, hash, generateCandidates, makeFolds, innerFolds, type Campaign, type Candidate, type Fold, type Frequency } from "./spec";
import { defaultRegistry, modelSpec, type Registry } from "./registry";
import { Cache, atomicJson, freezeJson, readJson, writeCsv, immutable } from "./storage";
import { correlation, select, summarize, type Metrics, type Observation, type Ranked } from "./metrics";

export const VERSION = "capital-research-1.0.1";
export interface Job {
  experiment_hash: string; candidate_id: string; outer_fold: number; inner_fold: number | null;
  stage: "train" | "inner" | "outer"; scenario: number; status: "VALID" | "INVALID" | "FAILED";
  error?: string; observations: Observation[]; metrics?: Metrics; ledger: BacktestLedgerEntry[];
  targets: Record<string, unknown>[]; fit_keys: string[];
}
export interface RunOptions { registry?: Registry; code_hash?: string; max_new_jobs?: number; cache_root?: string; pause_before_summary?: boolean; }
export function recalibrationDates(rows: PriceRow[], start: string, end: string, frequency: Frequency): string[] {
  const dates: string[] = []; let last = "";
  for (const r of rows.filter(r => r.date >= start && r.date < end)) {
    const month = Number(r.date.slice(5, 7));
    const key = frequency === "once" ? "once" : frequency === "yearly" ? r.date.slice(0, 4) :
      frequency === "quarterly" ? `${r.date.slice(0, 4)}-${Math.floor((month - 1) / 3)}` : r.date.slice(0, 7);
    if (key !== last) { dates.push(r.date); last = key; }
  }
  return dates;
}
const modelIdentity = (candidate: Candidate) => {
  const s = candidate.spec;
  return { model_family: s.model_family, model_parameters: s.model_parameters, input_set: s.input_set,
    transformations: s.transformations, recalibration_frequency: s.recalibration_frequency };
};
export function plan(c: Campaign, rows: PriceRow[]) {
  const { candidates, cartesianSize } = generateCandidates(c), folds = makeFolds(c);
  if (!folds.length) throw new Error("No complete outer folds");
  const groups = [...new Map(candidates.map(x => [hash(modelIdentity(x)), x])).values()];
  let inners = 0, fits = 0, backtests = 0;
  for (const fold of folds) {
    const inner = c.validation_mode === "nested" ? innerFolds(c, fold) : [];
    if (c.validation_mode === "nested" && !inner.length) throw new Error("No inner OOS folds within outer train");
    inners += inner.length;
    backtests += (c.validation_mode === "nested" ? candidates.length * inner.length : candidates.length) * c.transaction_cost_bps.length;
    backtests += c.transaction_cost_bps.length; // selected candidate outer OOS only
    fits += groups.reduce((s, x) => s + (c.validation_mode === "nested" ? inner.length :
      recalibrationDates(rows, fold.train_start, fold.train_end, x.spec.recalibration_frequency).length) + 1, 0);
  }
  return { unique_candidates: candidates.length, cartesian_size: cartesianSize, outer_folds: folds.length,
    inner_folds: inners, model_fits_estimated_upper_bound: fits, backtests_estimated: backtests,
    cost_scenarios: c.transaction_cost_bps, total_jobs_estimated: backtests + fits,
    estimation: "Backtests exact maximum incl. invalid candidates; fits upper bound before winner identities/cache. Prediction cache entries are not model fits.",
    candidate_definition_hash: hash(candidates), max_jobs: c.max_jobs };
}
class Paused extends Error {}
export function runCampaign(c: Campaign, rows: PriceRow[], root: string, options: RunOptions = {}) {
  const started = performance.now();
  if (options.max_new_jobs !== undefined && (!Number.isInteger(options.max_new_jobs) || options.max_new_jobs < 0)) throw new Error("max_new_jobs must be a nonnegative integer");
  const registry = options.registry ?? defaultRegistry();
  const planning = plan(c, rows);
  if (planning.total_jobs_estimated > c.max_jobs) throw new Error(`Safety guard: ${planning.total_jobs_estimated} estimated jobs > max_jobs ${c.max_jobs}; inspect dry-run and edit explicit campaign limit`);
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].date < r.date), "sorted unique data dates");
  const dataHash = hash(rows), experimentHash = hash({ version: VERSION, campaign: c, dataHash,
    code_hash: options.code_hash ?? VERSION, registry: registry.versions() });
  freezeJson(`${root}/manifest.json`, { engine_version: VERSION, experiment_id: c.experiment_id,
    experiment_hash: experimentHash, campaign: c, data_hash: dataHash, original_csv_hash: c.data_sha256,
    code_hash: options.code_hash ?? VERSION, registry: registry.versions(), plan: planning,
    protocol: { execution: "next_close", signal_cutoff: "strict previous close", costs: "actual absolute fill notional; D5",
      learned_parameters: "training-only; frozen during each inner/outer OOS", preprocessing: "model-owned, fitted only through training cutoff",
      recalibration: "independent calendar within traditional training; final train fit frozen for each OOS window",
      books: "independent validation sleeves; each fold starts NAV=100 cash, entry costs included, no fictitious end liquidation",
      oos_curve: "compounded outer test daily returns only, not a continuous carried holdings account; gaps remain gaps",
      CAGR: "compounded return annualized by 252/observed sessions; gaps excluded, not calendar CAGR",
      constraints_turnover: "annualized gross actual notional/pretrade NAV", DSR: "NOT_IMPLEMENTED" } });
  freezeJson(`${root}/candidate-space.json`, c.candidate_space);
  freezeJson(`${root}/campaign.frozen.json`, c);
  const candidates = generateCandidates(c).candidates, folds = makeFolds(c);
  writeCsv(`${root}/candidates.csv`, candidates.map(x => ({ candidate_id: x.candidate_id, ...x.spec })));
  const gapRecords = (frames: Fold[], type: string) => frames.map((f, i) => ({ ...f, type,
    gap_start: i && frames[i-1].test_end < f.test_start ? frames[i-1].test_end : null,
    gap_end: i && frames[i-1].test_end < f.test_start ? f.test_start : null }));
  writeCsv(`${root}/folds.csv`, [...gapRecords(folds, "outer"), ...(c.validation_mode === "nested" ? folds.flatMap(f => gapRecords(innerFolds(c,f), "inner")) : [])]);
  const cacheRoot = options.cache_root ?? `${root}/cache`;
  const fitCache = new Cache(`${cacheRoot}/fits`), predictCache = new Cache(`${cacheRoot}/predictions`);
  let newJobs = 0, reusedJobs = 0;
  const allJobs: Job[] = [], selections: any[] = [], rankingRecords: any[] = [], outerRecords: any[] = [], similarity: any[] = [];
  const scoped = (available: PriceRow[], inputs: string[]) => available.map(r => {
    const subset = (values: Record<string, number>) => Object.fromEntries(inputs.filter(t => values[t] !== undefined).map(t => [t, values[t]]));
    return { date: r.date, prices: subset(r.prices), ...(r.opens ? { opens: subset(r.opens) } : {}),
      ...(r.highs ? { highs: subset(r.highs) } : {}), ...(r.lows ? { lows: subset(r.lows) } : {}) };
  });
  const telemetry = () => ({ model_fit_misses: fitCache.misses, model_fits_succeeded: fitCache.fits, model_fit_hits: fitCache.hits,
    prediction_misses: predictCache.misses, prediction_hits: predictCache.hits, elapsed_ms: performance.now() - started,
    peak_rss_kib: process.resourceUsage().maxRSS });
  const journal = (error: unknown, detail: unknown) => {
    try { appendFileSync(`${root}/storage-failures.jsonl`, JSON.stringify({ error: String(error), detail }) + "\n"); }
    catch { process.stderr.write(`Storage failure could not be persisted: ${String(error)}\n`); }
  };
  const fit = (candidate: Candidate, fold: Fold, end: string, start: string = fold.train_start) => {
    const available = scoped(rows.filter(r => r.date >= start && r.date < end), candidate.spec.input_set);
    const cutoff = rows.filter(r => r.date < end).at(-1)?.date ?? new Date(Date.parse(end) - 86400000).toISOString().slice(0, 10);
    const parts = { cache_contract: VERSION, data_hash: hash(available), ...modelIdentity(candidate), model_version: registry.models.get(candidate.spec.model_family)!.version,
      training_start: start, training_end: end, information_cutoff: cutoff, information_hash: hash(available),
      outer_fold: fold.outer_fold, inner_fold: fold.inner_fold ?? null };
    const artifact = fitCache.get(parts, () => registry.models.get(candidate.spec.model_family)!.fit(modelSpec(candidate.spec),
      immutable({ rows: structuredClone(available), input_set: [...candidate.spec.input_set], training_start: start, training_end: end, information_cutoff: cutoff })));
    return { ...artifact, cutoff };
  };
  const execute = (candidate: Candidate, fold: Fold, stage: Job["stage"], scenario: number): Job => {
    const evalStart = stage === "train" ? fold.train_start : fold.test_start;
    const evalEnd = stage === "train" ? fold.train_end : fold.test_end;
    const identity = { experimentHash, candidate_id: candidate.candidate_id, outer_fold: fold.outer_fold,
      inner_fold: fold.inner_fold ?? null, stage, scenario, evalStart, evalEnd, training_start: fold.train_start, training_end: fold.train_end };
    const file = `${root}/jobs/${candidate.candidate_id}/outer-${fold.outer_fold}/inner-${fold.inner_fold ?? stage}/scenario-${scenario}.json`;
    if (existsSync(file)) {
      const found = readJson(file);
      if (found.job_hash !== hash(identity) || found.result_hash !== hash(found.result)) throw new Error("Resume job identity/integrity mismatch");
      reusedJobs++; allJobs.push(found.result); return found.result;
    }
    if (newJobs >= (options.max_new_jobs ?? Infinity)) throw new Paused("Requested bounded interruption");
    const result: Job = { experiment_hash: experimentHash, candidate_id: candidate.candidate_id,
      outer_fold: fold.outer_fold, inner_fold: fold.inner_fold ?? null, stage, scenario,
      status: "VALID", observations: [], ledger: [], targets: [], fit_keys: [] };
    try { registry.validate(candidate.spec); }
    catch (error) { result.status = "INVALID"; result.error = String(error); }
    if (result.status === "VALID") try {
      const eventDates = recalibrationDates(rows, fold.train_start, fold.train_end, candidate.spec.recalibration_frequency);
      // Traditional training uses only information known at each recalibration.
      // Inner/outer evaluation freezes one artifact at the end of its train window.
      const frozen = stage !== "train" ? fit(candidate, fold, fold.train_end) : null;
      const engine = runBacktestEngine(rows.filter(r => r.date < evalEnd),
        [{ ticker: c.risk_asset, name: c.risk_asset, sector: "Fixed risk sleeve", enabled: true, priorWeight: 0 }],
        { cashMin: 0, cashMax: 1, maxEtfWeight: 1, minEtfWeight: 0, minInclusionThreshold: 0, targetActiveEtfs: 1, diversificationEnabled: false },
        { ...defaultBacktestConfig(), rebalanceFrequency: candidate.spec.rebalance_frequency,
          executionTiming: "next_close", warmupDays: c.warmup_rows, startDate: evalStart,
          transactionCostBps: scenario, slippageBps: 0, maxTurnoverPerRebalance: 1, cashYieldAnnual: 0 },
        null, undefined, (signalDate, available, context) => {
          assert.ok(available.every(r => r.date < signalDate));
          assert.equal(available.at(-1)!.date, context!.asOf);
          const event = eventDates.filter(d => d <= signalDate).at(-1) ?? signalDate;
          const fitted = frozen ?? fit(candidate, fold, event);
          result.fit_keys.push(fitted.key);
          assert.ok(fitted.cutoff < signalDate || (stage === "train" && !rows.some(r => r.date >= fold.train_start && r.date < event)), "fit must precede forecast");
          if (stage !== "train") assert.ok(fitted.cutoff < fold.test_start, "no OOS fit/recalibration");
          const information = scoped(available, candidate.spec.input_set);
          const prediction = predictCache.get({ cache_contract: VERSION, fitted_key: fitted.key, data_hash: hash(information),
            model_family: candidate.spec.model_family, model_parameters: candidate.spec.model_parameters,
            input_set: candidate.spec.input_set, transformations: candidate.spec.transformations,
            information_cutoff: context!.asOf, market_information_hash: hash(information) },
          () => registry.models.get(candidate.spec.model_family)!.predict(modelSpec(candidate.spec), immutable(structuredClone(fitted.value)),
            immutable({ history: structuredClone(information), input_set: [...candidate.spec.input_set], information_cutoff: context!.asOf })));
          const risk = registry.policies.get(candidate.spec.exposure_policy)!.map(immutable(structuredClone(prediction.value)), immutable(structuredClone(candidate.spec.exposure_parameters)));
          assert.ok(Number.isFinite(risk) && risk >= 0 && risk <= 1, "Policy target outside [0,1]");
          result.targets.push({ signalDate, information_cutoff: context!.asOf, fit_information_cutoff: fitted.cutoff,
            fit_key: fitted.key, prediction_key: prediction.key, risk_target: risk, cash_target: 1 - risk, output: prediction.value });
          return { [c.risk_asset]: risk };
        }, { initialNav: 100, initialCash: 100, initialHoldings: {}, dailyCashYield: c.cash_yield.daily,
          allowShortPositions: false, d5GrossTradeCosts: true });
      if (!engine.hasSufficientData) throw new Error(engine.insufficientReason ?? "Engine failed");
      result.ledger = engine.dailyLedger.filter(d => d.date >= evalStart && d.date < evalEnd);
      for (const day of result.ledger) {
        const current = rows.find(r => r.date === day.date)!, previous = rows.find(r => r.date === day.intervalStart)!;
        const expectedPnl = day.beginningPositions.reduce((s,p)=>s+p.quantity*(current.prices[p.ticker]-previous.prices[p.ticker]),0);
        assert.ok(day.beginningNav>0 && day.endingNav>0 && day.endingCash>=-1e-8 && day.endingPositions.every(p=>Number.isFinite(p.quantity)&&p.quantity>=0), "No impossible NAV, leverage or shorts");
        const actual = day.trades.reduce((s, t) => s + Math.abs(t.notional), 0);
        assert.ok(Math.abs(day.etfPnl-expectedPnl)<=1e-8, "Only previously held shares earn pre-fill P&L");
        assert.ok(Math.abs(day.cashPnl-day.beginningCash*c.cash_yield.daily)<=1e-8, "Cash interest");
        assert.ok(Math.abs(day.endingCash-day.beginningCash-day.cashPnl+day.trades.reduce((s,t)=>s+t.notional,0)+day.transactionCosts+day.slippage)<=1e-8, "Cash reconciliation");
        assert.ok(Math.abs(day.transactionCosts - actual * scenario / 10000) <= 1e-8, "Fees must reconcile to actual fills");
        assert.ok(Math.abs(day.beginningNav + day.etfPnl + day.cashPnl - day.transactionCosts - day.slippage - day.endingNav) <= 1e-8, "NAV reconciliation");
        assert.ok(Math.abs(day.endingCash + day.endingPositions.reduce((s, p) => s + p.marketValue, 0) - day.endingNav) <= 1e-8, "Book reconciliation");
        if (!day.executionSignalDate) assert.equal(day.trades.length, 0, "No implicit operations");
        if (day.executionSignalDate) {
          const target = result.targets.find(t=>t.signalDate===day.executionSignalDate)!;
          assert.ok(Math.abs(day.endingPositions.reduce((s,p)=>s+p.marketValue,0)/day.endingNav-Number(target.risk_target))<=1e-8,"Risk target applied exactly once");
          assert.equal(rows[rows.findIndex(r=>r.date===day.executionSignalDate)+1].date,day.date,"next_close actual next observed row");
        }
        result.observations.push({ date: day.date, net_return: day.netPnl / day.beginningNav,
          turnover: actual / (day.beginningNav + day.etfPnl + day.cashPnl), costs: day.transactionCosts,
          exposure: day.beginningPositions.reduce((s, p) => s + p.marketValue, 0) / day.beginningNav });
      }
      result.metrics = summarize(result.observations, c.cash_yield.reference_daily);
      result.fit_keys = [...new Set(result.fit_keys)];
    } catch (error) { result.status = "FAILED"; result.error = String(error); }
    result.fit_keys = [...new Set(result.fit_keys)];
    try { atomicJson(file, { job_hash: hash(identity), identity, result, result_hash: hash(result) }); }
    catch (error) { journal(error, { identity, result_hash: hash(result), boundary: "job_commit" }); throw error; }
    newJobs++; allJobs.push(result); return result;
  };
  try {
    for (const outer of folds) {
      const scoringFolds = c.validation_mode === "nested" ? innerFolds(c, outer) : [outer];
      const scoringStage = c.validation_mode === "nested" ? "inner" : "train";
      const oosByCandidate = new Map<string, Observation[]>();
      const ranked: Ranked[] = candidates.map(candidate => {
        const jobs = scoringFolds.flatMap(f => c.transaction_cost_bps.map(s => execute(candidate, f, scoringStage, s)));
        const primary = jobs.filter(j => j.scenario === c.selection_cost_bps);
        const status = primary.every(j => j.status === "VALID") ? "VALID" : primary.some(j => j.status === "INVALID") ? "INVALID" : "FAILED";
        const observations = primary.flatMap(j => j.observations);
        if (scoringStage === "inner" && status === "VALID") oosByCandidate.set(candidate.candidate_id, observations);
        return { candidate, status, metrics: status === "VALID" ? summarize(observations, c.cash_yield.reference_daily) : undefined,
          reason: primary.filter(j => j.status !== "VALID").map(j => j.error).join("; "),
          complexity: Object.keys(candidate.spec.model_parameters).length + candidate.spec.transformations.length + Object.keys(candidate.spec.exposure_parameters).length };
      });
      const selection = select(c, ranked);
      rankingRecords.push(...selection.ranking.map(r => ({ outer_fold: outer.outer_fold, candidate_id: r.candidate.candidate_id,
        basis: scoringStage === "inner" ? "inner OOS only" : "traditional train as-of", status: r.status, reason: r.reason,
        rank: r.rank, score: r.score, complexity: r.complexity, ...r.metrics })));
      // Selection is frozen before any outer-test evaluation or diagnostic.
      const frozenSelection = { outer_fold: outer.outer_fold, train_start: outer.train_start, train_end: outer.train_end,
        test_start: outer.test_start, test_end: outer.test_end, selection_metric: c.selection_metric,
        selection_cost_bps: c.selection_cost_bps, candidate_id: selection.winner?.candidate.candidate_id ?? null,
        score: selection.winner?.score ?? null, rank: selection.winner?.rank ?? null,
        scoring_hash: hash(selection.ranking), status: selection.winner ? "SELECTED" : "NO_ELIGIBLE_CANDIDATE" };
      freezeJson(`${root}/selections/outer-${outer.outer_fold}.json`, frozenSelection);
      selections.push(frozenSelection);
      if (selection.winner) for (const scenario of c.transaction_cost_bps) {
        const job = execute(selection.winner.candidate, outer, "outer", scenario);
        outerRecords.push({ outer_fold: outer.outer_fold, scenario, candidate_id: job.candidate_id, status: job.status,
          selection_score: selection.winner.score, outer_score: job.metrics?.[c.selection_metric], ...job.metrics });
      }
      for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
        const a = oosByCandidate.get(candidates[i].candidate_id), b = oosByCandidate.get(candidates[j].candidate_id);
        if (a && b) similarity.push({ outer_fold: outer.outer_fold, a: candidates[i].candidate_id, b: candidates[j].candidate_id,
          basis: "aligned inner OOS returns only", correlation: correlation(a, b), observations: a.length });
      }
    }
  } catch (error) {
    if (!(error instanceof Paused)) throw error;
    atomicJson(`${root}/progress.json`, { experiment_hash: experimentHash, paused: true, new_jobs: newJobs, reused_jobs: reusedJobs, telemetry: telemetry() });
    return { paused: true, new_jobs: newJobs, reused_jobs: reusedJobs, experiment_hash: experimentHash };
  }
  if (options.pause_before_summary) {
    atomicJson(`${root}/progress.json`, { experiment_hash: experimentHash, paused: true, boundary: "before_summary", new_jobs: newJobs, reused_jobs: reusedJobs, telemetry: telemetry() });
    return { paused: true, new_jobs: newJobs, reused_jobs: reusedJobs, experiment_hash: experimentHash };
  }
  writeCsv(`${root}/inner-results.csv`, allJobs.filter(j => j.stage === "inner").map(j => ({ candidate_id: j.candidate_id, outer_fold: j.outer_fold,
    inner_fold: j.inner_fold, scenario: j.scenario, status: j.status, error: j.error, ...j.metrics })),
  ["candidate_id", "outer_fold", "inner_fold", "scenario", "status", "error", "observations", "cagr", "net_sharpe", "max_drawdown", "turnover_annualized", "costs", "exposure"]);
  writeCsv(`${root}/candidate-rankings.csv`, rankingRecords);
  writeCsv(`${root}/outer-results.csv`, outerRecords);
  writeCsv(`${root}/selected-by-fold.csv`, selections);
  writeCsv(`${root}/failures.csv`, [
    ...allJobs.filter(j => j.status !== "VALID").map(j => ({ candidate_id: j.candidate_id, outer_fold: j.outer_fold, inner_fold: j.inner_fold, stage: j.stage, scenario: j.scenario, status: j.status, reason: j.error })),
    ...rankingRecords.filter(r => r.status !== "VALID").map(r => ({ candidate_id: r.candidate_id, outer_fold: r.outer_fold, stage: "selection", status: r.status, reason: r.reason })),
    ...(existsSync(`${root}/storage-failures.jsonl`) ? readFileSync(`${root}/storage-failures.jsonl`, "utf8").trim().split("\n").map(line => {
      const e = JSON.parse(line); return { ...e.detail.identity, stage: "storage", status: "ABORTED_WRITE", reason: e.error };
    }) : []),
  ], ["candidate_id", "outer_fold", "inner_fold", "stage", "scenario", "status", "reason"]);
  const ledgerRecords: any[] = [], equityRecords: any[] = [], scenarioMetrics: any[] = [];
  for (const scenario of c.transaction_cost_bps) {
    const jobs = allJobs.filter(j => j.stage === "outer" && j.scenario === scenario && j.status === "VALID").sort((a, b) => a.outer_fold - b.outer_fold);
    const observations = jobs.flatMap(j => j.observations);
    assert.equal(new Set(observations.map(r => r.date)).size, observations.length, "No duplicated OOS dates");
    let index = 100, high = 100;
    for (const job of jobs) {
      const fold = folds[job.outer_fold];
      for (const [i, obs] of job.observations.entries()) {
        assert.ok(obs.date >= fold.test_start && obs.date < fold.test_end, "Only outer test returns concatenated");
        index *= 1 + obs.net_return; high = Math.max(high, index);
        equityRecords.push({ scenario, outer_fold: job.outer_fold, candidate_id: job.candidate_id, date: obs.date,
          index, drawdown: index / high - 1, net_return: obs.net_return, exposure: obs.exposure });
        ledgerRecords.push({ scenario, outer_fold: job.outer_fold, candidate_id: job.candidate_id,
          sleeve_convention: "independent fold NAV=100; composite index in oos-equity", ...job.ledger[i] });
      }
    }
    scenarioMetrics.push({ scenario, ...(observations.length ? summarize(observations, c.cash_yield.reference_daily) : { status: "NO_OUTER_OOS" }) });
  }
  writeCsv(`${root}/oos-ledger.csv`, ledgerRecords);
  writeCsv(`${root}/oos-equity.csv`, equityRecords);
  const stability = candidates.map(x => ({ candidate_id: x.candidate_id, model_family: x.spec.model_family,
    selection_count: selections.filter(s => s.candidate_id === x.candidate_id).length,
    selection_frequency: selections.filter(s => s.candidate_id === x.candidate_id).length / folds.length, spec: x.spec }));
  writeCsv(`${root}/selection-stability.csv`, stability);
  const sensitivity: any[] = [];
  const flatten = (value: any, prefix = "", out: Record<string, unknown> = {}) => {
    if (value && typeof value === "object" && !Array.isArray(value)) for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    else out[prefix] = value; return out;
  };
  for (const fold of folds) for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
    const a = flatten(candidates[i].spec), b = flatten(candidates[j].spec);
    const differences = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => canonical(a[k] ?? null) !== canonical(b[k] ?? null));
    if (differences.length !== 1 || typeof a[differences[0]] !== "number" || typeof b[differences[0]] !== "number") continue;
    const key = differences[0], lo = Math.min(a[key] as number, b[key] as number), hi = Math.max(a[key] as number, b[key] as number);
    const between = candidates.some(x => { const n = flatten(x.spec); return typeof n[key] === "number" && n[key] > lo && n[key] < hi && Object.keys(a).every(k => k === key || canonical(a[k] ?? null) === canonical(n[k] ?? null)); });
    if (between) continue;
    const ar = rankingRecords.find(r => r.outer_fold === fold.outer_fold && r.candidate_id === candidates[i].candidate_id);
    const br = rankingRecords.find(r => r.outer_fold === fold.outer_fold && r.candidate_id === candidates[j].candidate_id);
    sensitivity.push({ outer_fold: fold.outer_fold, parameter: key, a: candidates[i].candidate_id, b: candidates[j].candidate_id,
      a_value: a[key], b_value: b[key], a_score: ar?.score, b_score: br?.score, score_difference: ar?.score !== undefined && br?.score !== undefined ? br.score - ar.score : null });
  }
  writeCsv(`${root}/local-sensitivity.csv`, sensitivity, ["outer_fold", "parameter", "a", "b", "a_value", "b_value", "a_score", "b_score", "score_difference"]);
  writeCsv(`${root}/candidate-oos-similarity.csv`, similarity, ["outer_fold", "a", "b", "basis", "correlation", "observations"]);
  const distribution = folds.map(f => {
    const scores = rankingRecords.filter(r => r.outer_fold === f.outer_fold && r.score !== undefined).map(r => r.score).sort((a, b) => a - b);
    return { outer_fold: f.outer_fold, valid: scores.length, evaluated: candidates.length, min: scores[0] ?? null,
      median: scores.length ? scores[Math.floor(scores.length / 2)] : null, max: scores.at(-1) ?? null };
  });
  const status = selections.every(s => s.status === "SELECTED") && allJobs.filter(j => j.stage === "outer").every(j => j.status === "VALID") ? "COMPLETE" : "INCOMPLETE";
  const summary = { experiment_id: c.experiment_id, experiment_hash: experimentHash, validation_mode: c.validation_mode,
    status, candidate_definitions_hash: planning.candidate_definition_hash, unique_candidates: candidates.length,
    total_backtest_jobs: allJobs.length, failed_jobs: allJobs.filter(j => j.status === "FAILED").length,
    invalid_jobs: allJobs.filter(j => j.status === "INVALID").length, selection_distribution: distribution,
    outer_oos: scenarioMetrics, selected_by_fold: selections, stability,
    family_selection_frequency: [...new Set(candidates.map(x => x.spec.model_family))].map(f => ({ family: f, count: stability.filter(s => s.model_family === f).reduce((a, s) => a + s.selection_count, 0) })),
    cache: { persisted_model_artifacts: new Set(allJobs.flatMap(j => j.fit_keys)).size,
      persisted_prediction_artifacts: new Set(allJobs.flatMap(j => j.targets.map(t => t.prediction_key))).size },
    DSR: "NOT_IMPLEMENTED",
    limitations: ["Nested outer OOS is selection-overfitting diagnostic, not proof of economic robustness.",
      "No significance test; no invented DSR.", "Independent fold sleeves reset cash/NAV, count entry fees; no assumed free liquidation or continuous-account NAV claim.",
      "Only disjoint inner/outer tests supported; step can exceed horizon, leaving explicit observation gaps.",
      "Stateless current regime is the only real model family; model calibration clock is retained for future families.",
      "Traditional training scores are not OOS. Traditional candidate correlations unavailable; nested similarities use aligned inner OOS only."] };
  try { atomicJson(`${root}/summary.json`, summary); }
  catch (error) { journal(error, { boundary: "summary_commit" }); throw error; }
  atomicJson(`${root}/progress.json`, { experiment_hash: experimentHash, paused: false, complete: status === "COMPLETE", new_jobs: newJobs, reused_jobs: reusedJobs, telemetry: telemetry() });
  return { paused: false, new_jobs: newJobs, reused_jobs: reusedJobs, experiment_hash: experimentHash, summary };
}
