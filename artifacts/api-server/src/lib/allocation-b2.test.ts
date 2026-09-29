import assert from "node:assert/strict";
import test from "node:test";
import {
  optimizePreparedSnapshot, validateCovariance, type AllocationRequest,
} from "./allocation-b2";
import {
  prepareSnapshot, type AlphaDefinition, type PreparedCandidate, type PreparedSnapshot, type PreparedRequest,
} from "./prepared-inputs";
import type { FactorDefinition } from "./factor-library";

function dateAt(index: number): string {
  return new Date(Date.UTC(2022, 0, 1 + index)).toISOString().slice(0, 10);
}

function candidate(id: string, returns: number[], options: {
  kind?: "asset_returns" | "alpha_streams"; ticker?: string; exposures?: Record<string, number>;
  cashYieldAnnual?: number; datasetHash?: string; alias?: boolean;
} = {}): PreparedCandidate {
  const kind = options.kind ?? "asset_returns";
  const exposures = options.exposures ?? { [options.ticker ?? id]: 1 };
  return {
    candidateId: id, canonicalFingerprint: id, name: id, kind, status: "READY", reasons: [],
    assetTickers: Object.keys(exposures), targetAssetExposures: exposures, actualAssetExposures: exposures,
    residualCash: 1 - Object.values(exposures).reduce((sum, value) => sum + value, 0),
    targetHistory: kind === "alpha_streams" ? [
      { signalDate: dateAt(5), informationCutoff: dateAt(4), executionDate: dateAt(5), targetPositions: exposures },
      ...(options.alias ? [{ signalDate: dateAt(20), informationCutoff: dateAt(19), executionDate: dateAt(20),
        targetPositions: Object.fromEntries(Object.keys(exposures).map((ticker) => [ticker, 0])) }] : []),
    ] : [],
    signalSeries: [],
    returnSeries: kind === "asset_returns" ? returns.map((value, i) => ({ date: dateAt(i + 1), value })) : [],
    ledger: kind === "alpha_streams" ? returns.map((gross, i) => ({
      date: dateAt(i + 1), beginningNav: 100, etfPnl: gross * 100, cashPnl: 0, netPnl: gross * 100,
      transactionCosts: 0, slippage: 0,
    })) : [],
    lineage: kind === "alpha_streams" ? {
      datasetHash: options.datasetHash ?? "fixture-hash",
      definition: { cashYieldAnnual: options.cashYieldAnnual ?? 0 },
    } : {},
    diagnostics: {},
  } as PreparedCandidate;
}

function snapshot(candidates: PreparedCandidate[], representation: "asset_returns" | "alpha_streams") {
  return {
    schemaVersion: 1, engineVersion: "allocation-b1.0", a1EngineVersion: "a1",
    representation, dataset: { id: 1, sha256: "fixture-hash", csvContent: "", startDate: dateAt(0),
      endDate: dateAt(40), tickers: ["A", "B", "C"], priceConvention: "adjusted close" },
    factorSet: { version: "test", factors: [] }, request: { representation, assetTickers: [], factorIds: [],
      alphaDefinitions: [] }, coverage: {}, candidates, dependence: {}, suppliedWeights: {}, createdAt: dateAt(0),
  } as unknown as PreparedSnapshot;
}

function request(ids: string[], representation: "asset_returns" | "alpha_streams",
  overrides: Partial<AllocationRequest> = {}): AllocationRequest {
  return {
    preparedInputId: 1, candidateIds: ids, informationCutoff: dateAt(10), decisionTimestamp: dateAt(10),
    estimationWindow: 10, minObservations: 3, representation, returnConvention: "daily_decimal",
    expectedReturnShrinkage: 0, covarianceDiagonalShrinkage: 0, dailyCashYield: 0,
    objective: { type: "minimum_variance", gamma: 1, eta: 0 }, constraints: {}, ...overrides,
  };
}

