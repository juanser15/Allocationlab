import test from "node:test";
import assert from "node:assert/strict";
import { fitGaussianHMM, filterGaussian, optimize, quadratic } from "./models";
import { runCoordinated } from "./engine";
import {
  COORDINATED_SPEC,
  normalizeCoordinated,
  planCoordinated,
  coordinatedRunId,
  preparedDataset,
  type CoordinatedRequest,
} from "../../artifacts/api-server/src/lib/workbench/coordinated-calendar";
const request: CoordinatedRequest = {
  contract_version: COORDINATED_SPEC,
  evaluation_start: "2024-01-21",
  evaluation_end_exclusive: "2024-07-21",
  training_window_months: 24,
  window_type: "ROLLING",
  rebalance_frequency: "MONTHLY",
  transaction_cost_bps: 10,
  control_mode: "MAX_EXPOSURE",
  maximum_exposure: 0.6,
  risk_budget: 0.06,
  regime_model: "HMM",
  regime_response: "ADAPTIVE",
  defensive_multiplier: 0.5,
  etfs: ["SPY", "EFA", "IEF", "GLD"],
  maximum_etf_weight: 0.4,
  risk_aversion: 5,
  covariance_shrinkage: 0.2,
};
test("Forward filtering matches exhaustive hidden-path enumeration", () => {
  const x = [0.2, -0.5, 0.8],
    m = [-0.3, 0.5],
    v = [0.2, 0.8],
    a = [
      [0.8, 0.2],
      [0.1, 0.9],
    ],
    pi = [0.4, 0.6],
    mass = [0, 0];
  const density = (x: number, j: number) =>
    Math.exp((-0.5 * (x - m[j]) ** 2) / v[j]) / Math.sqrt(2 * Math.PI * v[j]);
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++)
      for (let k = 0; k < 2; k++)
        mass[k] +=
          pi[i] *
          density(x[0], i) *
          a[i][j] *
          density(x[1], j) *
          a[j][k] *
          density(x[2], k);
  const f = filterGaussian(x, m, v, a, pi);
  assert.ok(Math.abs(f.posterior[1] - mass[1] / (mass[0] + mass[1])) < 1e-12);
  assert.ok(Math.abs(f.logLikelihood - Math.log(mass[0] + mass[1])) < 1e-12);
});
test("HMM is deterministic, orders states by variance and rejects degenerate samples", () => {
  let seed = 123;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed + 0.5) / 4294967296;
  };
  const x = Array.from(
    { length: 600 },
    (_, i) =>
      Math.sqrt(-2 * Math.log(rand())) *
      Math.cos(2 * Math.PI * rand()) *
      (Math.floor(i / 100) % 2 ? 0.025 : 0.004),
  );
  const f = fitGaussianHMM(x);
  assert.deepEqual(f, fitGaussianHMM(x));
  assert.ok(f.variances[0] < f.variances[1]);
  assert.ok(f.high_risk_probability > 0.8);
  assert.ok(f.converged_initializations > 0);
  assert.throws(() => fitGaussianHMM(Array(300).fill(0.01)), /constant/);
});
test("Optimizer matches analytical one-asset optimum and binding volatility ceiling", () => {
  const base = {
    cap: 0.8,
    maxWeight: 1,
    riskAversion: 2,
    cost: 0,
    horizon: 1,
    volatility: null,
  };
  const a = optimize([0.04], [[0.04]], [0], base);
  assert.ok(Math.abs(a.weights[0] - 0.5) < 1e-7);
  const b = optimize([0.04], [[0.04]], [0], { ...base, volatility: 0.04 });
  assert.ok(Math.abs(b.weights[0] - 0.2) < 1e-6);
  const c = optimize([-0.01], [[0.04]], [0], base);
  assert.equal(c.weights[0], 0);
  const d = optimize([0.04], [[0.04]], [0.1], { ...base, cost: 0.05 });
  assert.ok(Math.abs(d.weights[0] - 0.1) < 1e-7);
});
test("Optimizer respects correlated portfolio risk, box constraints and total exposure", () => {
  const s = [
      [0.04, 0.018],
      [0.018, 0.09],
    ],
    o = {
      cap: 0.55,
      maxWeight: 0.35,
      riskAversion: 1,
      cost: 0.001,
      horizon: 1 / 12,
      volatility: 0.04,
    };
  const a = optimize([0.15, 0.12], s, [0.2, 0.2], o);
  assert.ok(a.weights.every((w) => w >= 0 && w <= 0.35));
  assert.ok(a.exposure <= 0.55 + 1e-7);
  assert.ok(Math.sqrt(quadratic(a.weights, s)) <= 0.0400001);
});
test("Explicit validation and financial identities; no silent date or universe repair", () => {
  assert.throws(() => planCoordinated({ ...request, etfs: [] }));
  assert.throws(() =>
    planCoordinated({ ...request, training_window_months: 6 }),
  );
  assert.throws(() => planCoordinated({ ...request, risk_budget: 0 }));
  assert.throws(() => planCoordinated({ ...request, surprise: 1 }));
  const id = coordinatedRunId(normalizeCoordinated(request));
  assert.notEqual(
    id,
    coordinatedRunId(
      normalizeCoordinated({ ...request, control_mode: "RISK_BUDGET" }),
    ),
  );
  assert.equal(
    id,
    coordinatedRunId(
      normalizeCoordinated({ ...request, etfs: [...request.etfs].reverse() }),
    ),
  );
});
test("Both controls and all classifiers run on real data with one self-financing ledger", () => {
  const data = preparedDataset();
  for (const regime_model of ["CURRENT", "TREND", "TREND_VOL", "HMM"] as const)
    for (const control_mode of ["MAX_EXPOSURE", "RISK_BUDGET"] as const) {
      const spec = normalizeCoordinated(
          { ...request, regime_model, control_mode },
          data,
        ),
        r = runCoordinated(spec, data);
      assert.equal(r.decisions.length, 6);
      assert.equal(r.ledger[0].beginningNav, 100);
      assert.equal(r.ledger[0].beginningCash, 100);
      for (let i = 0; i < r.ledger.length; i++) {
        const d = r.ledger[i];
        if (i) {
          assert.equal(d.beginningNav, r.ledger[i - 1].endingNav);
          assert.deepEqual(
            d.beginningPositions.map((p) => p.quantity),
            r.ledger[i - 1].endingPositions.map((p) => p.quantity),
          );
        }
        assert.ok(
          Math.abs(
            d.transactionCosts -
              d.trades.reduce((s, t) => s + Math.abs(t.notional), 0) * 0.001,
          ) < 1e-8,
        );
      }
      for (const d of r.decisions) {
        assert.ok(d.information_cutoff < d.decision_date);
        assert.ok(
          (Object.values(d.weights).reduce(
            (s: any, w: any) => s + w,
            0,
          ) as number) <=
            d.maximum_exposure + 1e-7,
        );
        if (d.risk_budget !== null)
          assert.ok(d.estimated_volatility <= d.risk_budget + 1e-7);
      }
      assert.ok(Number.isFinite(r.metrics.cagr));
      assert.equal(r.points.length, r.ledger.length);
    }
});
test("Future price mutations cannot change prior HMM decisions or existing portfolio path", () => {
  const data = preparedDataset(),
    changed = structuredClone(data),
    cutoff = "2024-06-21";
  for (const r of changed.rows)
    if (r.date >= cutoff)
      for (const t of Object.keys(r.prices)) r.prices[t] *= 1.25;
  const a = runCoordinated(normalizeCoordinated(request, data), data),
    b = runCoordinated(normalizeCoordinated(request, changed), changed);
  assert.deepEqual(
    a.decisions.filter((d) => d.decision_date <= cutoff),
    b.decisions.filter((d) => d.decision_date <= cutoff),
  );
  assert.deepEqual(
    a.points.filter((p) => p.date < cutoff),
    b.points.filter((p) => p.date < cutoff),
  );
});
