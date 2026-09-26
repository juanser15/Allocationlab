import assert from "node:assert/strict";
import test from "node:test";
import { computeD4Diagnostics } from "./d4-diagnostics";
import type { AllocationRequest, AllocationResult } from "./allocation-b2";

function result(weights: Record<string, number>, assetWeights: Record<string, number>,
  overrides: Partial<AllocationResult> = {}): AllocationResult {
  return {
    status: "SOLVED",
    model: null,
    candidateWeights: weights,
    assetWeights,
    totalCash: 0.1,
    masterCash: 0.05,
    estimatedGrossReturn: 0.012,
    estimatedVolatility: 0.02,
    objectiveContributions: {
      variance: 0.0002, regularization: 0.0003, candidateReturn: -0.0004,
      masterCashReturn: -0.0001, total: 0.0001,
    },
    constraintSlacks: [
      { name: "cash-max", value: 0.1, minSlack: null, maxSlack: 0 },
      { name: "group-cap", value: 0.4, minSlack: null, maxSlack: 0.2 },
    ],
    solver: {
      name: "test", version: "1", status: "SOLVED", primalResidual: 0, dualResidual: 0,
      scaledOptimalityResidual: 0, maxConstraintViolation: 0, psdTolerance: 1e-10,
      optimalityTolerance: 1e-8, constraintTolerance: 1e-8, iterations: 1,
    },
    forecast: {
      status: "OK", config: { type: "SAMPLE_MEAN" }, observationCount: 10,
      portfolio: { expectedReturn: 0.01, varianceOfExpectedReturn: 0.000016, standardError: 0.004,
        label: "Expected return estimation uncertainty; not portfolio return volatility." },
    } as AllocationResult["forecast"],
    ...overrides,
  };
}

const request: AllocationRequest = {
  preparedInputId: 9,
  candidateIds: ["a", "b", "c"],
  informationCutoff: "2024-01-31",
  decisionTimestamp: "2024-02-01",
  estimationWindow: 10,
  minObservations: 5,
  representation: "alpha_streams",
  returnConvention: "daily_decimal",
  expectedReturnShrinkage: 0.2,
  forecastModel: {
    type: "BAYESIAN_VIEWS",
    shrinkage: 0.3,
    priorMean: { source: "SHRUNK_PRIOR" },
    priorUncertainty: { type: "TAU_SIGMA", tau: 0.04 },
  },
  robustness: { method: "ROBUST_MEAN_UNCERTAINTY", kappa: 2 },
  covarianceDiagonalShrinkage: 0,
  riskModel: { type: "STATISTICAL_FACTOR", factorCount: 1 },
  dailyCashYield: 0,
  objective: { type: "regularized_mean_variance", gamma: 1, eta: 0.5 },
  constraints: {},
};

