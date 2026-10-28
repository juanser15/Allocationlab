import type { PriceRow } from "../../artifacts/api-server/src/lib/calculator";
import type {
  ForecastConfig,
  AssetSignal,
} from "../../artifacts/api-server/src/lib/workbench/coordinated-contract";
import { ResearchError } from "./models";

const total = (x: number[]) => x.reduce((s, v) => s + v, 0);
const fail = (code: string, message: string, details = {}) => {
  throw new ResearchError(code, message, details);
};

/** Features contain prices through `cutoff` only. No padding, imputation or
 * implicit extension of the user's feature lookbacks. Relative momentum is a
 * contemporaneous average-tie rank on the explicit eligible universe. */
export function assetFeatures(
  rows: PriceRow[],
  cutoff: number,
  assets: string[],
  signals: AssetSignal[],
) {
  const raw = assets.map(() => [] as number[]);
  for (const signal of signals) {
    const end = cutoff - signal.skip_sessions,
      start = end - signal.lookback_sessions;
    if (start < 0)
      fail(
        "SIGNAL_HISTORY_REQUIRED",
        `${signal.id} needs ${signal.lookback_sessions + signal.skip_sessions + 1} prices through the cutoff; ${cutoff + 1} are available.`,
        { cutoff: rows[cutoff]?.date, signal: signal.id },
      );
    const values = assets.map((ticker) => {
      const p = rows.slice(start, end + 1).map((row) => row.prices[ticker]);
      if (p.some((v) => !Number.isFinite(v) || v <= 0))
        fail(
          "SIGNAL_HISTORY_REQUIRED",
          `${signal.id}: missing adjusted prices for ${ticker}.`,
          { cutoff: rows[cutoff]?.date, ticker },
        );
      if (signal.id === "TREND") {
        const y = p.map(Math.log),
          mx = (y.length - 1) / 2,
          my = total(y) / y.length;
        const xx = total(y.map((_, i) => (i - mx) ** 2));
        const xy = total(y.map((v, i) => (i - mx) * (v - my)));
        const yy = total(y.map((v) => (v - my) ** 2));
        // A flat price path has zero signed trend quality, by definition.
        return yy === 0 ? 0 : Math.sign(xy) * Math.min(1, xy ** 2 / (xx * yy));
      }
      const value = p.at(-1)! / p[0] - 1;
      return signal.id === "REVERSAL" ? -value : value;
    });
    const feature =
      signal.id === "RELATIVE_MOMENTUM"
        ? values.map((v) => {
            if (assets.length < 2)
              fail(
                "SIGNAL_UNIVERSE_REQUIRED",
                "Relative momentum requires at least two eligible assets.",
              );
            const lower = values.filter((q) => q < v).length,
              ties = values.filter((q) => q === v).length;
            return (2 * (lower + (ties - 1) / 2)) / (assets.length - 1) - 1;
          })
        : values;
    feature.forEach((v, i) => raw[i].push(v));
  }
  return raw;
}

/** Unit-free bounded scores for the manual mapping. Momentum/reversal use
 * contemporaneous average-tie ranks; trend is signed R². Every scale is explicit. */
export function manualScores(features: number[][], signals: AssetSignal[]) {
  return features.map((row, i) => {
    const contributions = row.map((v, j) => {
      let normalized = v;
      if (["MOMENTUM", "REVERSAL"].includes(signals[j].id)) {
        if (features.length < 2) normalized = Math.sign(v);
        else {
          const column = features.map((r) => r[j]),
            less = column.filter((q) => q < v).length,
            ties = column.filter((q) => q === v).length;
          normalized = (2 * (less + (ties - 1) / 2)) / (column.length - 1) - 1;
        }
      }
      return {
        signal: signals[j].id,
        raw: v,
        normalized,
        weight: signals[j].weight,
        weighted: normalized * signals[j].weight,
      };
    });
    const denominator = total(signals.map((s) => Math.abs(s.weight)));
    if (!denominator)
      fail(
        "INVALID_FORECAST",
        "The manual signal combination requires a nonzero absolute weight sum.",
      );
    return {
      asset_index: i,
      score: total(contributions.map((c) => c.weighted)) / denominator,
      contributions,
    };
  });
}

