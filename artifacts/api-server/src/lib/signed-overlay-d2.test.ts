import assert from "node:assert/strict";
import test from "node:test";
import { optimizePreparedSnapshot, type AllocationRequest } from "./allocation-b2";
import type { PreparedCandidate, PreparedSnapshot } from "./prepared-inputs";

function dateAt(index: number): string {
  return new Date(Date.UTC(2023, 0, 1 + index)).toISOString().slice(0, 10);
}

function candidate(id: string, returns: number[], exposures: Record<string, number>,
  options: { cashYieldAnnual?: number; cashReturns?: number[]; assetReturns?: number[] } = {}): PreparedCandidate {
  const annual = options.cashYieldAnnual ?? 0;
  const ledger = returns.map((value, i) => {
    const cashReturn = options.cashReturns?.[i] ?? (1 + annual) ** (1 / 252) - 1;
    const beginningCash = options.assetReturns ? 50 : 0;
    const cashPnl = beginningCash * cashReturn;
    const etfPnl = options.assetReturns ? 50 * options.assetReturns[i] : value * 100;
    return {
      date: dateAt(i + 1), beginningNav: 100, beginningCash, etfPnl, cashPnl,
      netPnl: etfPnl + cashPnl, transactionCosts: 0, slippage: 0,
    };
  });
  return {
    candidateId: id, canonicalFingerprint: id, name: id, kind: "alpha_streams",
    status: "READY", reasons: [], assetTickers: Object.keys(exposures),
    targetAssetExposures: exposures, actualAssetExposures: exposures,
    residualCash: 1 - Object.values(exposures).reduce((sum, value) => sum + value, 0),
    targetHistory: [{ signalDate: dateAt(5), informationCutoff: dateAt(4), executionDate: dateAt(5),
      targetPositions: exposures }],
    signalSeries: [], returnSeries: [], ledger,
    lineage: { datasetHash: "d2-fixture", definition: { cashYieldAnnual: annual } }, diagnostics: {},
  } as PreparedCandidate;
}

function snapshot(candidates: PreparedCandidate[]): PreparedSnapshot {
  return {
    schemaVersion: 1, engineVersion: "allocation-b1.0", a1EngineVersion: "a1",
    representation: "alpha_streams", dataset: { id: 2, sha256: "d2-fixture", csvContent: "",
      startDate: dateAt(0), endDate: dateAt(50), tickers: ["A", "B", "C"], priceConvention: "adjusted close" },
    factorSet: { version: "fixture", factors: [] }, request: { representation: "alpha_streams",
      assetTickers: [], factorIds: [], alphaDefinitions: [] }, coverage: {}, candidates,
    dependence: {}, suppliedWeights: {}, createdAt: dateAt(0),
  } as unknown as PreparedSnapshot;
}

function request(ids: string[], overrides: Partial<AllocationRequest> = {}): AllocationRequest {
  return {
    preparedInputId: 2, candidateIds: ids, informationCutoff: dateAt(30), decisionTimestamp: dateAt(30),
    estimationWindow: 30, minObservations: 3, representation: "alpha_streams",
    returnConvention: "daily_decimal", expectedReturnShrinkage: 0, covarianceDiagonalShrinkage: 0,
    dailyCashYield: 0, objective: { type: "regularized_mean_variance", gamma: 2, eta: 0 },
    constraints: {}, allocationMode: "SIGNED_OVERLAY", ...overrides,
  };
}

function centered(variance: number, size = 5): number[] {
  const raw = Array.from({ length: size }, (_, i) => i - (size - 1) / 2);
  const scale = Math.sqrt(variance * (size - 1) / raw.reduce((sum, value) => sum + value * value, 0));
  return raw.map((value) => value * scale);
}

function orthogonalPair(varianceA: number, varianceB: number): [number[], number[]] {
  const scaleA = Math.sqrt(2 * varianceA);
  const scaleB = Math.sqrt(2 * varianceB / 3);
  return [
    [-1, 1, 0, 0, 0].map((value) => value * scaleA),
    [1, 1, -2, 0, 0].map((value) => value * scaleB),
  ];
}

function stream(id: string, mean: number, variance: number, exposure: Record<string, number>, size = 5) {
  return candidate(id, centered(variance, size).map((value) => mean + value), exposure);
}

function close(actual: number, expected: number, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);
}

test("D2 T1 matches the signed analytical mean-variance optimum and reports economic exposure", () => {
  const [x, y] = orthogonalPair(0.04, 0.09);
  const a = x.map((value) => 0.01 + value);
  const b = y.map((value) => -0.009 + value);
  const result = optimizePreparedSnapshot(snapshot([
    candidate("a", a, { A: 1 }), candidate("b", b, { B: 1 }),
  ]), request(["a", "b"], { signedConstraints: {
    alphaBounds: { a: { min: -1, max: 1 }, b: { min: -1, max: 1 } }, grossAlphaMax: 1,
  } }));
  assert.equal(result.status, "SOLVED", result.reason);
  close(result.candidateWeights!.a, 0.125);
  close(result.candidateWeights!.b, -0.05);
  close(result.signedOverlay!.alphaGrossExposure, 0.175);
  close(result.signedOverlay!.netAlphaCoefficient, 0.075);
  close(result.objectiveContributions!.variance, 0.5 * 2 *
    (0.125 ** 2 * result.model!.sigma[0][0] + 0.05 ** 2 * result.model!.sigma[1][1]));
  close(result.objectiveContributions!.candidateReturn,
    -result.model!.mu[0] * 0.125 + result.model!.mu[1] * 0.05);
  assert.equal(result.signedOverlay!.allocationMode, "SIGNED_OVERLAY");
});

