import assert from "node:assert/strict";
import test from "node:test";
import { optimizePreparedSnapshot, type AllocationRequest } from "./allocation-b2";
import type { PreparedCandidate, PreparedSnapshot } from "./prepared-inputs";
import { solveRobustMeanUncertainty, type RobustLinearConstraint } from "./robust-solver-d4";
import { d4T8SolverInput } from "./robust-solver-d4-t8.fixture";
import { d4B3Nov2020SolverInput } from "./robust-solver-d4-b3-nov.fixture";

function dateAt(index: number): string {
  return new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10);
}

function candidate(id: string, returns: number[], exposures: Record<string, number> = { [id]: 1 }): PreparedCandidate {
  return {
    candidateId: id, canonicalFingerprint: id, name: id, kind: "alpha_streams", status: "READY", reasons: [],
    assetTickers: Object.keys(exposures), targetAssetExposures: exposures, actualAssetExposures: exposures,
    residualCash: 1 - Object.values(exposures).reduce((sum, value) => sum + value, 0),
    targetHistory: [{ signalDate: dateAt(5), informationCutoff: dateAt(4), executionDate: dateAt(5),
      targetPositions: exposures }],
    signalSeries: [], returnSeries: [],
    ledger: returns.map((value, i) => ({ date: dateAt(i + 1), beginningNav: 100,
      etfPnl: value * 100, cashPnl: 0, netPnl: value * 100, transactionCosts: 0, slippage: 0 })),
    lineage: { datasetHash: "d4-fixture", definition: { cashYieldAnnual: 0 } }, diagnostics: {},
  } as PreparedCandidate;
}

function snapshot(candidates: PreparedCandidate[]): PreparedSnapshot {
  return {
    schemaVersion: 1, engineVersion: "allocation-b1.0", a1EngineVersion: "a1",
    representation: "alpha_streams", dataset: { id: 4, sha256: "d4-fixture", csvContent: "",
      startDate: dateAt(0), endDate: dateAt(10), tickers: ["a", "b", "A", "B"],
      priceConvention: "adjusted close" },
    factorSet: { version: "d4-test", factors: [] }, request: { representation: "alpha_streams",
      assetTickers: [], factorIds: [], alphaDefinitions: [] }, coverage: {}, candidates,
    dependence: {}, suppliedWeights: {}, createdAt: dateAt(0),
  } as unknown as PreparedSnapshot;
}

function request(ids: string[], overrides: Partial<AllocationRequest> = {}): AllocationRequest {
  return {
    preparedInputId: 4, candidateIds: ids, informationCutoff: dateAt(8), decisionTimestamp: dateAt(8),
    estimationWindow: 8, minObservations: 3, representation: "alpha_streams",
    returnConvention: "daily_decimal", expectedReturnShrinkage: 0, covarianceDiagonalShrinkage: 0,
    dailyCashYield: 0, objective: { type: "regularized_mean_variance", gamma: 2, eta: 0.02 },
    constraints: { totalCash: { min: 0, max: 0 } }, ...overrides,
  };
}