/** Positive-penalty ridge with an unpenalized intercept. Centering permits even
 * one observation: coefficients are zero and the intercept equals that label.
 * No readiness quota, automatic tuning or fitted uncertainty claims. */
export function fitRidge(x: number[][], y: number[], penalty: number) {
  if (
    !x.length ||
    x.length !== y.length ||
    !(penalty > 0) ||
    !Number.isFinite(penalty)
  )
    fail(
      "FORECAST_TRAINING_REQUIRED",
      "Ridge requires observed labels and a finite positive penalty.",
    );
  const n = x.length,
    k = x[0].length;
  const center = Array.from(
    { length: k },
    (_, j) => total(x.map((r) => r[j])) / n,
  );
  const scale = center.map(
    (m, j) => Math.sqrt(total(x.map((r) => (r[j] - m) ** 2)) / n) || 1,
  );
  const z = x.map((r) => r.map((v, j) => (v - center[j]) / scale[j])),
    intercept = total(y) / n;
  const a = center.map((_, i) =>
    center.map(
      (__, j) => total(z.map((r) => r[i] * r[j])) / n + (i === j ? penalty : 0),
    ),
  );
  const b = center.map(
    (_, j) => total(z.map((r, i) => r[j] * (y[i] - intercept))) / n,
  );
  const l = a.map(() => Array(k).fill(0));
  for (let i = 0; i < k; i++)
    for (let j = 0; j <= i; j++) {
      const v = a[i][j] - total(l[i].slice(0, j).map((q, t) => q * l[j][t]));
      if (i === j && (!(v > 0) || !Number.isFinite(v)))
        fail(
          "FORECAST_NUMERICAL_FAILURE",
          "Ridge system is numerically undefined for the selected inputs.",
        );
      l[i][j] = i === j ? Math.sqrt(v) : v / l[j][j];
    }
  const f = Array(k).fill(0),
    beta = Array(k).fill(0);
  for (let i = 0; i < k; i++)
    f[i] = (b[i] - total(l[i].slice(0, i).map((v, j) => v * f[j]))) / l[i][i];
  for (let i = k - 1; i >= 0; i--)
    beta[i] =
      (f[i] - total(beta.slice(i + 1).map((v, j) => l[i + j + 1][i] * v))) /
      l[i][i];
  return {
    intercept,
    beta,
    center,
    scale,
    penalty,
    training_rows: n,
    predict: (row: number[]) =>
      intercept +
      total(row.map((v, j) => (beta[j] * (v - center[j])) / scale[j])),
  };
}

