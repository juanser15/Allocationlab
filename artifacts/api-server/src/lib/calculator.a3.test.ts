import assert from "node:assert/strict";
import { test } from "node:test";
import { computeFactors, type PriceRow } from "./calculator";
import type { FactorDefinition } from "./factor-library";

function factor(overrides: Partial<FactorDefinition> = {}): FactorDefinition {
  return {
    id: "factor",
    name: "Test Factor",
    description: "",
    family: "Test",
    enabled: true,
    status: "active",
    inputSeries: "price",
    calculationType: "momentum",
    formula: "P(t) / P(t-lookback) - 1",
    direction: "higher_is_better",
    lookback: 2,
    lag: 0,
    normalization: "percentile_rank",
    winsorizationLower: 0,
    winsorizationUpper: 1,
    missingDataTreatment: "exclude",
    baseWeight: 1,
    regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 },
    activeRegimes: ["risk_on", "neutral", "risk_off"],
    dataSource: "synthetic prices",
    benchmarkTicker: null,
    currentCoverage: 1,
    availabilityReason: null,
    version: "a3-test",
    ...overrides,
  };
}

function rowsFromSeries(series: Record<string, number[]>): PriceRow[] {
  const length = Math.max(...Object.values(series).map((prices) => prices.length));
  return Array.from({ length }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, "0")}`,
    prices: Object.fromEntries(Object.entries(series)
      .filter(([, prices]) => prices[index] !== undefined)
      .map(([ticker, prices]) => [ticker, prices[index]])),
  }));
}

function pricesForReturn(value: number): number[] {
  return [100, 100, 100 * (1 + value)];
}

function contribution(ticker: string, data: ReturnType<typeof computeFactors>[number], factorId: string) {
  const result = data.factorContributions.find((item) => item.factorId === factorId);
  assert.ok(result, `${ticker} should have a contribution for ${factorId}`);
  return result;
}

test("TEST 4 — log-price trend quality preserves trend direction", () => {
  const rising = Array.from({ length: 11 }, (_, index) => 100 * Math.exp(0.025 * index));
  const falling = Array.from({ length: 11 }, (_, index) => 100 * Math.exp(-0.025 * index));
  const result = computeFactors(rowsFromSeries({ RISE: rising, FALL: falling }), ["RISE", "FALL"], {
    factors: [factor({ id: "trend", calculationType: "trend_quality", lookback: 10 })],
  });
  const riseScore = contribution("RISE", result.find((item) => item.ticker === "RISE")!, "trend").rawValue!;
  const fallScore = contribution("FALL", result.find((item) => item.ticker === "FALL")!, "trend").rawValue!;
  assert.ok(riseScore > 0.99, `expected strong positive trend quality, got ${riseScore}`);
  assert.ok(fallScore < -0.99, `expected strong negative trend quality, got ${fallScore}`);
});

test("TEST 5 — residual momentum and correlation stability are explicitly unsupported", () => {
  const result = computeFactors(rowsFromSeries({
    AAA: pricesForReturn(0.01),
    BBB: pricesForReturn(0.02),
    SPY: pricesForReturn(0.005),
  }), ["AAA", "BBB", "SPY"], {
    factors: [
      factor({ id: "residual", calculationType: "residual_momentum", benchmarkTicker: "SPY" }),
      factor({ id: "stability", calculationType: "correlation_stability" }),
    ],
  });
  for (const item of result) {
    for (const id of ["residual", "stability"]) {
      const entry = contribution(item.ticker, item, id);
      assert.equal(entry.available, false);
      assert.equal(entry.calculationStatus, "unavailable");
      assert.equal(entry.rawValue, null);
      assert.match(entry.unavailableReason ?? "", /Unsupported calculation type/);
    }
  }
});

test("TEST 6 — configured winsorization clips cross-sectional extremes before normalization", () => {
  const returns = [-0.03, -0.01, 0.01, 0.03, 1];
  const series = Object.fromEntries(returns.map((value, index) => [`T${index}`, pricesForReturn(value)]));
  const rows = rowsFromSeries(series);
  const noWinsor = computeFactors(rows, Object.keys(series), { factors: [factor({ id: "off" })] });
  const winsorized = computeFactors(rows, Object.keys(series), {
    factors: [factor({ id: "on", winsorizationLower: 0.25, winsorizationUpper: 0.75 })],
  });
  const extremeOff = contribution("T4", noWinsor.find((item) => item.ticker === "T4")!, "off");
  const extremeOn = contribution("T4", winsorized.find((item) => item.ticker === "T4")!, "on");
  assert.equal(extremeOff.rawValue, 1);
  assert.equal(extremeOff.winsorizedValue, 1);
  assert.equal(extremeOn.rawValue, 1);
  assert.ok(Math.abs(extremeOn.winsorizedValue! - 0.03) < 1e-12);
});

test("TEST 7 — direction, percentile, z-score, robust-z, and missing-data policies", () => {
  const returns = [-0.03, -0.01, 0.01, 0.03];
  const series = Object.fromEntries(returns.map((value, index) => [`T${index}`, pricesForReturn(value)]));
  const ids = ["high-percentile", "low-percentile", "z", "robust"];
  const result = computeFactors(rowsFromSeries(series), Object.keys(series), {
    factors: [
      factor({ id: ids[0], direction: "higher_is_better" }),
      factor({ id: ids[1], direction: "lower_is_better" }),
      factor({ id: ids[2], normalization: "z_score" }),
      factor({ id: ids[3], normalization: "robust_z_score" }),
    ],
  });
  const sorted = result.slice().sort((a, b) => a.ticker.localeCompare(b.ticker));
  const higherScores = sorted.map((item) => contribution(item.ticker, item, ids[0]).normalizedValue!);
  const lowerScores = sorted.map((item) => contribution(item.ticker, item, ids[1]).normalizedValue!);
  [0, 100 / 3, 200 / 3, 100].forEach((score, index) => assert.ok(Math.abs(higherScores[index] - score) < 1e-12));
  [100, 200 / 3, 100 / 3, 0].forEach((score, index) => assert.ok(Math.abs(lowerScores[index] - score) < 1e-12));

  const sampleStd = Math.sqrt(0.0006666666666666666);
  for (let index = 0; index < returns.length; index++) {
    const expectedZ = Math.max(0, Math.min(100, 50 + (returns[index] / sampleStd) * 15));
    assert.ok(Math.abs(contribution(sorted[index].ticker, sorted[index], ids[2]).normalizedValue! - expectedZ) < 1e-10);
    const expectedRobustZ = Math.max(0, Math.min(100, 50 + (returns[index] / (1.4826 * 0.02)) * 15));
    assert.ok(Math.abs(contribution(sorted[index].ticker, sorted[index], ids[3]).normalizedValue! - expectedRobustZ) < 1e-10);
  }

  const incompleteSeries = {
    A: [100, 100, 102, 103],
    B: [100, 100, 103, 105],
    SHORT: [100, 101, 102],
  };
  const missingResult = computeFactors(rowsFromSeries(incompleteSeries), Object.keys(incompleteSeries), {
    factors: [
      factor({ id: "exclude", lookback: 3, missingDataTreatment: "exclude" }),
      factor({ id: "median", lookback: 3, missingDataTreatment: "cross_sectional_median" }),
    ],
  });
  const short = missingResult.find((item) => item.ticker === "SHORT")!;
  const excluded = contribution("SHORT", short, "exclude");
  const imputed = contribution("SHORT", short, "median");
  assert.equal(excluded.calculationStatus, "unavailable");
  assert.equal(excluded.effectiveWeight, 0);
  assert.equal(imputed.calculationStatus, "imputed");
  assert.equal(imputed.rawValue, null);
  assert.notEqual(imputed.transformedValue, null);
  assert.notEqual(imputed.normalizedValue, null);
});

test("TEST 8 — composite reconciles to full-precision weighted contributions", () => {
  const series = {
    A: pricesForReturn(-0.02),
    B: pricesForReturn(0.01),
    C: pricesForReturn(0.04),
  };
  const result = computeFactors(rowsFromSeries(series), Object.keys(series), {
    factors: [
      factor({ id: "momentum-a", regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 } }),
      factor({ id: "momentum-b", calculationType: "volatility", regimeWeights: { riskOn: 2, neutral: 2, riskOff: 2 } }),
    ],
  });
  for (const item of result) {
    const independentSum = item.factorContributions.reduce((sum, entry) => sum + (entry.weightedContribution ?? 0), 0);
    assert.ok(Math.abs(item.factorScores.composite - independentSum) <= 1e-8);
  }
});