function orthogonalReturns(variance1: number, variance2: number, length = 3) {
  const x = [-1, 1, 0].map((value) => value * Math.sqrt(variance1));
  const y = [1, 1, -2].map((value) => value * Math.sqrt(variance2 / 3));
  return { x, y };
}

test("D1 T3 B2 uses a high-dimensional factor covariance or reports an explicit numerical failure", () => {
  const ids = Array.from({ length: 9 }, (_, alpha) => `stream-${alpha}`);
  const streams = ids.map((id, alpha) => candidate(id,
    Array.from({ length: 4 }, (_, time) =>
      0.0003 * (alpha + 1) * Math.sin((time + 1) * (alpha + 1) * 0.37) +
      0.0002 * Math.cos((time + 2) * (alpha + 2) * 0.23)),
    { kind: "alpha_streams", ticker: `ASSET${alpha}` }));
  const result = optimizePreparedSnapshot(snapshot(streams, "alpha_streams"), request(ids, "alpha_streams", {
    informationCutoff: dateAt(5), decisionTimestamp: dateAt(10),
    estimationWindow: 4, minObservations: 2,
    riskModel: { type: "STATISTICAL_FACTOR", factorCount: 3, specificRiskFloorFraction: 10 },
  }));
  assert.ok(["SOLVED", "NUMERICAL_FAILURE"].includes(result.status), `${result.status}: ${result.reason}`);
  assert.equal(result.model?.riskModel?.type, "STATISTICAL_FACTOR");
  assert.equal(result.model?.riskModel?.factorCount, 3);
  assert.ok(result.model?.riskModel?.factorModel?.gamma);
  assert.deepEqual(result.model?.sigma, result.model?.riskModel?.factorModel?.gamma);
  assert.ok(result.model!.riskModel!.factorModel!.diagnostics);
  assert.ok((result.model!.riskModel!.factorModel!.diagnostics as { sampleCovarianceRank: number })
    .sampleCovarianceRank <= 3);
  assert.ok(result.model!.sigma.flat().every(Number.isFinite));
});

function actualB1ThirtyStreamSnapshot(): PreparedSnapshot {
  const tickers = ["A", "B", "C", "D", "E"];
  const transformations = [
    { type: "momentum", lookback: 5, direction: "higher_is_better", formula: "P(t-lag)/P(t-lag-lookback)-1" },
    { type: "trend_quality", lookback: 10, direction: "higher_is_better", formula: "trendQuality(P[t-lookback:t-lag])" },
    { type: "volatility", lookback: 8, direction: "lower_is_better", formula: "realizedVolatility(P[t-lookback:t-lag])" },
    { type: "drawdown", lookback: 12, direction: "higher_is_better", formula: "-maxDrawdown(P[t-lookback:t-lag])" },
    { type: "mean_reversion", lookback: 4, direction: "higher_is_better", formula: "-return(P[t-lookback:t-lag])" },
    { type: "ma_distance", lookback: 15, direction: "higher_is_better", formula: "P(t-lag)/mean(P[t-lookback:t-lag])-1" },
  ];
  const factors = transformations.map((item, i) => ({
    id: `factor_${i}`, name: `${item.type} ${i}`, description: "B2 exact B1 regression fixture", family: "Test",
    enabled: true, status: "active", inputSeries: "adjusted close", calculationType: item.type,
    formula: item.formula, direction: item.direction, lookback: item.lookback, lag: 0,
    normalization: "percentile_rank", winsorizationLower: 0, winsorizationUpper: 1,
    missingDataTreatment: "exclude", baseWeight: 1, regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 },
    activeRegimes: ["risk_on", "neutral", "risk_off"], dataSource: "test synthetic prices",
    benchmarkTicker: null, currentCoverage: 1, availabilityReason: null, version: "v-test",
  } as FactorDefinition));
  const definitions = tickers.flatMap((ticker) => factors.map((factor, i) => ({
    name: `${ticker} ${factor.id}`, factorId: factor.id, assetTickers: [ticker],
    mapping: "single_asset_long_cash" as const, signalUnits: "oriented" as const, threshold: -1,
    grossFraction: 0.35 + i * 0.02, rebalanceFrequency: "monthly" as const,
    executionTiming: "next_close" as const, transactionCostBps: 0, slippageBps: 0, cashYieldAnnual: 0,
  } as AlphaDefinition)));
  const dates = Array.from({ length: 180 }, (_, i) => dateAt(i));
  const csv = ["date,A,B,C,D,E", ...dates.map((date, i) => [
    date, ...tickers.map((_, asset) => 100 + (i + 1) * (asset + 1) * 0.17 + Math.sin(i * (asset + 1)) * 2),
  ].join(","))].join("\n");
  const preparedRequest: PreparedRequest = { representation: "alpha_streams", assetTickers: tickers,
    factorIds: [], alphaDefinitions: definitions };
  return prepareSnapshot({ request: preparedRequest, csvContent: csv, factorVersion: "v-test", factors });
}

