import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  beta,
  regression,
  DEFAULT_REGRESSION,
} from "../allocation-core/risk-analytics/analytics";
import {
  runBacktestEngine,
  defaultBacktestConfig,
  type PriceRow,
} from "../calculator";
import {
  controlTrack,
  matchBeta,
  BETA_MATCH_TOLERANCE,
  type ControlDay,
} from "./exposure-controls";
import { exposureModelDefinition } from "./exposure-model-definition";

const near = (a: number, b: number, tolerance = 1e-10) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
// Explicit synthetic unit fixtures only; never substituted for empirical runs.
function sample(count = 60, cash = 0): ControlDay[] {
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
    fold_id: Math.floor(i / 20),
    market_return: 0.012 * Math.sin(i * 0.71) + 0.003 * Math.cos(i * 0.21),
    cash_return: cash,
    fold_offset: i % 20,
    fold_last: i % 20 === 19 || i === count - 1,
  }));
}
test("SYNTHETIC known answer: next-close passive entry, real notional cost, hold and no liquidation", () => {
  const days = sample(4).map((d, i) => ({
    ...d,
    market_return: [0.01, 0.02, 0.1, -0.05][i],
    fold_last: i === 3,
  }));
  const p = controlTrack(days, 1, 5);
  assert.deepEqual(
    p.map((d) => d.spy_exposure),
    [0, 0, 1, 1],
  );
  near(p[1].realized_cost, (100 * 0.0005) / 1.0005);
  near(p.at(-1)!.index, (100 / 1.0005) * 1.1 * 0.95);
  assert.ok(p[1].actual_traded_notional > 0);
  assert.equal(p[3].actual_traded_notional, 0);
  assert.equal(p[2].realized_cost, 0);
});
test("SYNTHETIC property: aligned folds, NAV self-financing, constant beginning exposure after entry and no terminal trade", () => {
  for (const cash of [0, 0.00003])
    for (const lambda of [0, 0.13, 0.5, 0.93, 1])
      for (const cost of [0, 3.125, 17.5]) {
        const days = sample(60, cash),
          p = controlTrack(days, lambda, cost);
        assert.deepEqual(
          p.map((d) => [d.date, d.fold_id]),
          days.map((d) => [d.date, d.fold_id]),
        );
        for (const d of p) {
          near(
            d.net_return,
            d.spy_exposure * d.market_return +
              d.cash_allocation * d.cash_return -
              d.realized_cost / d.beginning_nav,
          );
          near(d.ending_nav, d.beginning_nav * (1 + d.net_return));
          near(d.realized_cost, (d.actual_traded_notional * cost) / 10000);
          if (d.fold_offset > 1) near(d.spy_exposure, lambda);
          if (d.fold_offset === 0) assert.equal(d.beginning_nav, 100);
          if (d.fold_last) assert.equal(d.actual_traded_notional, 0);
        }
      }
});
test("SYNTHETIC oracle: passive path matches the unchanged certified D5 next-close calculator", () => {
  const rows: PriceRow[] = [];
  let price = 100;
  for (let i = 0; i < 430; i++) {
    const date = new Date(Date.UTC(2020, 0, 1 + i));
    if ([0, 6].includes(date.getUTCDay())) continue;
    price *= 1 + 0.007 * Math.sin(i * 0.3);
    rows.push({
      date: date.toISOString().slice(0, 10),
      prices: { SPY: price },
    });
  }
  const start = rows.find((r) => r.date >= "2020-09-01")!.date;
  const result = runBacktestEngine(
    rows.filter((r) => r.date < "2020-10-01"),
    [
      {
        ticker: "SPY",
        name: "SPY",
        sector: "Test",
        enabled: true,
        priorWeight: 0,
      },
    ],
    {
      cashMin: 0,
      cashMax: 1,
      maxEtfWeight: 1,
      minEtfWeight: 0,
      minInclusionThreshold: 0,
      targetActiveEtfs: 1,
      diversificationEnabled: false,
    },
    {
      ...defaultBacktestConfig(),
      warmupDays: 20,
      startDate: start,
      transactionCostBps: 7.25,
      slippageBps: 0,
    },
    null,
    undefined,
    () => ({ SPY: 1 }),
    {
      initialNav: 100,
      initialCash: 100,
      initialHoldings: {},
      dailyCashYield: 0,
      d5GrossTradeCosts: true,
    },
  );
  assert.equal(result.hasSufficientData, true);
  const days = result.dailyLedger.map((d, i, all) => ({
    date: d.date,
    fold_id: 0,
    fold_offset: i,
    fold_last: i === all.length - 1,
    market_return:
      rows.find((r) => r.date === d.date)!.prices.SPY /
        rows.find((r) => r.date === d.intervalStart)!.prices.SPY -
      1,
    cash_return: 0,
  }));
  const p = controlTrack(days, 1, 7.25);
  result.dailyLedger.forEach((d, i) => {
    near(p[i].net_return, d.netPnl / d.beginningNav);
    near(p[i].realized_cost, d.transactionCosts);
    near(p[i].ending_nav, d.endingNav);
  });
});
test("SYNTHETIC properties: deterministic exact beta roots, range extrema and no silent infeasibility clamp", () => {
  for (const cash of [0, 0.00003])
    for (const cost of [0, 7.25, 99])
      for (const target of [0.1, 0.45, 0.9]) {
        const days = sample(60, cash),
          dynamic = controlTrack(days, target, cost).map((p) => p.net_return);
        const a = matchBeta(days, dynamic, cost),
          b = matchBeta(days, dynamic, cost);
        assert.deepEqual(a, b);
        assert.equal(a.status, "MATCHED");
        if (!("remaining_beta_difference" in a))
          throw new Error("Missing achieved beta");
        assert.ok(
          Math.abs(a.remaining_beta_difference!) <= BETA_MATCH_TOLERANCE,
        );
        // Independent numeric evaluations of the actual control book lie inside the
        // analytic derivative's full attainable range (not just endpoint beta).
        for (let i = 0; i <= 50; i++) {
          const x = controlTrack(days, i / 50, cost);
          const measured = beta(
            x.map((d) => ({
              date: d.date,
              portfolio: d.net_return,
              market: d.market_return,
              rf: d.cash_return,
            })),
          ).value!;
          assert.ok(
            measured >= a.minimum_attainable_control_beta! - 1e-9 &&
              measured <= a.maximum_attainable_control_beta! + 1e-9,
          );
        }
      }
  const days = sample(),
    impossible = matchBeta(
      days,
      days.map((d) => 2 * d.market_return),
      0,
    );
  assert.equal(impossible.status, "MATCHED_BETA_CONTROL_INFEASIBLE");
  assert.ok(
    "remaining_beta_difference" in impossible &&
      Math.abs(impossible.remaining_beta_difference!) > BETA_MATCH_TOLERANCE,
  );
  assert.ok(
    "dynamic_beta" in impossible &&
      impossible.dynamic_beta.value! >
        impossible.maximum_attainable_control_beta!,
  );
});
test("Undefined beta and unfinanceable cost domains are explicit, never substituted", () => {
  const days = sample().map((d) => ({ ...d, market_return: 0.001 }));
  assert.equal(
    matchBeta(
      days,
      days.map(() => 0),
      0,
    ).status,
    "MATCHED_BETA_CONTROL_UNDEFINED",
  );
  assert.equal(
    matchBeta(
      sample(),
      sample().map((d) => 0.5 * d.market_return),
      10000,
    ).status,
    "MATCHED_BETA_MAINTENANCE_COST_UNSUPPORTED",
  );
});
test("Certified AL02 CAPM/HAC inference is reused against its independent SciPy oracle", () => {
  const oracle = JSON.parse(
    readFileSync("reports/al02/oracle-fixtures.json", "utf8"),
  ).regressions.CAPM;
  const r = regression(
    oracle.pairs,
    "CAPM",
    oracle.pairs.at(-1).date,
    DEFAULT_REGRESSION,
  );
  assert.equal(r.status, "VALID");
  assert.equal(r.inference_status, "VALID");
  oracle.coefficients.forEach((v: number, i: number) =>
    near(r.coefficients![i], v),
  );
  oracle.HAC.standard_errors.forEach((v: number, i: number) =>
    near(r.standard_errors![i], v),
  );
  oracle.HAC.t.forEach((v: number, i: number) => near(r.t_statistics![i]!, v));
});
test("Model transparency reads actual source weights/thresholds and actual registered policy set", () => {
  const d = exposureModelDefinition();
  assert.equal(d.information_window_observations, 252);
  assert.equal(d.fixed_selection_metric, "net_sharpe");
  assert.equal(d.components.length, 10);
  near(
    d.components.reduce((s, c) => s + c.weight, 0),
    1,
  );
  assert.deepEqual(
    d.regime_thresholds.map((t) => t.minimum_score),
    [70, 55, 40, 25, 0],
  );
  assert.equal(d.candidate_policy_set.length, 5);
  assert.match(d.product_meaning, /does not allocate capital among ETFs/);
  assert.match(d.limitation, /deterministic baseline rule/);
});
