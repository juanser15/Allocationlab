import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidateId, canonical, generateCandidates, makeFolds, innerFolds, hash, type Campaign, type CandidateSpec } from "./spec";
import { runCampaign, plan, recalibrationDates } from "./engine";
import { defaultRegistry, type FitContext } from "./registry";
import { Cache, readJson } from "./storage";
import { select, type Metrics } from "./metrics";
import type { PriceRow } from "../../artifacts/api-server/src/lib/calculator";

// SYNTHETIC fixtures only. Production backtester and research engine are real.
function data(start = "2020-01-01", end = "2023-01-01"): PriceRow[] {
  const rows: PriceRow[] = []; let price = 100;
  for (let t = Date.parse(start), i = 0; t < Date.parse(end); t += 86400000) {
    const d = new Date(t); if ([0, 6].includes(d.getUTCDay())) continue;
    price *= 1 + (i++ % 3 === 0 ? -.005 : .004);
    rows.push({ date: d.toISOString().slice(0, 10), prices: { SPY: price, SIGNAL: 100 + i % 10 } });
  }
  return rows;
}
const baseSpec: CandidateSpec = { model_family: "synthetic_train_only", input_set: ["SIGNAL"], transformations: [{ name: "identity" }],
  model_parameters: {}, exposure_policy: "constant", exposure_parameters: { risk: .5 }, rebalance_frequency: "monthly", recalibration_frequency: "quarterly" };