test("D2 T2 reverses B1 active exposure without double-counting internal cash", () => {
  const cash = [0.001, 0.002, 0.0015, 0.0012, 0.0018];
  const asset = [0.01, -0.02, 0.03, 0.005, -0.01];
  const alphaGross = asset.map((value, i) => 0.5 * value + 0.5 * cash[i]);
  const result = optimizePreparedSnapshot(snapshot([
    candidate("half", alphaGross, { A: 0.5 }, { cashYieldAnnual: 0.65, cashReturns: cash, assetReturns: asset }),
  ]), request(["half"], { signedConstraints: { alphaBounds: { half: { min: -0.4, max: -0.4 } } } }));
  assert.equal(result.status, "SOLVED", result.reason);
  close(result.assetWeights!.A, -0.2);
  close(result.signedOverlay!.cashTarget, 1.2);
  for (let i = 0; i < cash.length; i++) {
    const alphaExcess = alphaGross[i] - cash[i];
    const viaAlpha = cash[i] - 0.4 * alphaExcess;
    const viaUnderlying = cash[i] - 0.2 * (asset[i] - cash[i]);
    close(viaAlpha, viaUnderlying);
  }
});

test("D5 signed leveraged book accepts negative cash with positive marked NAV across decisions", () => {
  const returns = centered(0.02).map((value) => value + 0.01);
  const selected = candidate("levered", returns, { A: 1 });
  const prepared = snapshot([selected]);
  prepared.dataset.csvContent = [
    "date,A", `${dateAt(30)},100`, `${dateAt(40)},100`,
  ].join("\n");

  for (const { cutoff, quantity, cash, expectedTrade } of [
    { cutoff: dateAt(30), quantity: 1.1, cash: -10, expectedTrade: 0.1 },
    { cutoff: dateAt(40), quantity: 1.15, cash: -15, expectedTrade: 0.05 },
  ]) {
    const nav = quantity * 100 + cash;
    assert.ok(nav > 0);
    assert.ok(cash < 0);
    const result = optimizePreparedSnapshot(prepared, request(["levered"], {
      informationCutoff: cutoff, decisionTimestamp: cutoff,
      signedConstraints: {
        alphaBounds: { levered: { min: 1.2, max: 1.2 } },
        cash: { min: -0.25, max: -0.15 },
      },
      costAware: {
        costAmortizationDays: 2, transactionCostBps: 50, slippageBps: 10,
        holdings: { asOf: cutoff, quantities: { A: quantity }, cash, nav },
      },
    }));
    assert.equal(result.status, "SOLVED", result.reason);
    close(result.assetWeights!.A, 1.2);
    close(result.signedOverlay!.cashTarget, -0.2);
    close(result.costAware!.assets[0].tradeFraction, expectedTrade);
    close(result.costAware!.assets[0].currentWeight + cash / nav, 1);
    assert.ok(result.solver.maxConstraintViolation! <= 1e-8);
  }
});

test("D2 T3 reports actual alpha gross and netted underlying gross/net/cash", () => {
  const data = centered(0.03, 6);
  const result = optimizePreparedSnapshot(snapshot([
    candidate("first", data, { A: 1 }),
    candidate("second", data.map((value) => value * 1.1), { A: 0.9 }),
    candidate("third", data.map((value) => value * 1.2), { B: 1 }),
  ]), request(["first", "second", "third"], {
    signedConstraints: { alphaBounds: {
      first: { min: 1, max: 1 }, second: { min: -0.8, max: -0.8 }, third: { min: 0.2, max: 0.2 },
    }, grossAlphaMax: 2.5, grossAssetMax: 1 },
  }));
  assert.equal(result.status, "SOLVED", result.reason);
  const metrics = result.signedOverlay!;
  close(metrics.alphaGrossExposure, 2);
  close(metrics.longAssetExposure, 0.48);
  close(metrics.shortAssetExposure, 0);
  close(metrics.grossAssetExposure, 0.48);
  close(metrics.netAssetExposure, 0.48);
  close(metrics.cashTarget, 0.52);
  assert.ok(metrics.alphaGrossExposure > metrics.grossAssetExposure);
  close(result.assetWeights!.A, 0.28);
  close(result.assetWeights!.B, 0.2);
});

