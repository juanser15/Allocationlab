import test from "node:test";
import assert from "node:assert/strict";
import {
  assetFeatures,
  manualScores,
  fitRidge,
  buildAssetForecast,
} from "./forecasts";
import {
  DEFAULT_FORECAST,
  type ForecastConfig,
} from "../../artifacts/api-server/src/lib/workbench/coordinated-contract";
import {
  normalizeCoordinated,
  parseCoordinated,
  preparedDataset,
} from "../../artifacts/api-server/src/lib/workbench/coordinated-calendar";
import { runCoordinated } from "./engine";

const rows = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10),
  prices: { SPY: 100 * 1.01 ** i, IEF: 100 * 0.99 ** i },
}));
const one = [
  {
    id: "MOMENTUM" as const,
    enabled: true,
    lookback_sessions: 1,
    skip_sessions: 0,
    weight: 1,
  },
];
test("Feature oracle: price momentum, average-tie relative rank, signed trend and reversal", () => {
  const definitions = [
    { ...one[0], lookback_sessions: 4 },
    { ...one[0], id: "RELATIVE_MOMENTUM" as const },
    { ...one[0], id: "TREND" as const, lookback_sessions: 4 },
    { ...one[0], id: "REVERSAL" as const },
  ];
  const f = assetFeatures(rows, 10, ["SPY", "IEF"], definitions);
  assert.ok(Math.abs(f[0][0] - (1.01 ** 4 - 1)) < 1e-12);
  assert.equal(f[0][1], 1);
  assert.equal(f[1][1], -1);
  assert.ok(Math.abs(f[0][2] - 1) < 1e-12);
  assert.ok(Math.abs(f[1][2] + 1) < 1e-12);
  assert.ok(Math.abs(f[0][3] + 0.01) < 1e-12);
  assert.throws(() => assetFeatures(rows, 0, ["SPY"], one), /needs 2 prices/);
  assert.throws(
    () => assetFeatures(rows, 5, ["SPY"], [definitions[1]]),
    /at least two/,
  );
});
test("Manual mapping records assumed horizon returns; scores are not implicit percentages", () => {
  const config: ForecastConfig = {
    ...DEFAULT_FORECAST,
    model: "MANUAL_SCORE",
    horizon_sessions: 5,
    signals: one,
    manual_base_return: 0.002,
    manual_score_return: 0.01,
  };
  const forecast = buildAssetForecast(
    config,
    rows,
    ["SPY", "IEF"],
    [1, 1],
    1 / 12,
  );
  assert.deepEqual(forecast.expected_returns, [0.012, -0.008]);
  assert.equal(forecast.horizon_years, 5 / 252);
  assert.deepEqual(
    manualScores([[0.1], [0.1]], one).map((s) => s.score),
    [0, 0],
  );
});
test("Ridge analytic solution, training scaler and a single observation have no sample quota", () => {
  const fit = fitRidge([[-1], [1]], [-2, 2], 1);
  assert.ok(Math.abs(fit.beta[0] - 1) < 1e-12);
  assert.ok(Math.abs(fit.predict([2]) - 2) < 1e-12);
  const single = fitRidge([[7]], [0.04], 0.5);
  assert.equal(single.predict([100]), 0.04);
  assert.deepEqual(single.beta, [0]);
});
test("Ridge label oracle matches prior-cutoff, decision then next-close fills and excludes pending outcomes", () => {
  const config: ForecastConfig = {
    ...DEFAULT_FORECAST,
    model: "SIGNAL_RIDGE",
    horizon_sessions: 2,
    training_sessions: 1,
    signals: one,
  };
  const f = buildAssetForecast(config, rows.slice(0, 15), ["SPY"], [0], 1 / 12);
  assert.equal(f.training!.training_dates, 1);
  assert.equal(f.training!.training_rows, 1);
  assert.equal(f.training!.start, rows[10].date);
  assert.equal(f.training!.last_label_end, rows[14].date);
  assert.ok(
    Math.abs(
      f.expected_returns[0] - (rows[14].prices.SPY / rows[12].prices.SPY - 1),
    ) < 1e-12,
  );
  assert.throws(
    () =>
      buildAssetForecast(
        { ...config, horizon_sessions: 20 },
        rows.slice(0, 15),
        ["SPY"],
        [0],
        1 / 12,
      ),
    /No complete, matured/,
  );
});

const request = {
  contract_version: "allocationlab-coordinated-1.0.0",
  research_scope: "PORTFOLIO",
  evaluation_start: "2024-01-21",
  evaluation_end_exclusive: "2024-07-21",
  training_window_months: 1,
  window_type: "ROLLING",
  rebalance_frequency: "MONTHLY",
  transaction_cost_bps: 10,
  control_mode: "MAX_EXPOSURE",
  maximum_exposure: 0.6,
  risk_budget: 0.1,
  regime_model: "TREND",
  regime_response: "FIXED",
  defensive_multiplier: 0.5,
  etfs: ["SPY", "IEF"],
  maximum_etf_weight: 0.6,
  risk_aversion: 5,
  covariance_shrinkage: 0.2,
};
test("All forecast providers feed the optimizer and preserve the historical mean reference", () => {
  const data = preparedDataset(),
    baseline = runCoordinated(normalizeCoordinated(request, data), data);
  const explicit = runCoordinated(
    normalizeCoordinated({ ...request, forecast: DEFAULT_FORECAST }, data),
    data,
  );
  assert.deepEqual(baseline.points, explicit.points);
  for (const model of ["MANUAL_SCORE", "SIGNAL_RIDGE"] as const) {
    const forecast = {
      ...DEFAULT_FORECAST,
      model,
      signals: one,
      horizon_sessions: 2,
      training_sessions: 8,
    };
    const result = runCoordinated(
      normalizeCoordinated({ ...request, forecast }, data),
      data,
    );
    assert.equal(result.decisions[0].forecast!.model, model);
    assert.ok(
      result.decisions.every(
        (d) => d.optimizer !== null && d.forecast.expected_returns.length === 2,
      ),
    );
    assert.notDeepEqual(result.points, baseline.points);
    assert.ok(
      result.forecast_diagnostics!.observations.every(
        (p) => p.label_end < request.evaluation_end_exclusive,
      ),
    );
  }
  assert.doesNotThrow(() =>
    parseCoordinated({
      ...request,
      forecast: {
        ...DEFAULT_FORECAST,
        model: "SIGNAL_RIDGE",
        signals: one,
        training_sessions: 1,
      },
    }),
  );
});
test("Future price perturbations cannot change earlier Ridge coefficients, forecasts or allocations", () => {
  const data = preparedDataset(),
    forecast = {
      ...DEFAULT_FORECAST,
      model: "SIGNAL_RIDGE" as const,
      signals: one,
      horizon_sessions: 2,
      training_sessions: 8,
    };
  const original = runCoordinated(
    normalizeCoordinated({ ...request, forecast }, data),
    data,
  );
  const date = original.decisions[1].decision_date;
  const altered = {
    ...data,
    rows: data.rows.map((r) =>
      r.date >= date
        ? {
            ...r,
            prices: {
              ...r.prices,
              SPY: r.prices.SPY * 1.7,
              IEF: r.prices.IEF * 0.8,
            },
          }
        : r,
    ),
  };
  const result = runCoordinated(
    normalizeCoordinated({ ...request, forecast }, altered),
    altered,
  );
  assert.deepEqual(result.decisions[0], original.decisions[0]);
  assert.deepEqual(
    result.decisions[1].forecast,
    original.decisions[1].forecast,
  );
});
