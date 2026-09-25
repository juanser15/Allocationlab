import assert from "node:assert/strict";
import { test } from "node:test";
import {
  constructAllocation,
  AllocationConstraintError,
  type Constraints,
  type EtfEntry,
  type EtfFactorData,
  type EnrichedRegimeScores,
} from "./calculator";

const mandate: Constraints = {
  cashMin: 0.5,
  cashMax: 0.6,
  minEtfWeight: 0.05,
  maxEtfWeight: 0.1,
  minInclusionThreshold: 5,
  targetActiveEtfs: 8,
  diversificationEnabled: true,
};

const regime: EnrichedRegimeScores = {
  trend: 50, breadth: 50, volatility: 50, liquidity: 50, composite: 50,
  label: "neutral", components: [], confidence: 100, drivers: "test",
};

function input(count: number, priors: number[] = []): { etfs: EtfEntry[]; factors: EtfFactorData[] } {
  const etfs = Array.from({ length: count }, (_, i) => ({
    ticker: `ETF${i + 1}`,
    name: `ETF ${i + 1}`,
    sector: `Sector ${i + 1}`,
    priorWeight: priors[i] ?? 0,
    enabled: true,
  }));
  const factors = etfs.map((etf, i) => ({
    ticker: etf.ticker,
    factorScores: {
      mom20: 50, mom60: 50, mom120: 50, mom252: 50, trendQuality: 50,
      realizedVol60: 50, drawdown: 50, meanReversion: 50, composite: 100 - i,
      dynamic: {},
    },
    rawMom20: 0, rawMom60: 0, rawMom120: 0, rawMom252: 0, rawVol60: 0,
    rawDrawdown: 0, rawTrendQuality: 0, rawMeanReversion: 0, factorContributions: [],
  }));
  return { etfs, factors };
}

const closeTo = (actual: number, expected: number, tolerance = 1e-10) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

test("A3 TEST 1 — final weights meet min/max/count/cash and reconcile at full precision", () => {
  const { etfs, factors } = input(8);
  const allocations = constructAllocation(factors, etfs, mandate, regime);
  const active = allocations.filter((allocation) => allocation.active);
  const invested = allocations.reduce((sum, allocation) => sum + allocation.weight, 0);
  const cash = 1 - invested;

  assert.equal(active.length, 8);
  assert.ok(cash >= mandate.cashMin! - 1e-10 && cash <= mandate.cashMax! + 1e-10);
  for (const allocation of allocations) {
    if (!allocation.active) assert.equal(allocation.weight, 0);
    else {
      assert.ok(allocation.weight >= mandate.minEtfWeight! - 1e-10);
      assert.ok(allocation.weight <= mandate.maxEtfWeight! + 1e-10);
    }
  }
  closeTo(cash + invested, 1);
});

test("A3 TEST 2 — prior blending cannot breach the final ETF cap", () => {
  const { etfs, factors } = input(8, [0.9, 0.4, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1]);
  const allocations = constructAllocation(factors, etfs, mandate, regime);
  assert.equal(allocations.filter((allocation) => allocation.active).length, 8);
  assert.ok(allocations.every((allocation) => allocation.weight <= mandate.maxEtfWeight! + 1e-10));
  closeTo(allocations.reduce((sum, allocation) => sum + allocation.weight, 0), 0.45);
});

test("A3 TEST 3 — fewer eligible ETFs returns explicit infeasibility", () => {
  const { etfs, factors } = input(6);
  assert.throws(
    () => constructAllocation(factors, etfs, mandate, regime),
    (error: unknown) => error instanceof AllocationConstraintError &&
      /required 8 active ETFs.*only 6 eligible assets/.test(error.reason),
  );
});