function close(actual: number, expected: number, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);
}

test("B2 T1 solves the known minimum-variance optimum and reports independent residuals", () => {
  const { x, y } = orthogonalReturns(0.01, 0.04);
  const result = optimizePreparedSnapshot(snapshot([candidate("a", x), candidate("b", y)], "asset_returns"),
    request(["a", "b"], "asset_returns", { constraints: { totalCash: { min: 0, max: 0 } } }));
  assert.equal(result.status, "SOLVED", result.reason);
  close(result.candidateWeights!.a, 0.8);
  close(result.candidateWeights!.b, 0.2);
  assert.ok(result.solver.scaledOptimalityResidual! <= 1e-6);
  assert.ok(result.solver.maxConstraintViolation! <= 1e-8);
});

test("B2 T2 matches the analytical regularized mean-variance optimum and changes with means", () => {
  const { x, y } = orthogonalReturns(0.01, 0.04);
  const base = snapshot([candidate("a", x), candidate("b", y)], "asset_returns");
  const solve = (means: [number, number]) => {
    const returns = [x, y].map((series, j) => series.map((value) => value + means[j]));
    const prepared = snapshot([candidate("a", returns[0]), candidate("b", returns[1])], "asset_returns");
    const result = optimizePreparedSnapshot(prepared, request(["a", "b"], "asset_returns", {
      objective: { type: "regularized_mean_variance", gamma: 2, eta: 0.1 },
      constraints: { totalCash: { min: 0, max: 0 } },
    }));
    assert.equal(result.status, "SOLVED", result.reason);
    return result;
  };
  assert.ok(base);
  const first = solve([0.02, 0.01]);
  const expected = (2 * 0.04 + 0.1 + (0.02 - 0.01)) / (2 * (0.01 + 0.04) + 2 * 0.1);
  close(first.candidateWeights!.a, expected);
  close(first.candidateWeights!.b, 1 - expected);
  const components = first.objectiveContributions!;
  const b = [first.candidateWeights!.a, first.candidateWeights!.b];
  const sigma = first.model!.sigma;
  close(components.variance, 0.5 * 2 * (b[0] ** 2 * sigma[0][0] + b[1] ** 2 * sigma[1][1]));
  close(components.regularization, 0.05 * (b[0] ** 2 + b[1] ** 2));
  close(components.candidateReturn, -0.02 * b[0] - 0.01 * b[1]);
  close(components.total, components.variance + components.regularization + components.candidateReturn);
  assert.ok(solve([0.04, 0.01]).candidateWeights!.a > first.candidateWeights!.a);
});

