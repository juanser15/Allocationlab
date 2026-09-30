import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { canonicalizeLongOnlyCapital } from "./long-only-canonicalization";
import { certifyRobustPoint } from "./robust-solver-d4";
import { defaultBacktestConfig, runBacktestEngine } from "./calculator";

const tolerance = 1e-8;
const captured = JSON.parse(readFileSync("../../reports/d6-general-correction/rejected-solver.json", "utf8"));

test("original rejected vector is preserved; bounded executable vector recertifies the original objective", () => {
  const original = [...captured.solution];
  assert.equal(original[1], -3.686945489064785e-15);
  const result = canonicalizeLongOnlyCapital(original, captured.size, tolerance);
  assert.deepEqual(original, captured.solution);
  assert.equal(result.solution[1], 0);
  assert.ok(result.maximumAdjustment <= tolerance);
  assert.ok(result.solution.every((value) => value >= 0));
  const certificate = certifyRobustPoint(captured.Hessian, captured.linear, captured.forecastCovariance,
    captured.constraints, captured.kappa, captured.robustSolve.lambda, result.solution);
  assert.ok(certificate.primalResidual <= tolerance);
  assert.ok(certificate.stationarityResidual <= tolerance);
});

test("only bounded negatives are canonicalized; material and nonfinite values fail explicitly", () => {
  for (const epsilon of [Number.EPSILON, 1e-12, 1e-9]) {
    const original = [-epsilon, 0.8 + epsilon, 0.2];
    const result = canonicalizeLongOnlyCapital(original, 3, tolerance);
    assert.equal(result.solution[0], 0);
    assert.ok(Math.abs(result.solution.reduce((sum, value) => sum + value, 0) - 1) <= tolerance);
    assert.equal(result.solution[2], 0.2);
  }
  for (const value of [-1e-5, -0.1, NaN, Infinity, -Infinity, "0", null]) {
    assert.throws(() => canonicalizeLongOnlyCapital([value as number, 1, 0], 3, tolerance));
  }
  assert.throws(() => canonicalizeLongOnlyCapital([-1e-9, 0.6, 0], 3, tolerance),
    /exceeds/);
});

test("captured positive and zero regularization paths, all dates and robustness variants, recertify without refitting", () => {
  const records = readFileSync("../../reports/d6-general-correction/reproduction-trace.jsonl", "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));
  const lambdas = new Set<number>();
  for (const record of records.filter((record) => record.stage === "b2.solver.raw")) {
    const raw = JSON.parse(record.payload);
    lambdas.add(raw.request.rebalanceRegularization.lambdaR);
    const canonical = canonicalizeLongOnlyCapital(raw.solution, raw.size, tolerance);
    if (!raw.robustSolve) continue;
    const certificate = certifyRobustPoint(raw.Hessian, raw.linear, raw.forecastCovariance,
      raw.constraints, raw.kappa, raw.robustSolve.lambda, canonical.solution);
    assert.ok(certificate.primalResidual <= tolerance);
    assert.ok(certificate.stationarityResidual <= tolerance);
  }
  assert.deepEqual([...lambdas].sort(), [0, 0.01]);
});

function execute(ticker: string, year: number, weight: number, signed = false) {
  return runBacktestEngine(Array.from({ length: 8 }, (_, index) => ({
    date: `${year}-01-${String(index + 2).padStart(2, "0")}`, prices: { [ticker]: 100 },
  })), [{ ticker, name: ticker, sector: "test", priorWeight: 0, enabled: true }], {
    cashMin: 0, cashMax: 1, maxEtfWeight: 1, minInclusionThreshold: 0,
    targetActiveEtfs: 1, diversificationEnabled: false,
  }, { ...defaultBacktestConfig(), warmupDays: 3, executionTiming: "same_close",
    transactionCostBps: 0, slippageBps: 0 }, null, undefined, () => ({ [ticker]: weight }),
  { initialNav: 100, initialCash: 100, initialHoldings: {}, dailyCashYield: 0, allowShortPositions: signed });
}

test("execution rejects raw negatives/nonfinite on other assets/dates but accepts canonical long-only and valid signed", () => {
  for (const [ticker, year] of [["RENAMED", 2031], ["OTHER", 2042]] as const) {
    for (const weight of [-3.686945489064785e-15, -0.2, NaN, Infinity, -Infinity]) {
      const rejected = execute(ticker, year, weight);
      assert.equal(rejected.hasSufficientData, false);
      assert.match(rejected.insufficientReason!, /Invalid target exposure/);
    }
    const canonical = canonicalizeLongOnlyCapital([-1e-12, 1 + 1e-12], 2, tolerance);
    const accepted = execute(ticker, year, canonical.solution[0]);
    assert.equal(accepted.hasSufficientData, true, accepted.insufficientReason ?? "");
    assert.ok(accepted.dailyLedger.every((day) => day.endingPositions.every((position) => position.quantity >= 0)));
    const signed = execute(ticker, year, -0.2, true);
    assert.equal(signed.hasSufficientData, true, signed.insufficientReason ?? "");
    assert.ok(signed.dailyLedger.some((day) => day.endingPositions.some((position) => position.quantity < 0)));
  }
});