test("D4 T6 freezes deterministic robust-versus-nominal metrics and decomposition", () => {
  const robust = result({ a: 0.7, b: 0.3, c: 0 }, { A: 0.7, B: 0.3 }, {
    estimatedGrossReturn: 0.015,
    estimatedVolatility: 0.03,
    totalCash: 0.12,
    objectiveContributions: {
      variance: 0.00045, regularization: 0.00029, candidateReturn: -0.0005,
      masterCashReturn: -0.0001, total: 0.00014,
    },
    robustness: {
      method: "ROBUST_MEAN_UNCERTAINTY", kappa: 2, robustHaircut: 0.0007,
      objectiveTotal: 0.00084,
      solver: { name: "test", version: "1", optimalityTolerance: 1e-8, constraintTolerance: 1e-8 },
    },
  });
  const nominalResult = result({ a: 0.5, b: 0.5, c: 0 }, { A: 0.4, B: 0.6 }, {
    estimatedGrossReturn: 0.01,
    estimatedVolatility: 0.02,
    totalCash: 0.1,
    forecast: {
      status: "OK", config: { type: "SAMPLE_MEAN" },
      portfolio: { expectedReturn: 0.01, varianceOfExpectedReturn: 0.000009, standardError: 0.003,
        label: "Expected return estimation uncertainty; not portfolio return volatility." },
    } as AllocationResult["forecast"],
  });
  const calls: AllocationRequest[] = [];
  const solve = (child: AllocationRequest) => {
    calls.push(child);
    return child.robustness?.method === "NOMINAL" ? nominalResult :
      result({ a: 0.7, b: 0.3, c: 0 }, { A: 0.7, B: 0.3 });
  };
  const baseline = {
    ...robust,
    riskModel: {
      type: "SAMPLE" as const,
      sampleCovariance: [[0.04, 0.01, 0], [0.01, 0.09, 0], [0, 0, 0.16]],
      covariance: [[0.04, 0.01, 0], [0.01, 0.09, 0], [0, 0, 0.16]],
      provenance: {
        candidateIds: ["a", "b", "c"], dates: [], observationCount: 10, alphaCount: 3,
        informationCutoff: "2024-01-31", preparedInputId: 9, datasetId: null, datasetHash: "frozen",
      },
      sameWindowModels: {
        SAMPLE: { covariance: [[0.04, 0.01, 0], [0.01, 0.09, 0], [0, 0, 0.16]], expectedDailyVolatility: null },
        DIAGONAL_SHRINKAGE: {
          covariance: [[0.04, 0, 0], [0, 0.09, 0], [0, 0, 0.16]],
          expectedDailyVolatility: null,
        },
        STATISTICAL_FACTOR: {
          covariance: [[0.04, 0.01, 0], [0.01, 0.09, 0], [0, 0, 0.16]],
          expectedDailyVolatility: null,
        },
      },
    },
  } as AllocationResult;

  const diagnostics = computeD4Diagnostics(request, baseline, solve) as any;
  assert.equal(calls[0].robustness?.method, "NOMINAL");
  assert.equal(calls[0].expectedReturnShrinkage, request.expectedReturnShrinkage);
  assert.equal(diagnostics.comparison.status, "SOLVED");
  assert.ok(Math.abs(diagnostics.comparison.candidateWeightHalfL1 - 0.2) < 1e-8);
  assert.ok(Math.abs(diagnostics.comparison.assetWeightHalfL1 - 0.3) < 1e-8);
  assert.ok(Math.abs(diagnostics.comparison.return.difference - 0.005) < 1e-8);
  assert.ok(Math.abs(diagnostics.comparison.risk.difference - 0.01) < 1e-8);
  assert.ok(Math.abs(diagnostics.comparison.forecastStandardError.difference - 0.001) < 1e-8);
  assert.ok(Math.abs(diagnostics.comparison.exposure.gross.difference - 0) < 1e-8);
  assert.ok(Math.abs(diagnostics.comparison.exposure.net.difference) < 1e-8);
  assert.ok(Math.abs(diagnostics.comparison.exposure.cash.difference - 0.02) < 1e-8);
  assert.deepEqual(diagnostics.comparison.bindingConstraints.robust, [{ name: "cash-max", sides: ["max"], value: 0.1 }]);
  assert.equal(diagnostics.comparison.objective.robust.robustHaircut, 0.0007);
  assert.ok(Object.isFrozen(diagnostics) && Object.isFrozen(diagnostics.comparison));
  assert.equal(Object.isFrozen(request), false);

  const baseRisk = 0.7 ** 2 * 0.04 + 2 * 0.7 * 0.3 * 0.01 + 0.3 ** 2 * 0.09;
  assert.ok(Math.abs(diagnostics.covarianceUncertainty.base.variance - baseRisk) < 1e-8);
  assert.ok(Math.abs(diagnostics.covarianceUncertainty.offDiagonalDependence[1].variance -
    (0.7 ** 2 * 0.04 + 2 * 0.7 * 0.3 * 0.011 + 0.3 ** 2 * 0.09)) < 1e-8);
  assert.equal(diagnostics.covarianceUncertainty.alternateEstimators[0].type, "SAMPLE");
});

test("D4 T6 sensitivities are one-at-a-time, predeclared, and report invalid factor counts", () => {
  const baseline = result({ a: 0.6, b: 0.4, c: 0 }, { A: 0.6, B: 0.4 });
  const seen: AllocationRequest[] = [];
  const diagnostics = computeD4Diagnostics(request, baseline, (child) => {
    seen.push(child);
    if (child.robustness?.kappa === 3) return result({ a: 0.5, b: 0, c: 0.5 }, { A: 0.4, B: 0, C: 0.6 }, {
      estimatedGrossReturn: 0.02,
      estimatedVolatility: 0.03,
      totalCash: 0.2,
    });
    return result({ a: 0.6, b: 0.4, c: 0 }, { A: 0.6, B: 0.4 });
  }) as any;
  const named = (name: string) => diagnostics.sensitivity.find((item: any) => item.name === name);

  assert.deepEqual([named("kappa_0.5x").requestChanges["robustness.kappa"],
    named("kappa_1x").requestChanges["robustness.kappa"],
    named("kappa_1.5x").requestChanges["robustness.kappa"]], [1, 2, 3]);
  assert.equal(diagnostics.sensitivity.some((item: any) =>
    item.requestChanges?.expectedReturnShrinkage !== undefined), false);
  assert.ok(Math.abs(named("forecastModel.shrinkage_minus_0.1").requestChanges["forecastModel.shrinkage"] - 0.2) < 1e-8);
  assert.deepEqual([named("tau_0.75x").requestChanges["forecastModel.priorUncertainty.tau"],
    named("tau_1x").requestChanges["forecastModel.priorUncertainty.tau"],
    named("tau_1.25x").requestChanges["forecastModel.priorUncertainty.tau"]], [0.03, 0.04, 0.05]);
  assert.equal(named("factorCount_0").status, "NOT_APPLICABLE");
  assert.equal(named("factorCount_1").status, "SOLVED");
  assert.equal(named("factorCount_2").status, "SOLVED");
  const changedCase = named("kappa_1.5x").metrics.relativeToBaseline;
  assert.ok(Math.abs(changedCase.candidateWeightHalfL1 - 0.5) < 1e-8);
  assert.ok(Math.abs(changedCase.assetWeightHalfL1 - 0.6) < 1e-8);
  assert.ok(Math.abs(changedCase.expectedReturnChange - 0.008) < 1e-8);
  assert.ok(Math.abs(changedCase.riskChange - 0.01) < 1e-8);
  assert.deepEqual(changedCase.candidateWeightChanges, {
    signFlips: [], added: ["c"], removed: ["b"],
  });
  assert.deepEqual(changedCase.assetWeightChanges, {
    signFlips: [], added: ["C"], removed: ["B"],
  });
  assert.ok(Math.abs(changedCase.exposureChanges.gross) < 1e-8);
  assert.ok(Math.abs(changedCase.exposureChanges.net) < 1e-8);
  assert.ok(Math.abs(changedCase.exposureChanges.cash - 0.1) < 1e-8);
  assert.ok(diagnostics.sensitivity.filter((item: any) => item.status === "SOLVED")
    .every((item: any) => item.metrics.relativeToBaseline));
  const tauCase = seen.find((child) => child.forecastModel?.type === "BAYESIAN_VIEWS" &&
    child.forecastModel.priorUncertainty?.type === "TAU_SIGMA" &&
    child.forecastModel.priorUncertainty.tau === 0.03)!;
  assert.equal(tauCase.riskModel?.factorCount, request.riskModel?.factorCount);
  assert.equal(tauCase.robustness?.kappa, request.robustness?.kappa);
  assert.equal(tauCase.expectedReturnShrinkage, request.expectedReturnShrinkage);
});