test("B2 T3 produces equal underlying allocations for direct assets and mapped zero-cost streams", () => {
  const { x, y } = orthogonalReturns(0.03, 0.07, 6);
  const asset = optimizePreparedSnapshot(snapshot([
    candidate("asset-A", x, { ticker: "A" }), candidate("asset-B", y, { ticker: "B" }),
  ], "asset_returns"), request(["asset-A", "asset-B"], "asset_returns",
    { constraints: { totalCash: { min: 0, max: 0 } } }));
  const alpha = optimizePreparedSnapshot(snapshot([
    candidate("alpha-A", x, { kind: "alpha_streams", exposures: { A: 1 } }),
    candidate("alpha-B", y, { kind: "alpha_streams", exposures: { B: 1 } }),
  ], "alpha_streams"), request(["alpha-A", "alpha-B"], "alpha_streams",
    { constraints: { totalCash: { min: 0, max: 0 } } }));
  assert.equal(asset.status, "SOLVED", asset.reason);
  assert.equal(alpha.status, "SOLVED", alpha.reason);
  close(asset.assetWeights!.A, alpha.assetWeights!.A);
  close(asset.assetWeights!.B, alpha.assetWeights!.B);
});

test("B2 T4 enforces underlying asset and total cash constraints through internal alpha cash", () => {
  const returns = [0.01, -0.01, 0.015, -0.015, 0.005, -0.005];
  const candidates = [
    candidate("a1", returns, { kind: "alpha_streams", exposures: { A: 0.7 } }),
    candidate("a2", returns.map((value) => value * 1.1), { kind: "alpha_streams", exposures: { A: 0.5 } }),
    candidate("b", returns.map((value) => value * 1.3), { kind: "alpha_streams", exposures: { B: 0.4 } }),
  ];
  const result = optimizePreparedSnapshot(snapshot(candidates, "alpha_streams"),
    request(["a1", "a2", "b"], "alpha_streams", {
      constraints: { assetBounds: { A: { max: 0.3 } }, totalCash: { min: 0.6, max: 0.6 } },
    }));
  assert.equal(result.status, "SOLVED", result.reason);
  close(result.assetWeights!.A, 0.3);
  close(result.totalCash!, 0.6);
  const candidateWeights = result.candidateWeights!;
  close(result.assetWeights!.A, 0.7 * candidateWeights.a1 + 0.5 * candidateWeights.a2);
  close(result.totalCash!, result.masterCash! + 0.3 * candidateWeights.a1 + 0.5 * candidateWeights.a2 +
    0.6 * candidateWeights.b);
  assert.ok(result.solver.maxConstraintViolation! <= 1e-8);
});

test("B2 T5 classifies infeasible and unsupported inputs and tolerates collinearity", () => {
  const returns = [0.01, -0.01, 0.02, -0.02, 0.005, -0.005];
  const collinear = snapshot([candidate("a", returns), candidate("b", returns.map((value) => value + 1e-12))],
    "asset_returns");
  const nearCollinear = optimizePreparedSnapshot(collinear, request(["a", "b"], "asset_returns"));
  assert.equal(nearCollinear.status, "SOLVED", nearCollinear.reason);
  const infeasible = optimizePreparedSnapshot(collinear, request(["a", "b"], "asset_returns", {
    constraints: { candidateBounds: { a: { min: 0.8 }, b: { min: 0.8 } } },
  }));
  assert.equal(infeasible.status, "INFEASIBLE");
  const unsupported = optimizePreparedSnapshot(collinear, request(["a", "b"], "asset_returns", {
    constraints: { unsupported: ["cardinality <= 1", "signed allocations"] },
  }));
  assert.equal(unsupported.status, "UNSUPPORTED");
  assert.match(validateCovariance([[1, 2], [2, 1]]) ?? "", /positive semidefinite/);
  assert.equal(optimizePreparedSnapshot(collinear, request(["a", "b"], "asset_returns",
    { representation: "signals" })).status, "UNSUPPORTED");
});