function close(actual: number, expected: number, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by > ${tolerance}`);
}

function twoCandidateFixture() {
  const firstCentered = [-1, 1, 0];
  const secondCentered = [1, 1, -2].map((value) => value / Math.sqrt(3));
  const first = firstCentered.map((value) => 0.02 + value * 0.1);
  const second = secondCentered.map((value) => 0.005 + value * 0.2);
  return snapshot([candidate("first", first, { A: 1 }), candidate("second", second, { B: 1 })]);
}

function analyticRobustFirstWeight(kappa: number): number {
  const varianceA = 0.01, varianceB = 0.04, gamma = 2, eta = 0.02;
  const muA = 0.02, muB = 0.005;
  const derivative = (x: number) => gamma * (varianceA * x - varianceB * (1 - x)) +
    eta * (2 * x - 1) - (muA - muB) +
    kappa * ((varianceA * x - varianceB * (1 - x)) / 3) /
      Math.sqrt((varianceA * x * x + varianceB * (1 - x) ** 2) / 3);
  let low = 0, high = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    if (derivative(mid) > 0) high = mid;
    else low = mid;
  }
  return (low + high) / 2;
}

test("D4 T1 solves exact two-candidate square-root objective against independent analytic root", () => {
  const result = optimizePreparedSnapshot(twoCandidateFixture(), request(["first", "second"], {
    forecastModel: { type: "SAMPLE_MEAN" },
    robustness: { method: "ROBUST_MEAN_UNCERTAINTY", kappa: 0.03 },
  }));
  assert.equal(result.status, "SOLVED", result.reason);
  close(result.candidateWeights!.first, analyticRobustFirstWeight(0.03), 1e-8);
  close(result.candidateWeights!.second, 1 - result.candidateWeights!.first, 1e-8);
  assert.ok(result.robustness!.robustHaircut > 0);
  assert.equal(result.robustness!.solver.name, "D4 exact parametric-QP / quadprog");
  assert.ok(result.solver.maxConstraintViolation! <= 1e-8);
  assert.ok(result.solver.scaledOptimalityResidual! <= 1e-8);
});

test("D4 T1b solves a fully correlated SPD forecast-uncertainty matrix", () => {
  const u = [-1, 1, 0], v = [1, 1, -2].map((value) => value / Math.sqrt(3));
  const first = u.map((value) => 0.02 + value * 0.1);
  const second = u.map((value, i) => 0.005 + 0.2 * (0.6 * value + 0.8 * v[i]));
  const prepared = snapshot([candidate("first", first, { A: 1 }), candidate("second", second, { B: 1 })]);
  const result = optimizePreparedSnapshot(prepared, request(["first", "second"], {
    forecastModel: { type: "SAMPLE_MEAN" },
    robustness: { method: "ROBUST_MEAN_UNCERTAINTY", kappa: 0.03 },
  }));
  const covarianceA = 0.01, covarianceB = 0.04, covarianceAB = 0.012;
  const gamma = 2, eta = 0.02, muA = 0.02, muB = 0.005, kappa = 0.03;
  const derivative = (x: number) => {
    const firstMarginal = covarianceA * x + covarianceAB * (1 - x);
    const secondMarginal = covarianceAB * x + covarianceB * (1 - x);
    const variance = covarianceA * x * x + covarianceB * (1 - x) ** 2 +
      2 * covarianceAB * x * (1 - x);
    return gamma * (firstMarginal - secondMarginal) + eta * (2 * x - 1) - (muA - muB) +
      kappa * (firstMarginal - secondMarginal) / 3 / Math.sqrt(variance / 3);
  };
  let low = 0, high = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    if (derivative(mid) > 0) high = mid;
    else low = mid;
  }
  assert.equal(result.status, "SOLVED", result.reason);
  close(result.candidateWeights!.first, (low + high) / 2, 1e-8);
  close(result.model!.sigma[0][1], covarianceAB, 1e-10);
  assert.ok(result.solver.scaledOptimalityResidual! <= 1e-8);
});

test("D4 T2 kappa zero delegates exactly to the nominal QP", () => {
  const prepared = twoCandidateFixture();
  const nominal = optimizePreparedSnapshot(prepared, request(["first", "second"]));
  const zero = optimizePreparedSnapshot(prepared, request(["first", "second"], {
    forecastModel: { type: "SAMPLE_MEAN" },
    robustness: { method: "ROBUST_MEAN_UNCERTAINTY", kappa: 0 },
  }));
  assert.equal(nominal.status, "SOLVED", nominal.reason);
  assert.equal(zero.status, "SOLVED", zero.reason);
  assert.deepEqual(zero.candidateWeights, nominal.candidateWeights);
  assert.equal(zero.robustness!.robustHaircut, 0);
});

test("D4 T3 rejects positive robustness without explicit D3 forecast and regularized objective", () => {
  const prepared = twoCandidateFixture();
  const missingForecast = optimizePreparedSnapshot(prepared, request(["first", "second"], {
    robustness: { method: "ROBUST_MEAN_UNCERTAINTY", kappa: 0.1 },
  }));
  assert.equal(missingForecast.status, "INVALID_FORECAST_MODEL");
  const minimumVariance = optimizePreparedSnapshot(prepared, request(["first", "second"], {
    forecastModel: { type: "SAMPLE_MEAN" }, objective: { type: "minimum_variance", gamma: 1, eta: 0 },
    robustness: { method: "ROBUST_MEAN_UNCERTAINTY", kappa: 0.1 },
  }));
  assert.equal(minimumVariance.status, "INVALID_FORECAST_MODEL");
  const badKappa = optimizePreparedSnapshot(prepared, request(["first", "second"], {
    robustness: { method: "ROBUST_MEAN_UNCERTAINTY", kappa: Number.NaN },
  }));
  assert.equal(badKappa.status, "INVALID_INPUT");
});

test("D4 T4 signed overlay retains gross-alpha auxiliary cap under robust optimization", () => {
  const centeredA = [-1, 1, 0].map((value) => value * 0.05);
  const centeredB = [1, 1, -2].map((value) => value * 0.04 / Math.sqrt(3));
  const prepared = snapshot([
    candidate("signed-a", centeredA.map((value) => 0.02 + value), { A: 1 }),
    candidate("signed-b", centeredB.map((value) => 0.01 + value), { B: 1 }),
  ]);
  const result = optimizePreparedSnapshot(prepared, request(["signed-a", "signed-b"], {
    constraints: {},
    allocationMode: "SIGNED_OVERLAY",
    forecastModel: { type: "SAMPLE_MEAN" },
    signedConstraints: { grossAlphaMax: 0.4 },
    robustness: { method: "ROBUST_MEAN_UNCERTAINTY", kappa: 0.01 },
  }));
  assert.equal(result.status, "SOLVED", result.reason);
  assert.ok(result.signedOverlay!.alphaGrossExposure <= 0.4 + 1e-8);
  assert.ok(result.constraintSlacks.some((item) => item.name === "gross_alpha"));
  assert.ok(result.solver.maxConstraintViolation! <= 1e-8);
  assert.ok(result.solver.scaledOptimalityResidual! <= 1e-8);
});

test("D4 T5 certifies a feasible signed zero optimum with the singular-norm subgradient", () => {
  const u = [-1, 1, 0], v = [1, 1, -2].map((value) => value / Math.sqrt(3));
  const prepared = snapshot([
    candidate("zero-a", u.map((value) => 0.001 + value * 0.1), { A: 1 }),
    candidate("zero-b", v.map((value) => -0.0005 + value * 0.2), { B: 1 }),
  ]);
  const result = optimizePreparedSnapshot(prepared, request(["zero-a", "zero-b"], {
    constraints: {}, allocationMode: "SIGNED_OVERLAY",
    forecastModel: { type: "SAMPLE_MEAN" }, signedConstraints: {},
    robustness: { method: "ROBUST_MEAN_UNCERTAINTY", kappa: 0.1 },
  }));
  assert.equal(result.status, "SOLVED", result.reason);
  close(result.candidateWeights!["zero-a"], 0, 1e-10);
  close(result.candidateWeights!["zero-b"], 0, 1e-10);
  assert.equal(result.robustness!.robustHaircut, 0);
  assert.ok(result.solver.maxConstraintViolation! <= 1e-8);
  assert.ok(result.solver.scaledOptimalityResidual! <= 1e-8);
});

test("D4 T6 certifies singular-V nullspace optimum using binding bounds and D2 auxiliaries", () => {
  const constraints: RobustLinearConstraint[] = [
    { name: "candidate:first", coefficients: [1, 0, 0, 0], lower: 1 },
    { name: "asset:B", coefficients: [0, 1, 0, 0], upper: -1 },
    { name: "abs:first:positive", coefficients: [-1, 0, 1, 0], lower: 0 },
    { name: "abs:first:nonnegative", coefficients: [0, 0, 1, 0], lower: 0 },
    { name: "abs:second:negative", coefficients: [0, 1, 0, 1], lower: 0 },
    { name: "abs:second:nonnegative", coefficients: [0, 0, 0, 1], lower: 0 },
  ];
  const solution = solveRobustMeanUncertainty(
    [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    [-0.8, 0.8, 0, 0],
    [[1, 1], [1, 1]],
    constraints,
    0.25,
    4,
  );
  close(solution.solution[0], 1, 1e-8);
  close(solution.solution[1], -1, 1e-8);
  close(solution.solution[2], 1, 1e-8);
  close(solution.solution[3], 1, 1e-8);
  assert.equal(solution.robustHaircut, 0);
  assert.ok(solution.primalResidual <= 1e-8);
  assert.ok(solution.stationarityResidual <= 1e-8);
});

test("D4 T7 jointly certifies gross-alpha epigraph multipliers on a singular-V null optimum", () => {
  const constraints: RobustLinearConstraint[] = [
    { name: "abs:first:positive", coefficients: [-1, 0, 1, 0], lower: 0 },
    { name: "abs:first:negative", coefficients: [1, 0, 1, 0], lower: 0 },
    { name: "abs:first:nonnegative", coefficients: [0, 0, 1, 0], lower: 0 },
    { name: "abs:second:positive", coefficients: [0, -1, 0, 1], lower: 0 },
    { name: "abs:second:negative", coefficients: [0, 1, 0, 1], lower: 0 },
    { name: "abs:second:nonnegative", coefficients: [0, 0, 0, 1], lower: 0 },
    { name: "gross_alpha", coefficients: [0, 0, 1, 1], upper: 2 },
  ];
  const solution = solveRobustMeanUncertainty(
    [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    [-2, 2, 0, 0],
    [[1, 1], [1, 1]],
    constraints,
    0.25,
    4,
  );
  close(solution.solution[0], 1, 1e-8);
  close(solution.solution[1], -1, 1e-8);
  close(solution.solution[2], 1, 1e-8);
  close(solution.solution[3], 1, 1e-8);
  assert.equal(solution.robustHaircut, 0);
  assert.ok(solution.stationarityResidual <= 1e-8);
});

test("D4 T8 certifies the saved signed Bayesian D2 solver input", () => {
  const input = d4T8SolverInput;
  const solution = solveRobustMeanUncertainty(
    input.hessian as unknown as number[][],
    input.linear as unknown as number[],
    input.uncertainty as unknown as number[][],
    input.constraints as unknown as RobustLinearConstraint[],
    1,
    input.total,
  );
  assert.ok(solution.solution.every((value) => Math.abs(value) <= 1e-8));
  assert.equal(solution.robustHaircut, 0);
  assert.ok(solution.primalResidual <= 1e-8);
  assert.ok(solution.stationarityResidual <= 1e-8);
});

test("D4 T9 solves the saved 2020-11-01 CAPITAL_LONG_ONLY B3 decision", () => {
  const input = d4B3Nov2020SolverInput;
  const solution = solveRobustMeanUncertainty(
    input.hessian as unknown as number[][],
    input.linear as unknown as number[],
    input.uncertainty as unknown as number[][],
    input.constraints as unknown as RobustLinearConstraint[],
    1,
    input.size,
  );
  assert.equal(solution.solution.length, input.size);
  assert.ok(solution.solution.slice(0, 8).every((weight) => Math.abs(weight) <= 1e-8));
  close(solution.solution[8], 1, 1e-8);
  assert.ok(solution.primalResidual <= 1e-8);
  assert.ok(solution.stationarityResidual <= 1e-8);
});