import test from "node:test";
import assert from "node:assert/strict";
import { evaluateQuality, qualityObserver, QUALITY_POLICY_HASH } from "./quality";
import { buildAssetForecast } from "./forecasts";
import { runCoordinated } from "./engine";
import { runScheduledLedger } from "../workbench/interactive-ledger";
import { COORDINATED_SPEC, preparedDataset, normalizeCoordinated } from "../../artifacts/api-server/src/lib/workbench/coordinated-calendar";
import { DEFAULT_FORECAST, type CoordinatedRequest } from "../../artifacts/api-server/src/lib/workbench/coordinated-contract";
import { parseInstitutional } from "../../artifacts/api-server/src/lib/workbench/institutional-contract";

const assets = ["SPY", "EFA", "IEF"];
const training = Array.from({ length: 16 }, (_, i) => ({
  date: `2024-01-${String(i + 1).padStart(2, "0")}`,
  prices: { SPY: 100 * 1.01 ** i, EFA: 100 * 1.005 ** i, IEF: 100 * .998 ** i },
}));
const forecastConfig = { ...DEFAULT_FORECAST, model: "MANUAL_SCORE" as const, signals: [{ id: "MOMENTUM" as const, enabled: true, lookback_sessions: 3, skip_sessions: 0, weight: 1 }] };
const request: CoordinatedRequest = {
  contract_version: COORDINATED_SPEC, evaluation_start: "2024-01-21", evaluation_end_exclusive: "2024-04-21",
  training_window_months: 6, window_type: "ROLLING", rebalance_frequency: "MONTHLY", transaction_cost_bps: 10,
  control_mode: "MAX_EXPOSURE", maximum_exposure: .6, risk_budget: .1, regime_model: "TREND",
  regime_response: "FIXED", defensive_multiplier: .5, etfs: assets, maximum_etf_weight: .4,
  risk_aversion: 5, covariance_shrinkage: .2,
};
function context() {
  return { request: { ...request, forecast: forecastConfig }, fold: { decision_date: "2024-01-17", information_cutoff: "2024-01-16", training_start: "2024-01-01", fold_id: "quality-test" }, training: structuredClone(training), assets: [...assets], forecast: buildAssetForecast(forecastConfig, training, assets, [], 1 / 12) };
}
test("Explicit policy selection is validated; isolated capital cannot receive a portfolio quality policy", () => {
  const financial: any = { ...request, cash_policy: { type: "ZERO_RETURN", annual_rate: 0 } };
  assert.throws(() => parseInstitutional(financial), /Explicit Quality Control/);
  for (const enabled of [true, false]) assert.equal(parseInstitutional({ ...financial, quality_control: { enabled, policy_version: "STRUCTURAL_V1" } }).quality_control?.enabled, enabled);
  assert.throws(() => parseInstitutional({ ...financial, quality_control: { enabled: "false", policy_version: "STRUCTURAL_V1" } } as any), /Explicit Quality Control/);
  assert.throws(() => parseInstitutional({ ...financial, research_scope: "CAPITAL_EXPOSURE", quality_control: { enabled: true, policy_version: "STRUCTURAL_V1" } } as any), /cannot receive/);
});
test("Known ranking/PCA oracle, null first stability, exact training coverage and policy identity", () => {
  const result = evaluateQuality(context(), true);
  assert.equal(result.status, "PASS");
  assert.equal(result.metrics.coverage, 1);
  assert.equal(result.metrics.minimum_history, 16);
  assert.ok(result.metrics.dispersion! > 0);
  assert.ok(Math.abs(result.metrics.pc1_share! - 1) < 1e-12);
  assert.ok(Math.abs(result.metrics.signal_effective_rank! - 1) < 1e-12);
  assert.equal(result.metrics.rank_stability, null);
  assert.equal(result.metrics.rank_history_count, 0);
  assert.equal(result.policy_hash, QUALITY_POLICY_HASH);
  assert.equal(result.predictive_quality, "NOT_USED_NO_FUTURE_LABELS");
});
test("Constant cross-sectional ranking blocks ON before optimization, OFF only observes", () => {
  const x = context(); x.forecast.predictions.forEach(p => { p.score = 0; });
  const off = qualityObserver(false);
  assert.equal(off.observe(x).status, "OFF_OBSERVE_ONLY");
  assert.equal(off.decisions[0].would_block, true);
  const on = qualityObserver(true);
  assert.throws(() => on.observe(x), (e: any) => e.code === "QUALITY_GATE_BLOCKED" && e.details.gate_evidence.status === "BLOCKED" && e.details.completed_quality_decisions.length === 1);
});
test("Missing input, stale last quote and future observations are explicit, never filled", () => {
  for (const issue of ["missing", "stale", "future", "outside"] as const) {
    const x = context();
    if (issue === "missing") delete (x.training[2].prices as any).SPY;
    if (issue === "stale") delete (x.training.at(-1)!.prices as any).EFA;
    if (issue === "future") x.training.push({ date: "2024-01-17", prices: training[0].prices });
    if (issue === "outside") x.fold.training_start = "2024-01-03";
    const d = evaluateQuality(x, true);
    assert.equal(d.status, "BLOCKED");
    assert.ok(d.blocking_reasons.length);
  }
  const invalid = context();
  invalid.forecast.predictions[0].score = Number.NaN;
  const rejected = evaluateQuality(invalid, true);
  assert.equal(rejected.status, "BLOCKED");
  assert.match(rejected.input_hash, /^[a-f0-9]{64}$/);
});
test("Direct asset returns do not invent signal PCA or a cross-sectional selection requirement", () => {
  const x: any = context();
  x.request.forecast = { ...DEFAULT_FORECAST, model: "HISTORICAL_MEAN" };
  x.assets = ["SPY"]; x.forecast = { predictions: [{ ticker: "SPY", expected_return: 0 }] };
  const d = evaluateQuality(x, true);
  assert.equal(d.status, "PASS");
  assert.equal(d.metrics.pc1_share, null);
  assert.equal(d.metrics.dispersion, null);
  assert.equal(d.pca_status, "NOT_APPLICABLE_DIRECT_ASSET_RETURNS");
});
test("Rank reversal is a warning, not a portfolio substitution; history is cutoff/window bounded", () => {
  const x = context(), prior = [{ cutoff: "2024-01-10", source_start: "2024-01-06", scores: { SPY: -1, EFA: 0, IEF: 1 } }];
  const d = evaluateQuality(x, true, prior);
  assert.equal(d.status, "WARN");
  assert.equal(d.metrics.rank_stability, -1);
  assert.equal(evaluateQuality(x, true, [{ ...prior[0], cutoff: "2023-12-31" }]).metrics.rank_stability, null);
  assert.equal(evaluateQuality(x, true, [{ ...prior[0], cutoff: "2024-01-18" }]).metrics.rank_stability, null);
  assert.equal(evaluateQuality(x, true, [{ ...prior[0], source_start: "2023-12-20" }]).metrics.rank_stability, null);
  const changed = evaluateQuality(x, true, [{ ...prior[0], scores: { SPY: 1, EFA: 0, IEF: -1 } }]);
  assert.notEqual(d.input_hash, changed.input_hash);
});
test("Walk-forward ON/OFF passing gates preserve exact weights, fills and returns; one gate per rebalance", () => {
  const data = preparedDataset(), spec = normalizeCoordinated(request, data), on = qualityObserver(true), off = qualityObserver(false);
  const a = runCoordinated(spec, data, undefined, runScheduledLedger, on.observe);
  const b = runCoordinated(spec, data, undefined, runScheduledLedger, off.observe);
  assert.deepEqual(a.points, b.points);
  assert.deepEqual(a.ledger, b.ledger);
  assert.deepEqual(a.decisions.map(d => d.weights), b.decisions.map(d => d.weights));
  assert.equal(on.decisions.length, a.plan.number_of_folds);
  for (const d of on.decisions) {
    assert.ok(d.information_cutoff < d.decision_date);
    assert.equal(d.training_start, a.plan.folds.find(f => f.decision_date === d.decision_date)!.training_start);
  }
});
test("Future-only price perturbation cannot change earlier forecasts, quality evidence or allocations", () => {
  const data = preparedDataset(), policy = { ...request, forecast: { ...forecastConfig, signals: [{ ...forecastConfig.signals[0], lookback_sessions: 21 }] } };
  const run = (d: typeof data) => {
    const q = qualityObserver(true);
    return runCoordinated(normalizeCoordinated(policy, d), d, undefined, runScheduledLedger, q.observe);
  };
  const a = run(data), changed = structuredClone(data), cutoff = a.decisions[0].information_cutoff;
  for (const row of changed.rows) if (row.date > cutoff) for (const t of Object.keys(row.prices)) row.prices[t] *= 1.13;
  const b = run(changed);
  assert.deepEqual(a.decisions[0], b.decisions[0]);
  assert.equal(a.decisions[0].quality.input_hash, b.decisions[0].quality.input_hash);
});
test("Expanding quarterly walk-forward evaluates the gate exactly once per actual rebalance", () => {
  const data = preparedDataset(), q = qualityObserver(true);
  const spec = normalizeCoordinated({ ...request, window_type: "EXPANDING", rebalance_frequency: "QUARTERLY", evaluation_end_exclusive: "2024-07-21" }, data);
  const result = runCoordinated(spec, data, undefined, runScheduledLedger, q.observe);
  assert.equal(q.decisions.length, result.plan.number_of_folds);
  assert.ok(q.decisions.length >= 2);
  assert.equal(new Set(q.decisions.map(d => d.training_start)).size, 1);
  assert.ok(q.decisions.at(-1)!.observations > q.decisions[0].observations);
});
test("Window-bounded Ridge forecasts and quality cannot see later prices or pending labels", () => {
  const data = preparedDataset();
  const ridge = { ...request, forecast: { ...forecastConfig, model: "SIGNAL_RIDGE" as const, training_sessions: 16, signals: [{ ...forecastConfig.signals[0], lookback_sessions: 21 }] } };
  const run = (d: typeof data) => {
    const q = qualityObserver(true);
    return runCoordinated(normalizeCoordinated(ridge, d), d, undefined, runScheduledLedger, q.observe);
  };
  const a = run(data), changed = structuredClone(data), cutoff = a.decisions[0].information_cutoff;
  for (const r of changed.rows) if (r.date > cutoff) for (const t of Object.keys(r.prices)) r.prices[t] *= 1.17;
  const b = run(changed);
  assert.deepEqual(a.decisions[0], b.decisions[0]);
  assert.equal(a.decisions[0].quality.predictive_quality, "NOT_USED_NO_FUTURE_LABELS");
});