test("B2 T6 optimizes thirty eligible streams without alias variables or correlation filtering", () => {
  const prepared = actualB1ThirtyStreamSnapshot();
  assert.equal(prepared.candidates.length, 30);
  assert.ok(prepared.candidates.every((item) => item.status === "READY"));
  const ids = prepared.candidates.map((item) => item.candidateId);
  const query = request(ids, "alpha_streams", {
    informationCutoff: prepared.dataset.endDate, decisionTimestamp: prepared.dataset.endDate,
    estimationWindow: 120, minObservations: 30,
  });
  const before = optimizePreparedSnapshot(prepared, query);
  assert.equal(before.status, "SOLVED", before.reason);
  assert.equal(Object.keys(before.candidateWeights!).length, 30);
  close(Object.values(before.candidateWeights!).reduce((sum, value) => sum + value, 0) + before.masterCash!, 1);
  const weights = Object.values(before.candidateWeights!);
  const objective = 0.5 * weights.reduce((sum, value, i) => sum + weights.reduce((inner, other, j) =>
    inner + value * before.model!.sigma[i][j] * other, 0), 0);
  close(before.objectiveContributions!.total, objective);
  assert.ok(before.solver.scaledOptimalityResidual! <= 1e-6);
  const withAlias = { ...prepared, candidates: [...prepared.candidates, { ...prepared.candidates[0], name: "alias" }] };
  const after = optimizePreparedSnapshot(withAlias, query);
  assert.equal(after.status, "SOLVED", after.reason);
  close(after.objectiveContributions!.total, before.objectiveContributions!.total);
  for (const id of ids) close(after.candidateWeights![id], before.candidateWeights![id]);
});

test("B2 T7 excludes all post-cutoff observations and decision-time exposures", () => {
  const returns = [0.01, 0.02, -0.01, 0.005, -0.002, 0.004];
  const alpha = candidate("stream", returns, { kind: "alpha_streams", exposures: { A: 1 }, alias: true });
  const clean = optimizePreparedSnapshot(snapshot([alpha], "alpha_streams"),
    request(["stream"], "alpha_streams", { informationCutoff: dateAt(8), decisionTimestamp: dateAt(8) }));
  const changed = {
    ...alpha,
    ledger: [...alpha.ledger as Array<Record<string, unknown>>, {
      date: dateAt(9), beginningNav: 100, etfPnl: 900, cashPnl: 0, netPnl: 900,
      transactionCosts: 0, slippage: 0,
    }],
    targetHistory: [...alpha.targetHistory, { signalDate: dateAt(20), informationCutoff: dateAt(19),
      executionDate: dateAt(20), targetPositions: { B: 1 } }],
  } as PreparedCandidate;
  const mutated = optimizePreparedSnapshot(snapshot([changed], "alpha_streams"),
    request(["stream"], "alpha_streams", { informationCutoff: dateAt(8), decisionTimestamp: dateAt(8) }));
  assert.equal(clean.status, "SOLVED", clean.reason);
  assert.equal(mutated.status, "SOLVED", mutated.reason);
  assert.deepEqual(mutated.model!.dates, clean.model!.dates);
  assert.deepEqual(mutated.model!.mu, clean.model!.mu);
  assert.deepEqual(mutated.model!.H, clean.model!.H);
  assert.deepEqual(mutated.candidateWeights, clean.candidateWeights);
});