test("D4 T6 uses baseline observation count for omitted Bayesian tau and omits D3 sample-mean shrinkage", () => {
  const baseline = result({ a: 0.6, b: 0.4, c: 0 }, { A: 0.6, B: 0.4 }, {
    forecast: {
      status: "OK", config: { type: "SAMPLE_MEAN" }, observationCount: 20,
      portfolio: { expectedReturn: 0.01, varianceOfExpectedReturn: 0.000016, standardError: 0.004,
        label: "Expected return estimation uncertainty; not portfolio return volatility." },
    } as AllocationResult["forecast"],
  });
  const bayesianRequest: AllocationRequest = {
    ...request,
    forecastModel: { type: "BAYESIAN_VIEWS", priorUncertainty: { type: "TAU_SIGMA" } },
  };
  const bayesianDiagnostics = computeD4Diagnostics(bayesianRequest, baseline,
    () => result({ a: 0.6, b: 0.4, c: 0 }, { A: 0.6, B: 0.4 })) as any;
  const tauValues = bayesianDiagnostics.sensitivity
    .filter((item: any) => item.name.startsWith("tau_"))
    .map((item: any) => item.requestChanges["forecastModel.priorUncertainty.tau"]);
  assert.ok(tauValues.every((value: number, index: number) =>
    Math.abs(value - [0.0375, 0.05, 0.0625][index]) < 1e-8));

  const sampleMeanRequest: AllocationRequest = {
    ...request,
    forecastModel: { type: "SAMPLE_MEAN" },
  };
  const sampleMeanDiagnostics = computeD4Diagnostics(sampleMeanRequest, baseline,
    () => result({ a: 0.6, b: 0.4, c: 0 }, { A: 0.6, B: 0.4 })) as any;
  assert.equal(sampleMeanDiagnostics.sensitivity.some((item: any) =>
    item.requestChanges?.expectedReturnShrinkage !== undefined), false);
  assert.equal(sampleMeanDiagnostics.sensitivity.find((item: any) => item.name === "shrinkage").status,
    "NOT_APPLICABLE");
});

test("D4 T6 rejects indefinite off-diagonal stress covariance despite positive portfolio variance", () => {
  const weights = { a: 0.7, b: 0.3, c: 0 };
  const baseline = result(weights, { A: 0.7, B: 0.3 }, {
    riskModel: {
      type: "SAMPLE",
      sampleCovariance: [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
      covariance: [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
      provenance: {
        candidateIds: ["a", "b", "c"], dates: [], observationCount: 10, alphaCount: 3,
        informationCutoff: "2024-01-31", preparedInputId: 9, datasetId: null, datasetHash: "rank-one",
      },
    },
  });
  const diagnostics = computeD4Diagnostics(request, baseline, () => result(weights, { A: 0.7, B: 0.3 })) as any;
  const [lowerDependence, higherDependence] = diagnostics.covarianceUncertainty.offDiagonalDependence;

  assert.equal(diagnostics.covarianceUncertainty.base.status, "OK");
  assert.equal(lowerDependence.status, "OK");
  assert.equal(higherDependence.status, "INVALID_COVARIANCE");
  assert.equal(higherDependence.variance, null);
  assert.equal(higherDependence.volatility, null);
  // The invalid stressed matrix still has positive variance for these weights;
  // its indefiniteness, not just portfolio variance, must invalidate the result.
  assert.ok(0.7 ** 2 + 0.3 ** 2 + 2 * 0.7 * 0.3 * 1.1 > 0);
});