const campaign = (changes: Partial<Campaign> = {}): Campaign => ({
  experiment_id: "synthetic", validation_mode: "nested", window_type: "rolling",
  dates: { start: "2020-01-01", end_exclusive: "2023-01-01" }, train_months: 12, test_months: 6, step_months: 6,
  inner_train_months: 6, inner_test_months: 3, inner_step_months: 3,
  rebalance_frequency: "monthly", recalibration_frequency: "quarterly", search_method: "grid", candidate_budget: 3,
  candidate_space: [{ base: baseSpec, axes: { "exposure_parameters.risk": [.25, .5, .75] } }],
  selection_metric: "cagr", constraints: {}, transaction_cost_bps: [0], selection_cost_bps: 0,
  cash_yield: { type: "constant", daily: 0, reference_daily: 0 }, risk_asset: "SPY", reference_universe: ["SIGNAL"],
  data_csv: "synthetic", data_sha256: "synthetic", data_provenance: "SYNTHETIC", warmup_rows: 3, max_jobs: 10000, ...changes,
});
const root = () => mkdtempSync(join(tmpdir(), "allocationlab-cl03-"));
function registry(fits: FitContext[] = []) {
  return defaultRegistry().model("synthetic_train_only", {
    version: "synthetic-fixture-1", validate() {},
    fit(_spec, context) {
      fits.push(structuredClone(context));
      // Training-owned normalizer is fitted solely from the supplied train slice.
      const mean = context.rows.length ? context.rows.reduce((s, r) => s + r.prices.SIGNAL, 0) / context.rows.length : 100;
      return { mean, fitted_end: context.information_cutoff };
    },
    predict(_spec, fitted: any, context) {
      assert.ok(context.history.every(r => r.date <= context.information_cutoff));
      return { score: Math.max(0, Math.min(1, context.history.at(-1)!.prices.SIGNAL / (fitted.mean * 2))) };
    },
  });
}
test("CL03 SYNTHETIC — traditional/rolling and expanding clocks produce exact outer folds", () => {
  const c = campaign({ dates: { start: "2012-01-01", end_exclusive: "2022-01-01" }, train_months: 84, test_months: 12, step_months: 12 });
  const rolling = makeFolds(c), expanding = makeFolds({ ...c, window_type: "expanding" });
  assert.deepEqual(rolling.map(f => [f.train_start, f.train_end, f.test_start, f.test_end]), [
    ["2012-01-01", "2019-01-01", "2019-01-01", "2020-01-01"],
    ["2013-01-01", "2020-01-01", "2020-01-01", "2021-01-01"],
    ["2014-01-01", "2021-01-01", "2021-01-01", "2022-01-01"],
  ]);
  assert.ok(expanding.every(f => f.train_start === "2012-01-01"));
  assert.deepEqual(makeFolds({ ...c, validation_mode: "traditional" }), rolling);
});
test("CL03 SYNTHETIC — nested inner folds stay in outer training and inherit/override window type", () => {
  const c = campaign({ dates: { start: "2012-01-01", end_exclusive: "2020-01-01" }, train_months: 84, test_months: 12, step_months: 12,
    inner_train_months: 48, inner_test_months: 12, inner_step_months: 12 });
  const outer = makeFolds(c)[0], inner = innerFolds(c, outer);
  assert.deepEqual(inner.map(f => [f.train_start, f.test_start, f.test_end]), [
    ["2012-01-01", "2016-01-01", "2017-01-01"], ["2013-01-01", "2017-01-01", "2018-01-01"], ["2014-01-01", "2018-01-01", "2019-01-01"],
  ]);
  assert.ok(inner.every(f => f.test_end <= outer.train_end));
  assert.ok(innerFolds({ ...c, inner_window_type: "expanding" }, outer).every(f => f.train_start === "2012-01-01"));
  assert.throws(() => makeFolds({ ...c, step_months: 6 }), /Overlapping/);
});
test("CL03 SYNTHETIC — grid product, explicit reduction and strict <=200 budget", () => {
  const c = campaign({ candidate_budget: 2 });
  assert.throws(() => generateCandidates(c), /Grid product 3 > budget 2/);
  assert.equal(generateCandidates({ ...c, grid_reduction: { indices: [0, 2] } }).candidates.length, 2);
  assert.throws(() => generateCandidates({ ...c, candidate_budget: 201 }), /1..200/);
  const large = campaign({ candidate_budget: 200, candidate_space: [{ base: baseSpec, axes: { "exposure_parameters.risk": Array.from({ length: 200 }, (_, i) => i / 200) } }] });
  assert.equal(generateCandidates(large).candidates.length, 200);
  assert.equal(new Set(generateCandidates(large).candidates.map(x => x.candidate_id)).size, 200);
});
test("CL03 SYNTHETIC — seeded random is reproducible, unique and requires a seed", () => {
  const c = campaign({ search_method: "random", candidate_budget: 8, random_seed: "CL03", candidate_space: [{ base: baseSpec,
    axes: { "exposure_parameters.risk": Array.from({ length: 30 }, (_, i) => i / 30) } }] });
  assert.deepEqual(generateCandidates(c), generateCandidates(structuredClone(c)));
  assert.notDeepEqual(generateCandidates(c), generateCandidates({ ...c, random_seed: "different" }));
  assert.equal(generateCandidates(c).candidates.length, 8);
  assert.throws(() => generateCandidates({ ...c, random_seed: undefined }), /mandatory/);
});
test("CL03 SYNTHETIC — candidate IDs are stable under object-key reorder and change for changed config", () => {
  const reordered = JSON.parse(JSON.stringify(baseSpec, Object.keys(baseSpec).reverse()));
  // Reorder recursively without discarding nested keys.
  const reverse = (v: any): any => Array.isArray(v) ? v.map(reverse) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).reverse().map(k => [k, reverse(v[k])])) : v;
  assert.equal(candidateId(baseSpec), candidateId(reverse(baseSpec)));
  assert.notEqual(candidateId(baseSpec), candidateId({ ...baseSpec, exposure_parameters: { risk: .6 } }));
  assert.equal(canonical(baseSpec), canonical(reverse(baseSpec)));
  assert.ok(reordered);
});
test("CL03 SYNTHETIC — outer test never enters inner fit, normalization, ranking or candidate generation", () => {
  const c = campaign({ dates: { start: "2020-01-01", end_exclusive: "2021-07-01" } }), fits: FitContext[] = [];
  const out = root(); runCampaign(c, data(), out, { registry: registry(fits) });
  const inner = fits.filter(f => f.training_end < "2021-01-01");
  assert.ok(inner.length > 0);
  assert.ok(inner.every(f => f.rows.every(r => r.date >= f.training_start && r.date < f.training_end && r.date < "2021-01-01")));
  assert.ok(fits.every(f => f.rows.every(r => r.date < "2021-01-01")));
  assert.ok(readJson(out + "/summary.json").selected_by_fold[0].score !== null);
  assert.deepEqual(generateCandidates(c), generateCandidates(c)); // generator has no data argument
});
test("CL03 SYNTHETIC — future observations cannot change past selections in either mode", () => {
  const original = data(), mutated = structuredClone(original);
  mutated.filter(r => r.date >= "2021-07-01").forEach(r => { r.prices.SPY *= 10; r.prices.SIGNAL *= 50; });
  for (const mode of ["traditional", "nested"] as const) {
    const c = campaign({ validation_mode: mode }), a = root(), b = root();
    runCampaign(c, original, a, { registry: registry() }); runCampaign(c, mutated, b, { registry: registry() });
    assert.deepEqual(readJson(a + "/selections/outer-0.json"), readJson(b + "/selections/outer-0.json"));
    assert.deepEqual(readJson(a + "/selections/outer-1.json"), readJson(b + "/selections/outer-1.json"));
  }
});
test("CL03 SYNTHETIC — rolling fit removes old observations; expanding retains prior training", () => {
  for (const window_type of ["rolling", "expanding"] as const) {
    const fits: FitContext[] = [], c = campaign({ window_type });
    runCampaign(c, data(), root(), { registry: registry(fits) });
    const final = fits.find(f => f.training_end === "2022-07-01");
    assert.ok(final);
    assert.equal(final.training_start, window_type === "rolling" ? "2021-07-01" : "2020-01-01");
    assert.ok(final.rows.every(r => r.date >= final.training_start));
    assert.equal(final.rows[0].date, window_type === "rolling" ? "2021-07-01" : "2020-01-01");
  }
});
test("CL03 SYNTHETIC — independent rebalance, recalibration, step and test clocks", () => {
  const rows = data();
  assert.equal(recalibrationDates(rows, "2020-01-01", "2021-01-01", "monthly").length, 12);
  assert.equal(recalibrationDates(rows, "2020-01-01", "2021-01-01", "quarterly").length, 4);
  assert.equal(recalibrationDates(rows, "2020-01-01", "2021-01-01", "yearly").length, 1);
  const c = campaign({ test_months: 3, step_months: 6 });
  assert.equal(makeFolds(c)[0].test_end, "2021-04-01");
  assert.equal(makeFolds(c)[1].test_start, "2021-07-01");
  const quarterly = { ...c, candidate_space: [{ base: { ...baseSpec, rebalance_frequency: "quarterly" as const } }], candidate_budget: 1 };
  assert.equal(plan(quarterly, rows).unique_candidates, 1);
  assert.equal(runCampaign(quarterly, rows, root(), { registry: registry() }).summary!.status, "COMPLETE");
});
test("CL03 SYNTHETIC — twenty policies share one fit per information set", () => {
  const fits: FitContext[] = [], c = campaign({ candidate_budget: 20, dates: { start: "2020-01-01", end_exclusive: "2021-07-01" },
    candidate_space: [{ base: baseSpec, axes: { "exposure_parameters.risk": Array.from({ length: 20 }, (_, i) => (i + 1) / 20) } }] });
  const result = runCampaign(c, data(), root(), { registry: registry(fits) });
  assert.equal(fits.length, 3); // 2 inner train sets + 1 frozen outer train set
  assert.equal(result.summary!.cache.persisted_model_artifacts, 3);
});
test("CL03 SYNTHETIC — cache cannot cross training bounds or information cutoffs and detects tampering", () => {
  const dir = root(), cache = new Cache(dir); let calls = 0;
  const key = { data_hash: "x", model_family: "x", model_parameters: {}, input_set: ["SPY"], training_start: "2020-01-01", training_end: "2021-01-01", information_cutoff: "2020-12-31" };
  cache.get(key, () => ({ count: ++calls })); cache.get(key, () => ({ count: ++calls }));
  cache.get({ ...key, information_cutoff: "2021-01-01" }, () => ({ count: ++calls }));
  cache.get({ ...key, training_start: "2020-02-01" }, () => ({ count: ++calls }));
  assert.equal(calls, 3);
  writeFileSync(join(dir, hash(key)+".json"), JSON.stringify({ key: hash(key), parts: key, value: { count: 100 }, value_hash: "tampered" }));
  assert.throws(() => cache.get(key, () => 0), /integrity/);
});
test("CL03 SYNTHETIC — interruption/resume does not duplicate completed valid, invalid or failed jobs", () => {
  const c = campaign(), rows = data(), dir = root();
  const paused = runCampaign(c, rows, dir, { registry: registry(), max_new_jobs: 2 });
  assert.equal(paused.paused, true); assert.equal(paused.new_jobs, 2);
  const resumed = runCampaign(c, rows, dir, { registry: registry() });
  assert.equal(resumed.paused, false); assert.equal(resumed.reused_jobs, 2);
  const completeJobs = resumed.summary!.total_backtest_jobs;
  const summaryHash = hash(readFileSync(dir + "/summary.json", "utf8"));
  const again = runCampaign(c, rows, dir, { registry: registry() });
  assert.equal(again.new_jobs, 0); assert.equal(again.reused_jobs, completeJobs);
  assert.equal(hash(readFileSync(dir + "/summary.json", "utf8")), summaryHash, "reproducible results are separate from invocation telemetry");
  assert.throws(() => runCampaign({ ...c, cash_yield: { type: "constant", daily: .01, reference_daily: 0 } }, rows, dir, { registry: registry() }), /Frozen artifact/);
  const corruptRows = structuredClone(rows); corruptRows[5].prices.SPY *= 2;
  assert.throws(() => runCampaign(c, corruptRows, dir, { registry: registry() }), /Frozen artifact/);
});
test("CL03 SYNTHETIC — invalid/failed candidates are preserved alongside winners", () => {
  const c = campaign({ candidate_budget: 3, candidate_space: [
    { base: baseSpec }, { base: { ...baseSpec, exposure_parameters: { risk: 2 } } },
    { base: { ...baseSpec, model_family: "synthetic_failure" } },
  ] });
  const reg = registry().model("synthetic_failure", { version: "fixture", validate() {}, fit() { throw new Error("deliberate fitting failure"); }, predict() { return { score: 0 }; } });
  const dir = root(), result = runCampaign(c, data(), dir, { registry: reg });
  assert.ok(result.summary!.invalid_jobs > 0 && result.summary!.failed_jobs > 0);
  assert.ok(readFileSync(dir + "/failures.csv", "utf8").includes("deliberate fitting failure"));
  const again = runCampaign(c, data(), dir, { registry: reg });
  assert.equal(again.new_jobs, 0); assert.equal(again.reused_jobs, result.summary!.total_backtest_jobs);
});
test("CL03 SYNTHETIC — selection respects all metrics, constraints and deterministic tie-breakers", () => {
  const metrics: Metrics = { observations: 252, cagr: .1, net_sharpe: 1, max_drawdown: -.2, return_drawdown_ratio: .5,
    volatility: .1, turnover: 1, turnover_annualized: 1, costs: 0, exposure: .5, final_index: 110 };
  const candidates = generateCandidates(campaign()).candidates;
  const ranked = candidates.map((candidate, i) => ({ candidate, status: "VALID", complexity: 2, metrics: { ...metrics, cagr: .1 + i * .1, net_sharpe: 3 - i, max_drawdown: -.3 + i * .1, return_drawdown_ratio: i + 1 } }));
  for (const [metric, index] of [["cagr", 2], ["net_sharpe", 0], ["max_drawdown", 2], ["return_drawdown_ratio", 2]] as const)
    assert.equal(select(campaign({ selection_metric: metric }), ranked).winner!.candidate.candidate_id, candidates[index].candidate_id);
  const tie = ranked.map((r, i) => ({ ...r, complexity: i === 1 ? 1 : 2, metrics: { ...metrics, turnover_annualized: i === 0 ? 2 : 1 } }));
  assert.equal(select(campaign(), tie).winner!.candidate.candidate_id, candidates[1].candidate_id);
  const identical = tie.map(r => ({ ...r, complexity: 1, metrics }));
  assert.equal(select(campaign(), identical).winner!.candidate.candidate_id, candidates[0].candidate_id);
  for (const constraints of [{ max_turnover: .5 }, { max_drawdown: .1 }, { min_exposure: .6 }, { max_exposure: .4 }])
    assert.equal(select(campaign({ constraints }), identical).winner, undefined);
});
test("CL03 SYNTHETIC — concatenation contains only outer test returns, never inner/train returns", () => {
  const c = campaign(), dir = root(); runCampaign(c, data(), dir, { registry: registry() });
  const summary = readJson(dir + "/summary.json"), text = readFileSync(dir + "/oos-equity.csv", "utf8");
  assert.ok(!text.includes("2020-"));
  const files = (p: string): string[] => readdirSync(p, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(p, e.name)) : [join(p, e.name)]);
  const jobs = files(dir + "/jobs").map(p => readJson(p).result).filter(j => j.stage === "outer");
  const obs = jobs.sort((a, b) => a.outer_fold - b.outer_fold).flatMap(j => j.observations);
  assert.ok(obs.every(r => makeFolds(c).some(f => r.date >= f.test_start && r.date < f.test_end)));
  const compounded = obs.reduce((nav, r) => nav * (1 + r.net_return), 100);
  assert.ok(Math.abs(compounded - summary.outer_oos[0].final_index) < 1e-8);
  assert.equal(new Set(obs.map(r => r.date)).size, obs.length);
});