test("D1 T5 freezes statistical-factor covariance to aligned gross returns through the cutoff", () => {
  const x = [0.01, -0.02, 0.03, -0.01, 0.02, -0.015, 0.025, -0.005];
  const y = [0.015, -0.01, 0.02, -0.025, 0.01, -0.01, 0.018, -0.002];
  const cleanCandidates = [
    candidate("alpha-a", x, { kind: "alpha_streams", exposures: { A: 1 } }),
    candidate("alpha-b", y, { kind: "alpha_streams", exposures: { B: 1 } }),
  ];
  const chosen = request(["alpha-a", "alpha-b"], "alpha_streams", {
    informationCutoff: dateAt(10),
    decisionTimestamp: dateAt(10),
    estimationWindow: 10,
    minObservations: 6,
    covarianceDiagonalShrinkage: 0.25,
    riskModel: { type: "STATISTICAL_FACTOR", factorCount: 1, specificRiskFloorFraction: 0.01 },
  });
  const clean = optimizePreparedSnapshot(snapshot(cleanCandidates, "alpha_streams"), chosen);
  const changedCandidates = cleanCandidates.map((item, index) => ({
    ...item,
    ledger: [...item.ledger, {
      date: dateAt(12), beginningNav: 100, etfPnl: (index ? -500 : 900), cashPnl: 0,
      netPnl: index ? -500 : 900, transactionCosts: 0, slippage: 0,
    }],
  }));
  const changed = optimizePreparedSnapshot(snapshot(changedCandidates, "alpha_streams"), chosen);
  assert.equal(clean.status, "SOLVED", clean.reason);
  assert.equal(changed.status, "SOLVED", changed.reason);
  assert.equal(clean.riskModel?.type, "STATISTICAL_FACTOR");
  assert.deepEqual(changed.riskModel, clean.riskModel);
  assert.deepEqual(changed.model?.dates, clean.model?.dates);
  assert.deepEqual(changed.model?.sigma, clean.model?.sigma);
  assert.deepEqual(changed.candidateWeights, clean.candidateWeights);
  assert.ok(clean.riskModel!.provenance.dates.every((date) => date <= chosen.informationCutoff));
  assert.deepEqual(clean.riskModel!.provenance.candidateIds, chosen.candidateIds);
  assert.equal(clean.riskModel!.provenance.datasetHash, "fixture-hash");

  const detail = clean.riskModel!;
  assert.deepEqual(detail.sampleDiagnostics!.covariance, detail.sampleCovariance);
  assert.deepEqual(detail.sampleDiagnostics!.correlation, detail.factorModel!.correlationMatrix);
  assert.deepEqual(detail.sampleDiagnostics!.covarianceEigenvalues, detail.factorModel!.diagnostics.sampleEigenvalues);
  assert.deepEqual(detail.sampleDiagnostics!.correlationEigenvalues, detail.factorModel!.eigenvalues);
  assert.deepEqual(detail.sameWindowModels!.SAMPLE.covariance, detail.sampleCovariance);
  assert.deepEqual(detail.sameWindowModels!.STATISTICAL_FACTOR.covariance, clean.model!.sigma);
  const expectedShrinkage = detail.sampleCovariance.map((row, i) => row.map((value, j) =>
    (1 - chosen.covarianceDiagonalShrinkage) * value +
    (i === j ? chosen.covarianceDiagonalShrinkage * detail.sampleCovariance[i][i] : 0)));
  assert.deepEqual(detail.sameWindowModels!.DIAGONAL_SHRINKAGE.covariance, expectedShrinkage);
  const weights = chosen.candidateIds.map((id) => clean.candidateWeights![id]);
  const independentlyCalculatedVolatility = (matrix: number[][]) => Math.sqrt(Math.max(0,
    matrix.reduce((sum, row, i) => sum + row.reduce((inner, value, j) =>
      inner + weights[i] * value * weights[j], 0), 0)));
  for (const model of Object.values(detail.sameWindowModels!))
    close(model.expectedDailyVolatility!, independentlyCalculatedVolatility(model.covariance), 1e-12);
  close(detail.sameWindowModels!.STATISTICAL_FACTOR.expectedDailyVolatility!, clean.estimatedVolatility!, 1e-12);
});

function rebalanceAssetFixture(meanReturn = 0.08, variance = 0.1) {
  const deviation = Math.sqrt(variance);
  const asset = candidate("A", [meanReturn - deviation, meanReturn + deviation, meanReturn],
    { ticker: "A" });
  const prepared = snapshot([asset], "asset_returns");
  prepared.dataset.csvContent = `date,A,B\n${dateAt(10)},100,100`;
  return prepared;
}

function rebalanceRequest(overrides: Partial<AllocationRequest> = {}): AllocationRequest {
  return request(["A"], "asset_returns", {
    objective: { type: "regularized_mean_variance", gamma: 1, eta: 0 },
    ...overrides,
  });
}

