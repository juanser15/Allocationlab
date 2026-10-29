/** Source-only synthetic mathematical oracle. This is not market-data,
 * PostgreSQL, production-worker or Replit integration certification. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  solveCardinalityPortfolio,
  type ConstrainedOptions,
} from "./constrained-optimizer";
import {
  CONSTRAINT_TOLERANCE,
  SUPPORT_TOLERANCE,
} from "../../artifacts/api-server/src/lib/workbench/portfolio-numerics";

test("Independent two-asset feasible-grid oracle: 30 deterministic PSD, cost, support and risk cases", () => {
  let seed = 219431;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let caseIndex = 0; caseIndex < 30; caseIndex++) {
    const firstVolatility = 0.02 + 0.18 * random();
    const secondVolatility = 0.02 + 0.18 * random();
    const correlation = -0.7 + 1.4 * random();
    const covariance = [
      [firstVolatility ** 2, correlation * firstVolatility * secondVolatility],
      [correlation * firstVolatility * secondVolatility, secondVolatility ** 2],
    ];
    const mean = [-0.05 + 0.3 * random(), -0.05 + 0.3 * random()];
    const prior = [0.2 * random(), 0.2 * random()];
    const options: ConstrainedOptions = {
      cap: 0.4 + 0.6 * random(),
      maxWeight: 0.7,
      riskAversion: 0.5 + 3 * random(),
      cost: 0.002 * random(),
      horizon: 1,
      volatility: caseIndex % 2 === 0 ? 0.09 : null,
      mandate: { minimum_positions: 1, maximum_positions: 2, minimum_weight: 0.03 },
    };
    // The scalar expressions do not use solver objective/projection helpers.
    const variance = (weights: number[]) =>
      weights[0] ** 2 * covariance[0][0] +
      2 * weights[0] * weights[1] * covariance[0][1] +
      weights[1] ** 2 * covariance[1][1];
    const objective = (weights: number[]) =>
      0.5 * options.horizon * options.riskAversion * variance(weights) -
      options.horizon * (weights[0] * mean[0] + weights[1] * mean[1]) +
      options.cost * (Math.abs(weights[0] - prior[0]) + Math.abs(weights[1] - prior[1]));

    let gridObjective = Infinity;
    for (let first = 0; first <= 140; first++) {
      for (let second = 0; second <= 140; second++) {
        const weights = [first / 200, second / 200];
        if (first === 0 && second === 0) continue;
        if (weights.some((weight) => weight > 0 && weight < 0.03)) continue;
        if (weights[0] + weights[1] > options.cap) continue;
        if (options.volatility !== null && variance(weights) > options.volatility ** 2) continue;
        gridObjective = Math.min(gridObjective, objective(weights));
      }
    }

    const label = `analytical case ${caseIndex}`;
    assert.ok(Number.isFinite(gridObjective), `${label}: nonempty feasible grid`);
    const result = solveCardinalityPortfolio(mean, covariance, prior, options);
    const active = result.weights.filter((weight) => weight > SUPPORT_TOLERANCE);
    assert.ok(active.length >= 1 && active.length <= 2, `${label}: support bounds`);
    assert.ok(active.every((weight) => weight >= 0.03 - CONSTRAINT_TOLERANCE), `${label}: position floors`);
    assert.ok(result.weights.every((weight) => weight >= 0 && weight <= 0.7 + CONSTRAINT_TOLERANCE), `${label}: position ceilings`);
    assert.ok(result.weights[0] + result.weights[1] <= options.cap + CONSTRAINT_TOLERANCE, `${label}: exposure ceiling`);
    if (options.volatility !== null) {
      assert.ok(Math.sqrt(variance(result.weights)) <= options.volatility + CONSTRAINT_TOLERANCE, `${label}: volatility ceiling`);
    }
    assert.ok(Math.abs(result.audit.objective - objective(result.weights)) <= 1e-12, `${label}: independent full L1 objective`);
    // A feasible coarse-grid candidate bounds the minimum from above. Beating
    // this grid is an independent regression oracle, not a global-optimality proof.
    assert.ok(objective(result.weights) <= gridObjective + 1e-7, `${label}: solution no worse than feasible grid`);
    assert.equal(result.audit.support_search.exhaustive, true, `${label}: all three supports explored`);
    assert.ok(result.audit.residuals.composite_optimality_gap <= result.audit.optimality_gap_tolerance, `${label}: continuous certificate`);
    const repeated = solveCardinalityPortfolio(mean, covariance, prior, options);
    assert.deepEqual(repeated, result, `${label}: deterministic repeat`);
  }
});