test("D2 T4 requires a positive return target and solves constrained minimum variance analytically", () => {
  const [x, y] = orthogonalPair(0.04, 0.09);
  const a = x.map((value) => 0.01 + value);
  const b = y.map((value) => 0.02 + value);
  const prepared = snapshot([candidate("a", a, { A: 1 }), candidate("b", b, { B: 1 })]);
  const base = request(["a", "b"], {
    objective: { type: "minimum_variance", gamma: 1, eta: 0 }, targetExcessReturn: 0.1,
    signedConstraints: { grossAlphaMax: 10 },
  });
  const result = optimizePreparedSnapshot(prepared, base);
  assert.equal(result.status, "SOLVED", result.reason);
  const denominator = 0.01 ** 2 / 0.04 + 0.02 ** 2 / 0.09;
  close(result.candidateWeights!.a, 0.1 * (0.01 / 0.04) / denominator);
  close(result.candidateWeights!.b, 0.1 * (0.02 / 0.09) / denominator);
  close(result.signedOverlay!.expectedExcessReturn, 0.1);
  const missing = optimizePreparedSnapshot(prepared, { ...base, targetExcessReturn: undefined });
  assert.equal(missing.status, "MISSING_TARGET_EXCESS_RETURN");
  assert.match(missing.reason ?? "", /MISSING_TARGET_EXCESS_RETURN/);
});

test("D2 T5 enforces each signed constraint and reports infeasible and unbounded problems", () => {
  const prepared = snapshot([
    stream("a", 0.01, 0.04, { A: 0.5 }),
    stream("b", -0.005, 0.05, { B: 0.5 }),
  ]);
  const feasible = optimizePreparedSnapshot(prepared, request(["a", "b"], {
    signedConstraints: {
      alphaBounds: { a: { min: 0.35, max: 0.45 }, b: { min: -0.25, max: -0.15 } },
      grossAlphaMax: 0.7, groupGrossCaps: [{ group: "one", candidateIds: ["a"], max: 0.5 }],
      assetBounds: { A: { min: 0.1, max: 0.3 }, B: { min: -0.2, max: 0 } },
      grossAssetMax: 0.4, netAssetExposure: { min: -0.1, max: 0.3 }, cash: { min: 0.7, max: 1.1 },
    },
  }));
  assert.equal(feasible.status, "SOLVED", feasible.reason);
  for (const name of ["alpha:a", "gross_alpha", "group_gross:one", "asset:A", "gross_asset",
    "net_asset_exposure", "cash"])
    assert.ok(feasible.constraintSlacks.some((constraint) => constraint.name === name), `${name} missing`);
  const infeasible = optimizePreparedSnapshot(prepared, request(["a", "b"], {
    signedConstraints: { alphaBounds: { a: { min: 0.4, max: 0.4 } }, grossAlphaMax: 0.3 },
  }));
  assert.equal(infeasible.status, "INFEASIBLE");
  const rankDeficient = snapshot([
    candidate("x", [0, 0.01, -0.01, 0.02, -0.02], { A: 1 }),
    candidate("y", [0.01, 0.02, 0, 0.03, -0.01], { B: 1 }),
  ]);
  const unbounded = optimizePreparedSnapshot(rankDeficient, request(["x", "y"], {
    objective: { type: "regularized_mean_variance", gamma: 1, eta: 0 },
  }));
  assert.equal(unbounded.status, "UNBOUNDED");
});

test("D2 T6 D1 signed factor risk decomposition reconciles and preserves negative CRC", () => {
  const series = Array.from({ length: 24 }, (_, i) => {
    const common = Math.sin(i * 0.71) * 0.01;
    return [common + Math.cos(i * 0.31) * 0.001,
      common * 0.92 + Math.sin(i * 0.43) * 0.001,
      -common * 0.2 + Math.cos(i * 0.57) * 0.0015];
  });
  const prepared = snapshot([
    candidate("a", series.map((row) => 0.002 + row[0]), { A: 1 }),
    candidate("b", series.map((row) => 0.001 + row[1]), { B: 1 }),
    candidate("c", series.map((row) => row[2]), { C: 1 }),
  ]);
  const result = optimizePreparedSnapshot(prepared, request(["a", "b", "c"], {
    riskModel: { type: "STATISTICAL_FACTOR", factorCount: 1, specificRiskFloorFraction: 0.01 },
    signedConstraints: { alphaBounds: { a: { min: 1, max: 1 }, b: { min: -0.7, max: -0.7 },
      c: { min: 0.2, max: 0.2 } } },
  }));
  assert.equal(result.status, "SOLVED", result.reason);
  const decomposition = result.riskModel!.decomposition as {
    portfolioVariance: number; factorVariance: number; specificVariance: number;
    portfolioVolatility: number; alphaMarginalComponentRisk: Array<{ componentContributionToRisk: number | null }>;
  };
  close(decomposition.portfolioVariance, decomposition.factorVariance + decomposition.specificVariance, 1e-8);
  close(decomposition.alphaMarginalComponentRisk.reduce((sum, item) =>
    sum + (item.componentContributionToRisk ?? 0), 0), decomposition.portfolioVolatility, 1e-8);
  assert.ok(decomposition.alphaMarginalComponentRisk.some((item) => (item.componentContributionToRisk ?? 0) < 0));
});