test("D5 SIMPLE T1 absent and zero regularization preserve nominal and robust D4 paths exactly", () => {
  const prepared = rebalanceAssetFixture();
  const nominal = optimizePreparedSnapshot(prepared, rebalanceRequest());
  const nominalZero = optimizePreparedSnapshot(prepared, rebalanceRequest({
    rebalanceRegularization: { lambdaR: 0 },
  }));
  assert.equal(nominal.status, "SOLVED", nominal.reason);
  assert.equal(nominalZero.status, "SOLVED", nominalZero.reason);
  assert.deepEqual(nominalZero.candidateWeights, nominal.candidateWeights);
  assert.deepEqual(nominalZero.objectiveContributions, nominal.objectiveContributions);
  assert.equal(nominalZero.solver.version, nominal.solver.version);

  const robustRequest = {
    forecastModel: { type: "SAMPLE_MEAN" as const },
    robustness: { method: "ROBUST_MEAN_UNCERTAINTY" as const, kappa: 0.1 },
  };
  const robust = optimizePreparedSnapshot(prepared, rebalanceRequest(robustRequest));
  const robustZero = optimizePreparedSnapshot(prepared, rebalanceRequest({
    ...robustRequest, rebalanceRegularization: { lambdaR: 0 },
  }));
  assert.equal(robust.status, "SOLVED", robust.reason);
  assert.equal(robustZero.status, "SOLVED", robustZero.reason);
  assert.deepEqual(robustZero.candidateWeights, robust.candidateWeights);
  assert.deepEqual(robustZero.objectiveContributions, robust.objectiveContributions);
  assert.equal(robustZero.solver.version, robust.solver.version);
});

test("D5 SIMPLE T2 solves the quadratic rebalance penalty analytically and reports its constant", () => {
  const meanReturn = 0.012, variance = 0.02;
  const prepared = snapshot([candidate("A", [meanReturn - Math.sqrt(variance / 2),
    meanReturn + Math.sqrt(variance / 2)], { ticker: "A" })], "asset_returns");
  prepared.dataset.csvContent = `date,A\n${dateAt(10)},100`;
  const baseRequest = rebalanceRequest({ estimationWindow: 2, minObservations: 2 });
  const noPenalty = optimizePreparedSnapshot(prepared, baseRequest);
  const regularized = optimizePreparedSnapshot(prepared, {
    ...baseRequest,
    rebalanceRegularization: { lambdaR: 0.04,
      holdings: { asOf: dateAt(10), quantities: { A: 0.002 }, cash: 0.8, nav: 1 } },
  });
  assert.equal(noPenalty.status, "SOLVED", noPenalty.reason);
  assert.equal(regularized.status, "SOLVED", regularized.reason);
  close(noPenalty.assetWeights!.A, 0.6, 1e-8);
  close(regularized.assetWeights!.A, 1 / 3, 1e-8);
  const objective = (weight: number) => 0.5 * variance * weight ** 2 - meanReturn * weight +
    0.5 * 0.04 * (weight - 0.2) ** 2;
  const derivative = (weight: number) => variance * weight - meanReturn + 0.04 * (weight - 0.2);
  close(derivative(regularized.assetWeights!.A), 0, 1e-8);
  close(regularized.rebalanceRegularization!.penalty,
    0.5 * 0.04 * (regularized.assetWeights!.A - 0.2) ** 2, 1e-8);
  close(regularized.objectiveContributions!.total, objective(regularized.assetWeights!.A), 1e-8);
  assert.equal(regularized.solver.version, "D5-SIMPLE.1");
});