export function buildAssetForecast(
  config: ForecastConfig,
  available: PriceRow[],
  assets: string[],
  historicalAnnualMean: number[],
  baselineHorizon: number,
) {
  if (config.model === "HISTORICAL_MEAN")
    return {
      model: config.model,
      horizon_years: baselineHorizon,
      horizon_sessions: null,
      annual_mean: historicalAnnualMean,
      expected_returns: historicalAnnualMean.map((v) => v * baselineHorizon),
      units: "ARITHMETIC_HOLDING_RETURN",
      calibration: "HISTORICAL_ARITHMETIC_MEAN_252_REFERENCE",
      predictions: assets.map((ticker, i) => ({
        ticker,
        expected_return: historicalAnnualMean[i] * baselineHorizon,
      })),
    };
  const signals = config.signals.filter((s) => s.enabled),
    cutoff = available.length - 1;
  const current = assetFeatures(available, cutoff, assets, signals),
    horizon = config.horizon_sessions,
    years = horizon / 252;
  const featureNames = signals.map((s) => s.id);
  if (config.model === "MANUAL_SCORE") {
    const scores = manualScores(current, signals);
    const predictions = scores.map((s, i) => ({
      ticker: assets[i],
      ...s,
      expected_return:
        config.manual_base_return + config.manual_score_return * s.score,
    }));
    return {
      model: config.model,
      horizon_years: years,
      horizon_sessions: horizon,
      units: "ARITHMETIC_HOLDING_RETURN",
      calibration: "USER_ASSUMPTION_NOT_FITTED",
      feature_names: featureNames,
      predictions,
      annual_mean: predictions.map((p) => p.expected_return / years),
      expected_returns: predictions.map((p) => p.expected_return),
    };
  }
  const xs: number[][] = [],
    ys: number[] = [],
    dates: string[] = [],
    labelEnds: string[] = [];
  let missing = 0;
  // Anchor the requested N-date training window at the latest cutoff whose
  // full forward outcome is known. Even N=1 can fit; pending recent cutoffs
  // never consume the user's requested count or enter the scaler/fit.
  const latestMatured = cutoff - 2 - horizon;
  const first = Math.max(0, latestMatured - config.training_sessions + 1);
  const pending = Math.min(cutoff + 1, horizon + 2);
  for (let t = first; t <= latestMatured; t++) {
    const execution = t + 2,
      end = execution + horizon;
    // Features use the prior session. Historical signal is t+1 and its fill t+2,
    // matching the ledger's decision-day -> next-observed-close convention.
    let features: number[][];
    try {
      features = assetFeatures(available, t, assets, signals);
    } catch (e) {
      if (e instanceof ResearchError && e.code === "SIGNAL_HISTORY_REQUIRED") {
        missing++;
        continue;
      }
      throw e;
    }
    const labels = assets.map(
      (ticker) =>
        available[end].prices[ticker] / available[execution].prices[ticker] - 1,
    );
    if (labels.some((v) => !Number.isFinite(v))) {
      missing++;
      continue;
    }
    xs.push(...features);
    ys.push(...labels);
    dates.push(available[t].date);
    labelEnds.push(available[end].date);
  }
  if (!xs.length)
    fail(
      "FORECAST_TRAINING_REQUIRED",
      "No complete, matured return labels exist inside the chosen Ridge training window. Review the training window, signal lookbacks, forecast horizon or data coverage; nothing was extended.",
      {
        requested_training_sessions: config.training_sessions,
        excluded_pending_dates: pending,
        excluded_missing_dates: missing,
      },
    );
  const fit = fitRidge(xs, ys, config.ridge_penalty);
  const predictions = current.map((row, i) => ({
    ticker: assets[i],
    expected_return: fit.predict(row),
    intercept: fit.intercept,
    contributions: row.map((v, j) => ({
      signal: featureNames[j],
      raw: v,
      standardized: (v - fit.center[j]) / fit.scale[j],
      coefficient: fit.beta[j],
      contribution: (fit.beta[j] * (v - fit.center[j])) / fit.scale[j],
    })),
  }));
  if (predictions.some((p) => !Number.isFinite(p.expected_return)))
    fail("FORECAST_NUMERICAL_FAILURE", "Forecast contains nonfinite values.");
  return {
    model: config.model,
    horizon_years: years,
    horizon_sessions: horizon,
    units: "ARITHMETIC_HOLDING_RETURN",
    calibration: "POOLED_RIDGE_MATURED_FORWARD_RETURNS",
    feature_names: featureNames,
    predictions,
    expected_returns: predictions.map((p) => p.expected_return),
    annual_mean: predictions.map((p) => p.expected_return / years),
    training: {
      requested_sessions: config.training_sessions,
      available_sessions: Math.max(0, latestMatured - first + 1),
      window_end: available[latestMatured]?.date ?? null,
      training_dates: dates.length,
      training_rows: xs.length,
      start: dates[0],
      end: dates.at(-1),
      last_label_end: labelEnds.at(-1),
      excluded_pending_dates: pending,
      excluded_missing_dates: missing,
      scaler_center: fit.center,
      scaler_scale: fit.scale,
      coefficients: fit.beta,
      intercept: fit.intercept,
      penalty: fit.penalty,
      penalty_convention: "MEAN_SQUARED_ERROR_PLUS_LAMBDA_BETA_SQUARED",
      overlapping_labels: horizon > 1,
      uncertainty: "NOT_ESTIMATED",
    },
  };
}