test("CL03 SYNTHETIC DELIBERATE OVERFIT — traditional looks better; nested selection fails on outer OOS", () => {
  const prices: PriceRow[] = []; let p = 100;
  for (let t = Date.parse("2020-01-01"); t < Date.parse("2022-07-01"); t += 86400000) {
    const d = new Date(t); if ([0, 6].includes(d.getUTCDay())) continue;
    const year = d.getUTCFullYear(), up = d.getUTCMonth() % 2 === 0;
    p *= 1 + (up ? 1 : -1) * (year === 2020 ? .01 : .002);
    // Planted exogenous indicators: A works in 2020/2022, B only in 2021.
    // Visible before the signal. This is a deliberately unstable synthetic relation.
    const next = new Date(t + 86400000), nextUp = next.getUTCMonth() % 2 === 0, bGood = next.getUTCFullYear() === 2021;
    prices.push({ date: d.toISOString().slice(0, 10), prices: { SPY: p, A: (bGood ? !nextUp : nextUp) ? 200 : 50, B: (bGood ? nextUp : !nextUp) ? 200 : 50 } });
  }
  const reg = defaultRegistry().model("synthetic_spurious_indicator", { version: "planted-overfit-1", validate() {},
    fit() { return { trained: true }; }, predict(spec, _fit, ctx) { return { score: ctx.history.at(-1)!.prices[spec.model_parameters.indicator as string] > 100 ? 1 : 0 }; } });
  const c = campaign({ dates: { start: "2020-01-01", end_exclusive: "2022-07-01" }, train_months: 24,
    inner_train_months: 12, inner_test_months: 6, inner_step_months: 6, candidate_budget: 2,
    candidate_space: [{ base: { ...baseSpec, model_family: "synthetic_spurious_indicator", input_set: ["A", "B"],
      exposure_policy: "cash_band", exposure_parameters: { cash_min: 0, cash_max: 1 } }, axes: { "model_parameters.indicator": ["A", "B"] } }] });
  const a = runCampaign({ ...c, validation_mode: "traditional" }, prices, root(), { registry: reg }).summary!;
  const b = runCampaign(c, prices, root(), { registry: reg }).summary!;
  assert.notEqual(a.selected_by_fold[0].candidate_id, b.selected_by_fold[0].candidate_id);
  assert.ok(a.outer_oos[0].cagr > b.outer_oos[0].cagr, "traditional outer curve must look better in this planted fixture");
  assert.ok(b.selected_by_fold[0].score > b.outer_oos[0].cagr, "inner winner degrades on outer test");
  assert.ok(b.outer_oos[0].cagr < 0, "nested must reveal the losing spurious mapping");
});