test("D5 SIMPLE T4 rejects invalid lambda, missing valuation, cost stacking, and infeasible constraints", () => {
  const prepared = rebalanceAssetFixture();
  assert.equal(optimizePreparedSnapshot(prepared, rebalanceRequest({
    rebalanceRegularization: { lambdaR: Number.NaN },
  })).status, "INVALID_INPUT");
  assert.equal(optimizePreparedSnapshot(prepared, rebalanceRequest({
    rebalanceRegularization: { lambdaR: -1 },
  })).status, "INVALID_INPUT");
  assert.equal(optimizePreparedSnapshot(prepared, rebalanceRequest({
    rebalanceRegularization: { lambdaR: 1 },
  })).status, "INVALID_INPUT");
  assert.equal(optimizePreparedSnapshot(prepared, rebalanceRequest({
    rebalanceRegularization: { lambdaR: 1,
      holdings: { asOf: dateAt(9), quantities: { A: 0.4 }, cash: 60, nav: 100 } },
  })).status, "INVALID_INPUT");
  assert.equal(optimizePreparedSnapshot(prepared, rebalanceRequest({
    rebalanceRegularization: { lambdaR: 1,
      holdings: { asOf: dateAt(10), quantities: { A: 0.4 }, cash: 59, nav: 100 } },
  })).status, "INVALID_INPUT");
  assert.equal(optimizePreparedSnapshot(prepared, rebalanceRequest({
    costAware: { costAmortizationDays: 1, transactionCostBps: 0, slippageBps: 0,
      holdings: { asOf: dateAt(10), quantities: { A: 0.4 }, cash: 60, nav: 100 } },
    rebalanceRegularization: { lambdaR: 1,
      holdings: { asOf: dateAt(10), quantities: { A: 0.4 }, cash: 60, nav: 100 } },
  })).status, "UNSUPPORTED");
  assert.equal(optimizePreparedSnapshot(prepared, rebalanceRequest({
    objective: { type: "minimum_variance", gamma: 1, eta: 0 },
    rebalanceRegularization: { lambdaR: 1,
      holdings: { asOf: dateAt(10), quantities: { A: 0.4 }, cash: 60, nav: 100 } },
  })).status, "INVALID_INPUT");
  const infeasible = optimizePreparedSnapshot(prepared, rebalanceRequest({
    constraints: { candidateBounds: { A: { min: 0.8 } }, totalCash: { min: 0.5 } },
    rebalanceRegularization: { lambdaR: 1,
      holdings: { asOf: dateAt(10), quantities: { A: 0.4 }, cash: 60, nav: 100 } },
  }));
  assert.equal(infeasible.status, "INFEASIBLE");
});

test("D5 SIMPLE T5 robust capital constraints bind and cutoff evidence ignores future rows", () => {
  const prepared = rebalanceAssetFixture();
  const query = rebalanceRequest({
    forecastModel: { type: "SAMPLE_MEAN" },
    robustness: { method: "ROBUST_MEAN_UNCERTAINTY", kappa: 0.1 },
    constraints: { candidateBounds: { A: { max: 0.5 } } },
    rebalanceRegularization: { lambdaR: 10,
      holdings: { asOf: dateAt(10), quantities: { A: 0.01 }, cash: 0, nav: 1 } },
  });
  const clean = optimizePreparedSnapshot(prepared, query);
  const futureMutation = structuredClone(prepared);
  futureMutation.dataset.csvContent += `\n${dateAt(15)},999,999`;
  futureMutation.candidates[0].ledger = [...futureMutation.candidates[0].ledger as Array<Record<string, unknown>>, {
    date: dateAt(15), beginningNav: 100, etfPnl: 9000, cashPnl: 0, netPnl: 9000,
    transactionCosts: 0, slippage: 0,
  }] as PreparedCandidate["ledger"];
  const mutated = optimizePreparedSnapshot(futureMutation, query);
  assert.equal(clean.status, "SOLVED", clean.reason);
  assert.equal(mutated.status, "SOLVED", mutated.reason);
  close(clean.assetWeights!.A, 0.5, 1e-7);
  assert.deepEqual(mutated.model?.dates, clean.model?.dates);
  assert.deepEqual(mutated.model?.mu, clean.model?.mu);
  assert.deepEqual(mutated.rebalanceRegularization, clean.rebalanceRegularization);
  assert.ok(clean.solver.maxConstraintViolation! <= 1e-8);
  close(clean.objectiveContributions!.total,
    clean.objectiveContributions!.variance + clean.objectiveContributions!.regularization +
    clean.objectiveContributions!.candidateReturn + (clean.objectiveContributions!.robustHaircut ?? 0) +
    clean.rebalanceRegularization!.penalty, 1e-7);
});