import assert from "node:assert/strict";
import test from "node:test";
import { optimizePreparedSnapshot, type AllocationRequest } from "./allocation-b2";
import { runB3Validation, type B3ExecutionAssumptions } from "./b3-policy";
import { prepareSnapshot, type AlphaDefinition, type PreparedSnapshot } from "./prepared-inputs";
import type { FactorDefinition } from "./factor-library";
import { hashDataset } from "./run-snapshot";

const tickers = ["A", "B", "C", "D", "E"];

function dateAt(index: number): string {
  return new Date(Date.UTC(2022, 0, 1 + index)).toISOString().slice(0, 10);
}

function csvFor(length = 180, missing?: { ticker: string; index: number }): string {
  return ["date,A,B,C,D,E", ...Array.from({ length }, (_, i) => {
    const prices = tickers.map((_, asset) => {
      if (missing?.ticker === tickers[asset] && missing.index === i) return "";
      return (100 + (i + 1) * (asset + 1) * 0.17 + Math.sin(i * (asset + 1)) * 2).toFixed(8);
    });
    return `${dateAt(i)},${prices.join(",")}`;
  })].join("\n");
}

const transformations = [
  { type: "momentum", lookback: 5, direction: "higher_is_better", formula: "P(t-lag)/P(t-lag-lookback)-1" },
  { type: "trend_quality", lookback: 10, direction: "higher_is_better", formula: "trendQuality(P[t-lookback:t-lag])" },
  { type: "volatility", lookback: 8, direction: "lower_is_better", formula: "realizedVolatility(P[t-lookback:t-lag])" },
  { type: "drawdown", lookback: 12, direction: "higher_is_better", formula: "-maxDrawdown(P[t-lookback:t-lag])" },
  { type: "mean_reversion", lookback: 4, direction: "higher_is_better", formula: "-return(P[t-lookback:t-lag])" },
  { type: "ma_distance", lookback: 15, direction: "higher_is_better", formula: "P(t-lag)/mean(P[t-lookback:t-lag])-1" },
];

function factors(): FactorDefinition[] {
  return transformations.map((item, i) => ({
    id: `b3_factor_${i}`, name: `${item.type} ${i}`, description: "Deterministic B3 test fixture", family: "Test",
    enabled: true, status: "active", inputSeries: "adjusted close", calculationType: item.type,
    formula: item.formula, direction: item.direction, lookback: item.lookback, lag: 0,
    normalization: "percentile_rank", winsorizationLower: 0, winsorizationUpper: 1,
    missingDataTreatment: "exclude", baseWeight: 1, regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 },
    activeRegimes: ["risk_on", "neutral", "risk_off"], dataSource: "synthetic test prices",
    benchmarkTicker: null, currentCoverage: 1, availabilityReason: null, version: "b3-test-v1",
  } as FactorDefinition));
}

function makeSnapshot(representation: "asset_returns" | "alpha_streams", source = csvFor()): PreparedSnapshot {
  const factorSet = factors();
  const alphaDefinitions: AlphaDefinition[] = tickers.flatMap((ticker) => transformations.map((_, i) => ({
    name: `${ticker} stream ${i}`, factorId: `b3_factor_${i}`, assetTickers: [ticker],
    mapping: "single_asset_long_cash" as const, signalUnits: "oriented" as const,
    threshold: representation === "alpha_streams" ? -100 : 0, grossFraction: 1,
    rebalanceFrequency: "monthly" as const, executionTiming: "next_close" as const,
    transactionCostBps: 0, slippageBps: 0, cashYieldAnnual: 0,
  })));
  const snapshot = prepareSnapshot({
    request: {
      representation, assetTickers: tickers, factorIds: [],
      alphaDefinitions: representation === "alpha_streams" ? alphaDefinitions : [],
    },
    csvContent: source, factorVersion: "b3-test-v1", factors: factorSet, datasetId: 13,
  });
  return snapshot;
}

function withOhlc(snapshot: PreparedSnapshot, missing?: { ticker: string; index: number }): PreparedSnapshot {
  const sourceRows = snapshot.dataset.csvContent.trim().split(/\r?\n/);
  const header = sourceRows[0].split(",");
  const ohlc = ["Date,Ticker,Open,High,Low,Close"];
  for (const line of sourceRows.slice(1)) {
    const [date, ...rawPrices] = line.split(",");
    const index = sourceRows.indexOf(line) - 1;
    for (let asset = 0; asset < header.length - 1; asset++) {
      const closePrice = Number(rawPrices[asset]);
      if (!Number.isFinite(closePrice)) continue;
      if (missing?.ticker === header[asset + 1] && missing.index === index) {
        ohlc.push(`${date},${header[asset + 1]},,${(closePrice * 1.01).toFixed(8)},${(closePrice * 0.89).toFixed(8)},${rawPrices[asset]}`);
        continue;
      }
      const open = closePrice * 0.9;
      ohlc.push(`${date},${header[asset + 1]},${open.toFixed(8)},${(closePrice * 1.01).toFixed(8)},${(closePrice * 0.89).toFixed(8)},${rawPrices[asset]}`);
    }
  }
  const ohlcCsvContent = ohlc.join("\n");
  return { ...snapshot, dataset: {
    ...snapshot.dataset, ohlcCsvContent, ohlcSha256: hashDataset(ohlcCsvContent),
    ohlcConvention: "adjusted_test_fixture",
  } };
}

function opposingAlphaSnapshot(): PreparedSnapshot {
  const factorSet = factors();
  const risingPrice = 100 * 1.01 ** 65;
  const csv = ["date,A", ...Array.from({ length: 180 }, (_, i) =>
    `${dateAt(i)},${(i <= 65 ? 100 * 1.01 ** i : risingPrice).toFixed(10)}`)].join("\n");
  return prepareSnapshot({
    request: {
      representation: "alpha_streams", assetTickers: ["A"], factorIds: [],
      alphaDefinitions: [
        {
          name: "partial A", factorId: "b3_factor_0", assetTickers: ["A"],
          mapping: "single_asset_long_cash", signalUnits: "oriented", threshold: 0.03,
          grossFraction: 0.5, rebalanceFrequency: "monthly", executionTiming: "next_close",
          transactionCostBps: 0, slippageBps: 0, cashYieldAnnual: 0,
        },
        {
          name: "full A", factorId: "b3_factor_1", assetTickers: ["A"],
          mapping: "single_asset_long_cash", signalUnits: "oriented", threshold: -100,
          grossFraction: 1, rebalanceFrequency: "monthly", executionTiming: "next_close",
          transactionCostBps: 0, slippageBps: 0, cashYieldAnnual: 0,
        },
      ],
    },
    csvContent: csv, factorVersion: "b3-test-v1", factors: factorSet,
  });
}

function allocationRequest(snapshot: PreparedSnapshot, overrides: Partial<AllocationRequest> = {}): AllocationRequest {
  return {
    preparedInputId: 3, candidateIds: snapshot.candidates.map((candidate) => candidate.candidateId),
    informationCutoff: dateAt(90), decisionTimestamp: dateAt(91),
    estimationWindow: 60, minObservations: 30,
    representation: snapshot.representation as "asset_returns" | "alpha_streams",
    returnConvention: "daily_decimal", expectedReturnShrinkage: 0, covarianceDiagonalShrinkage: 0,
    dailyCashYield: 0, objective: { type: "minimum_variance", gamma: 1, eta: 0 },
    constraints: { totalCash: { max: 0.2 } },
    ...overrides,
  };
}

function assumptions(
  startIndex = 50, endIndex = 150, overrides: Partial<B3ExecutionAssumptions> = {},
): B3ExecutionAssumptions {
  return {
    evaluationStartDate: dateAt(startIndex), evaluationEndDate: dateAt(endIndex),
    decisionCalendar: "monthly", executionTiming: "next_close",
    initialNav: 100, initialHoldings: {}, initialCash: 100,
    transactionCostBps: 0, slippageBps: 0, dailyCashYield: 0.0001,
    ...overrides,
  };
}

function frozenPrefix(snapshot: PreparedSnapshot, date: string): PreparedSnapshot {
  const lines = snapshot.dataset.csvContent.trimEnd().split(/\r?\n/);
  return prepareSnapshot({
    request: structuredClone(snapshot.request),
    csvContent: [lines[0], ...lines.slice(1).filter((line) => line.slice(0, 10) <= date)].join("\n"),
    factorVersion: snapshot.factorSet.version, factors: snapshot.factorSet.factors,
    datasetId: snapshot.dataset.id ?? undefined,
  });
}

function close(actual: number, expected: number, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by > ${tolerance}`);
}

test("B3 T1 recomputes isolated B2 solutions at historical dates for both objectives", () => {
  const snapshot = makeSnapshot("asset_returns");
  for (const objective of [
    { type: "minimum_variance" as const, gamma: 1, eta: 0 },
    { type: "regularized_mean_variance" as const, gamma: 2, eta: 0.1 },
  ]) {
    const policy = allocationRequest(snapshot, { objective });
    const result = runB3Validation(snapshot, policy, snapshot, assumptions());
    assert.equal(result.status, "completed", result.reason);
    assert.ok(result.decisions.length >= 3);
    for (const decision of result.decisions) {
      const truncated = frozenPrefix(snapshot, decision.executionDate);
      const pointIds = decision.pointInTimeCandidateIds;
      const isolated = optimizePreparedSnapshot(truncated, {
        ...policy, candidateIds: pointIds, decisionTimestamp: decision.decisionDate,
        informationCutoff: decision.informationCutoff,
      });
      assert.equal(isolated.status, "SOLVED", isolated.reason);
      assert.deepEqual(decision.estimationDates, isolated.model!.dates);
      assert.deepEqual(decision.optimizer.model!.sampleMeans, isolated.model!.sampleMeans);
      assert.deepEqual(decision.optimizer.model!.mu, isolated.model!.mu);
      assert.deepEqual(decision.optimizer.model!.sigma, isolated.model!.sigma);
      assert.deepEqual(decision.optimizer.model!.H, isolated.model!.H);
      assert.deepEqual(decision.optimizer.model!.d, isolated.model!.d);
      decision.policyCandidateIds.forEach((policyId, index) => {
        close(decision.candidateWeights[policyId], isolated.candidateWeights![pointIds[index]]);
      });
      for (const ticker of Object.keys(decision.targetAssetWeights))
        close(decision.targetAssetWeights[ticker], isolated.assetWeights![ticker] ?? 0);
    }
  }
});

test("B3 T2 future prices and a future missing observation do not change results through cutoff", () => {
  const source = csvFor();
  const policySnapshot = makeSnapshot("asset_returns", source);
  const policy = allocationRequest(policySnapshot);
  const cutoffIndex = 90;
  const mutatedLines = source.split("\n");
  const futurePriceLines = mutatedLines.map((line, index) => {
    if (index <= cutoffIndex + 1) return line;
    const values = line.split(",");
    values[1] = (Number(values[1]) * 1.7).toFixed(8);
    if (index === 112) values[2] = "";
    return values.join(",");
  });
  assert.notDeepEqual(mutatedLines[cutoffIndex + 2].split(","), futurePriceLines[cutoffIndex + 2].split(","));
  const clean = runB3Validation(policySnapshot, policy, policySnapshot, assumptions(40, cutoffIndex));
  const changedValidation = makeSnapshot("asset_returns", futurePriceLines.join("\n"));
  const changed = runB3Validation(policySnapshot, policy, changedValidation, assumptions(40, cutoffIndex));
  assert.equal(clean.status, "completed", clean.reason);
  assert.equal(changed.status, "completed", changed.reason);
  const stableDecision = (decision: (typeof clean.decisions)[number]) => {
    const { validationCandidateIds: _validationIds, ...stable } = decision;
    return stable;
  };
  assert.deepEqual(changed.decisions.map(stableDecision), clean.decisions.map(stableDecision));
  assert.deepEqual(changed.dailyLedger, clean.dailyLedger);
});

test("D1 T7 recomputes fixed-F covariance point-in-time at every B3 decision", () => {
  const snapshot = makeSnapshot("alpha_streams");
  const policy = allocationRequest(snapshot, {
    candidateIds: snapshot.candidates.slice(0, 3).map((candidate) => candidate.candidateId),
    estimationWindow: 60,
    minObservations: 30,
    riskModel: { type: "STATISTICAL_FACTOR", factorCount: 2, specificRiskFloorFraction: 1e-6 },
  });
  const result = runB3Validation(snapshot, policy, snapshot, assumptions(45, 130));
  assert.equal(result.status, "completed", result.reason);
  assert.ok(result.decisions.length >= 3);
  assert.equal(result.policyIdentity.riskModel?.type, "STATISTICAL_FACTOR");
  assert.equal(result.policyIdentity.riskModel?.factorCount, 2);
  for (const decision of result.decisions) {
    const risk = decision.optimizer.riskModel;
    assert.ok(risk, `Missing saved statistical-factor diagnostics at ${decision.decisionDate}`);
    assert.equal(risk.type, "STATISTICAL_FACTOR");
    assert.equal(risk.factorCount, 2);
    assert.equal(risk.provenance.informationCutoff, decision.informationCutoff);
    assert.equal(risk.provenance.observationCount, decision.estimationDates.length);
    assert.deepEqual(risk.provenance.dates, decision.estimationDates);
    assert.deepEqual(risk.provenance.candidateIds, decision.pointInTimeCandidateIds);
    assert.ok(risk.provenance.dates.every((date) => date <= decision.informationCutoff));
    assert.equal(decision.optimizer.model?.sigma, risk.covariance);
    assert.ok(risk.decomposition);
  }

  const invalidFixedFactorPolicy = {
    ...policy,
    riskModel: { ...policy.riskModel!, factorCount: policy.candidateIds.length },
  };
  const invalid = runB3Validation(snapshot, invalidFixedFactorPolicy, snapshot, assumptions(45, 130));
  assert.equal(invalid.status, "failed");
  assert.ok(invalid.failureDate);
  assert.match(invalid.reason ?? "", /INSUFFICIENT_HISTORY_OR_DIMENSION/);
});

test("B3 T3 same-close and next-close buys do not earn the pre-purchase jump; quantities persist", () => {
  const snapshot = makeSnapshot("asset_returns");
  const policy = allocationRequest(snapshot);
  for (const timing of ["same_close", "next_close"] as const) {
    const result = runB3Validation(snapshot, policy, snapshot, assumptions(50, 150, { executionTiming: timing }));
    assert.equal(result.status, "completed", result.reason);
    const first = result.decisions[0];
    const signalLedger = result.dailyLedger.find((entry) => entry.date === first.decisionDate)!;
    assert.equal(signalLedger.assetPnl, 0);
    if (timing === "next_close") {
      const executionLedger = result.dailyLedger.find((entry) => entry.date === first.executionDate)!;
      assert.equal(executionLedger.assetPnl, 0);
    }
    const betweenExecutions = result.dailyLedger.filter((entry) =>
      entry.date > first.executionDate && entry.date < result.decisions[1].executionDate);
    if (betweenExecutions.length) {
      const prior = result.dailyLedger.find((entry) => entry.date === first.executionDate)!;
      for (const entry of betweenExecutions) {
        for (const position of prior.endingPositions) {
          close(entry.beginningPositions.find((item) => item.ticker === position.ticker)?.quantity ?? 0,
            position.quantity);
        }
      }
    }
  }
});

test("B3 next_open uses the signal-date close, next-row open fills, full D5 costs, and reconciled ledger", () => {
  const snapshot = withOhlc(makeSnapshot("asset_returns"));
  const policy = allocationRequest(snapshot, {
    estimationWindow: 30,
    minObservations: 15,
    objective: { type: "regularized_mean_variance", gamma: 2, eta: 0.1 },
    costAware: {
      costAmortizationDays: 20, transactionCostBps: 10, slippageBps: 5,
      holdings: { asOf: dateAt(49), quantities: {}, cash: 100, nav: 100 },
    },
  });
  const result = runB3Validation(snapshot, policy, snapshot, assumptions(50, 150, {
    executionTiming: "next_open", transactionCostBps: 10, slippageBps: 5,
  }));
  assert.equal(result.status, "completed", result.reason);
  const decision = result.decisions[0];
  assert.equal(decision.informationCutoff, decision.decisionDate);
  assert.equal(decision.decisionDate, dateAt(50));
  assert.equal(decision.executionDate, dateAt(51));
  assert.ok(decision.estimationDates.every((date) => date <= decision.decisionDate));
  const fill = result.dailyLedger.find((entry) => entry.date === decision.executionDate)!;
  assert.ok(fill.externalTrades.length > 0);
  const columns = snapshot.dataset.csvContent.split(/\r?\n/)[0].split(",");
  const csvRow = snapshot.dataset.csvContent.split(/\r?\n/).find((line) =>
    line.startsWith(`${fill.date},`))!.split(",");
  for (const trade of fill.externalTrades) {
    const closePrice = Number(csvRow[columns.indexOf(trade.ticker)]);
    close(trade.notional, trade.quantity * closePrice * 0.9);
  }
  close(fill.beginningPositions.length, 0);
  close(fill.cashPnl, fill.beginningCash * result.assumptions.dailyCashYield);
  close(fill.assetPnl, fill.externalTrades.reduce((sum, trade) => {
    const closePrice = Number(csvRow[columns.indexOf(trade.ticker)]);
    return sum + trade.quantity * (closePrice - closePrice * 0.9);
  }, 0));
  close(fill.transactionCosts, fill.externalTradedNotional * 10 / 10000);
  close(fill.slippage, fill.externalTradedNotional * 5 / 10000);
  close(fill.beginningNav + fill.assetPnl + fill.cashPnl - fill.transactionCosts - fill.slippage,
    fill.endingNav);
  close(fill.endingCash + fill.endingPositions.reduce((sum, position) => sum + position.marketValue, 0),
    fill.endingNav);
  assert.ok(result.diagnostics.maximumReconciliationDifference! <= result.diagnostics.reconciliationTolerance);
});

test("B3 next_open fails explicitly for absent execution opens and mismatched frozen OHLC hashes", () => {
  const source = makeSnapshot("asset_returns");
  const candidateId = source.candidates.find((candidate) => candidate.assetTickers[0] === "A")!.candidateId;
  const policy = allocationRequest(source, {
    candidateIds: [candidateId], estimationWindow: 30, minObservations: 15,
    objective: { type: "regularized_mean_variance", gamma: 2, eta: 0.1 },
    constraints: { totalCash: { min: 0, max: 0 } },
  });
  const missingOpen = withOhlc(source, { ticker: "A", index: 51 });
  const failed = runB3Validation(missingOpen, policy, missingOpen, assumptions(50, 150, {
    executionTiming: "next_open",
  }));
  assert.equal(failed.status, "failed");
  assert.match(failed.reason ?? "", /Missing or invalid adjusted open for traded asset A/);
  assert.equal(failed.failureDate, dateAt(51));

  const invalidHash = structuredClone(withOhlc(source));
  invalidHash.dataset.ohlcCsvContent += "\n";
  const integrityFailure = runB3Validation(invalidHash, policy, invalidHash, assumptions(50, 150, {
    executionTiming: "next_open",
  }));
  assert.equal(integrityFailure.status, "failed");
  assert.match(integrityFailure.reason ?? "", /adjusted OHLC dataset integrity failure/);
});

test("B3 T5 charges costs once on consolidated underlying turnover and reports external fills", () => {
  const snapshot = makeSnapshot("asset_returns");
  const policy = allocationRequest(snapshot);
  const result = runB3Validation(snapshot, policy, snapshot, assumptions(50, 150, {
    transactionCostBps: 10, slippageBps: 5,
  }));
  assert.equal(result.status, "completed", result.reason);
  assert.ok(result.metrics!.totalTransactionCosts > 0);
  assert.ok(result.metrics!.totalSlippage > 0);
  assert.ok(result.metrics!.externalTradedNotional > 0);
  for (const entry of result.dailyLedger) {
    close(entry.beginningNav + entry.assetPnl + entry.cashPnl -
      entry.transactionCosts - entry.slippage, entry.endingNav);
  }
  assert.match(result.metrics!.turnoverConvention, /half the sum of absolute changes/);
});

test("B3 T4 equivalent fully invested asset and alpha policies produce the same underlying book", () => {
  const source = csvFor();
  const assets = makeSnapshot("asset_returns", source);
  const alphas = makeSnapshot("alpha_streams", source);
  const selectedAlphaIds = alphas.candidates.filter((candidate) => candidate.factorId === "b3_factor_0")
    .map((candidate) => candidate.candidateId);
  const assetPolicy = allocationRequest(assets, { estimationWindow: 30, minObservations: 30 });
  const alphaPolicy = allocationRequest(alphas, {
    candidateIds: selectedAlphaIds, estimationWindow: 30, minObservations: 30,
  });
  const assetRun = runB3Validation(assets, assetPolicy, assets, assumptions(100, 150, {
    transactionCostBps: 0, slippageBps: 0,
  }));
  const alphaRun = runB3Validation(alphas, alphaPolicy, alphas, assumptions(100, 150, {
    transactionCostBps: 0, slippageBps: 0,
  }));
  assert.equal(assetRun.status, "completed", assetRun.reason);
  assert.equal(alphaRun.status, "completed", alphaRun.reason);
  assert.ok(assetRun.decisions.some((decision) => decision.targetAssetExposureSum > 0));
  assert.ok(alphaRun.decisions.some((decision) => decision.targetAssetExposureSum > 0));
  assert.equal(assetRun.dailyLedger.length, alphaRun.dailyLedger.length);
  for (let i = 0; i < assetRun.decisions.length; i++) {
    for (const ticker of tickers)
      close(assetRun.decisions[i].targetAssetWeights[ticker] ?? 0,
        alphaRun.decisions[i].targetAssetWeights[ticker] ?? 0);
  }
  for (let i = 0; i < assetRun.dailyLedger.length; i++) {
    close(assetRun.dailyLedger[i].endingNav, alphaRun.dailyLedger[i].endingNav);
    close(assetRun.dailyLedger[i].endingCash, alphaRun.dailyLedger[i].endingCash);
  }
});

test("B3 T5 opposing alpha instructions net to zero or one external trade before costs", () => {
  const snapshot = opposingAlphaSnapshot();
  const [partialId, fullId] = snapshot.candidates.map((candidate) => candidate.candidateId);
  const common = allocationRequest(snapshot, {
    estimationWindow: 30, minObservations: 15,
    candidateIds: [partialId, fullId],
    objective: { type: "regularized_mean_variance", gamma: 2, eta: 0.1 },
    constraints: {
      candidateBounds: { [partialId]: { min: 0.2, max: 0.2 } },
      totalCash: { max: 0.5 },
    },
  });
  const zeroNetPolicy: AllocationRequest = {
    ...common, constraints: { ...common.constraints, assetBounds: { A: { min: 0.75, max: 0.75 } } },
  };
  const zeroNet = runB3Validation(snapshot, zeroNetPolicy, snapshot, assumptions(65, 120, {
    dailyCashYield: 0, transactionCostBps: 10, slippageBps: 5,
  }));
  assert.equal(zeroNet.status, "completed", zeroNet.reason);
  assert.ok(zeroNet.decisions.length >= 2);
  const [first, second] = zeroNet.decisions;
  const partialDelta = second.candidateAssetContributions[partialId].A -
    first.candidateAssetContributions[partialId].A;
  const fullDelta = second.candidateAssetContributions[fullId].A -
    first.candidateAssetContributions[fullId].A;
  assert.ok(partialDelta < 0 && fullDelta > 0,
    `expected opposing alpha instructions, got deltas ${partialDelta} and ${fullDelta}`);
  close(partialDelta + fullDelta, 0);
  close(second.targetAssetWeights.A, first.targetAssetWeights.A);
  const zeroExecution = zeroNet.dailyLedger.find((entry) => entry.date === second.executionDate)!;
  close(zeroExecution.externalTradedNotional, 0);
  close(zeroExecution.transactionCosts, 0);
  close(zeroExecution.slippage, 0);
  close(second.targetAssetWeights.A + second.totalCash, 1);
  const zeroReconciliationMaximum = Math.max(...zeroNet.dailyLedger.map((entry) =>
    Math.abs(entry.reconciliationDifference)));
  close(zeroNet.diagnostics.maximumReconciliationDifference!, zeroReconciliationMaximum);
  assert.ok(zeroReconciliationMaximum <= zeroNet.diagnostics.reconciliationTolerance);

  const nonzeroPolicy: AllocationRequest = {
    ...common,
    constraints: {
      ...common.constraints,
      candidateBounds: {
        [partialId]: { min: 0.2, max: 0.2 },
        [fullId]: { min: 0.6, max: 0.6 },
      },
    },
  };
  const nonzero = runB3Validation(snapshot, nonzeroPolicy, snapshot, assumptions(65, 120, {
    dailyCashYield: 0, transactionCostBps: 10, slippageBps: 5,
  }));
  assert.equal(nonzero.status, "completed", nonzero.reason);
  const [nonzeroFirst, nonzeroSecond] = nonzero.decisions;
  const aggregateDelta = nonzeroSecond.targetAssetWeights.A - nonzeroFirst.targetAssetWeights.A;
  close(aggregateDelta, -0.1);
  const execution = nonzero.dailyLedger.find((entry) => entry.date === nonzeroSecond.executionDate)!;
  assert.ok(execution.externalTradedNotional > 0);
  assert.equal(execution.externalTrades.length, 1);
  assert.equal(execution.externalTrades[0].ticker, "A");
  assert.ok(execution.externalTrades[0].notional < 0);
  const preTradeNav = execution.beginningNav + execution.assetPnl + execution.cashPnl;
  const consolidatedTurnover = Math.abs(aggregateDelta) / 2;
  close(execution.transactionCosts, preTradeNav * consolidatedTurnover * 10 / 10000);
  close(execution.slippage, preTradeNav * consolidatedTurnover * 5 / 10000);
  close(execution.beginningNav + execution.assetPnl + execution.cashPnl -
    execution.transactionCosts - execution.slippage, execution.endingNav);
  close(execution.endingCash / execution.endingNav, 0.4);
  close(nonzeroSecond.targetAssetWeights.A + nonzeroSecond.totalCash, 1);
  const nonzeroReconciliationMaximum = Math.max(...nonzero.dailyLedger.map((entry) =>
    Math.abs(entry.reconciliationDifference)));
  close(nonzero.diagnostics.maximumReconciliationDifference!, nonzeroReconciliationMaximum);
  assert.ok(nonzeroReconciliationMaximum <= nonzero.diagnostics.reconciliationTolerance);
});

test("B3 T6 reports historically infeasible constraints with a dated failure", () => {
  const snapshot = makeSnapshot("asset_returns");
  const firstCandidate = snapshot.candidates[0].candidateId;
  const secondCandidate = snapshot.candidates[1].candidateId;
  const policy = allocationRequest(snapshot, {
    constraints: { candidateBounds: {
      [firstCandidate]: { min: 0.8 }, [secondCandidate]: { min: 0.8 },
    } },
  });
  const result = runB3Validation(snapshot, policy, snapshot, assumptions());
  assert.equal(result.status, "failed");
  assert.ok(result.decisionCalendar.some((entry) => entry.decisionDate === result.failureDate));
  assert.match(result.reason ?? "", /B2 INFEASIBLE/);
  assert.deepEqual(result.dailyLedger, []);
});

test("B3 T6 reports a genuine B2 numerical solver failure without a substitute portfolio", () => {
  const snapshot = makeSnapshot("asset_returns");
  const policy = allocationRequest(snapshot, {
    dailyCashYield: 1e4, objective: { type: "regularized_mean_variance", gamma: 2, eta: 0 },
  });
  const result = runB3Validation(snapshot, policy, snapshot, assumptions());
  assert.equal(result.status, "failed");
  assert.ok(result.decisionCalendar.some((entry) => entry.decisionDate === result.failureDate));
  assert.match(result.reason ?? "", /B2 NUMERICAL_FAILURE/);
  assert.deepEqual(result.dailyLedger, []);
  assert.equal(result.metrics, null);
});

test("B3 T6 reports a later missing held-asset price on its actual date", () => {
  const snapshot = makeSnapshot("asset_returns", csvFor(180, { ticker: "A", index: 115 }));
  const candidateId = snapshot.candidates.find((candidate) => candidate.assetTickers[0] === "A")!.candidateId;
  const policy = allocationRequest(snapshot, {
    candidateIds: [candidateId], constraints: { totalCash: { min: 0, max: 0 } },
  });
  const result = runB3Validation(snapshot, policy, snapshot, assumptions(50, 150));
  assert.equal(result.status, "failed");
  assert.equal(result.failureDate, dateAt(115), result.reason);
  assert.match(result.reason ?? "", /A is missing held-period price observations on/);
});

test("B3 T7 five assets and thirty B1 streams execute positive-risk books; all-cash control is cash-only", () => {
  const csv = csvFor();
  const assets = makeSnapshot("asset_returns", csv);
  const alpha = makeSnapshot("alpha_streams", csv);
  const assetResult = runB3Validation(assets, allocationRequest(assets), assets, assumptions(60, 150));
  const alphaResult = runB3Validation(alpha, allocationRequest(alpha), alpha, assumptions(60, 150));
  for (const result of [assetResult, alphaResult]) {
    assert.equal(result.status, "completed", result.reason);
    assert.ok(result.decisions.length >= 2);
    assert.ok(result.decisions.some((decision) => decision.targetAssetExposureSum > 0));
    assert.ok(result.dailyLedger.some((entry) => entry.externalTradedNotional > 0));
    assert.ok(result.decisions.every((decision) =>
      (decision.optimizer.solver.maxConstraintViolation ?? Infinity) <= 1e-8));
  }
  assert.equal(alphaResult.policyIdentity.candidateIds.length, 30);
  assert.ok(alphaResult.decisions.every((decision) => decision.validationCandidateIds.length === 30));

  const allCash = runB3Validation(assets, allocationRequest(assets, {
    constraints: { totalCash: { min: 1, max: 1 } },
  }), assets, assumptions(60, 100));
  assert.equal(allCash.status, "completed", allCash.reason);
  assert.ok(allCash.dailyLedger.every((entry) => entry.endingPositions.length === 0));
  assert.equal(allCash.metrics!.annualizedVolatility, null);
  assert.match(allCash.metrics!.volatilityReason ?? "", /zero/);
  assert.equal(allCash.metrics!.sharpe, null);
  assert.match(allCash.metrics!.sharpeReason ?? "", /zero/);
  for (const entry of allCash.dailyLedger) close(entry.dailyNetReturn, 0.0001, 1e-12);
});

test("B3 preserves policy IDs while resolving dataset-dependent validation IDs one-to-one", () => {
  const policySnapshot = makeSnapshot("asset_returns", csvFor());
  const changed = csvFor().replace("100.17000000", "101.17000000");
  const validationSnapshot = makeSnapshot("asset_returns", changed);
  const policy = allocationRequest(policySnapshot);
  const result = runB3Validation(policySnapshot, policy, validationSnapshot, assumptions());
  assert.equal(result.status, "completed", result.reason);
  for (const policyId of policy.candidateIds) {
    const validationId = result.policyIdentity.validationCandidateIds[policyId];
    assert.ok(validationId);
    assert.notEqual(validationId, policyId);
  }
  assert.deepEqual(result.decisions[0].policyCandidateIds, policy.candidateIds);
  assert.deepEqual(result.decisions[0].validationCandidateIds,
    policy.candidateIds.map((id) => result.policyIdentity.validationCandidateIds[id]));
});

test("B3 rejects alpha schedules that differ from the declared allocator calendar", () => {
  const snapshot = makeSnapshot("alpha_streams");
  const policy = allocationRequest(snapshot);
  const result = runB3Validation(snapshot, policy, snapshot, assumptions(60, 150, {
    decisionCalendar: "quarterly",
  }));
  assert.equal(result.status, "failed");
  assert.equal(result.failureDate, dateAt(60));
  assert.match(result.reason ?? "", /schedule\/execution incompatible/);
});

test("D2 T7 signed B3 re-solves point-in-time and A1 executes consolidated shorts", () => {
  const snapshot = opposingAlphaSnapshot();
  const [positiveAlphaId, negativeAlphaId] = snapshot.candidates.map((candidate) => candidate.candidateId);
  const policy = allocationRequest(snapshot, {
    candidateIds: [positiveAlphaId, negativeAlphaId],
    allocationMode: "SIGNED_OVERLAY",
    riskModel: { type: "STATISTICAL_FACTOR", factorCount: 1, specificRiskFloorFraction: 1e-6 },
    objective: { type: "regularized_mean_variance", gamma: 2, eta: 0.1 },
    signedConstraints: {
      alphaBounds: {
        [positiveAlphaId]: { min: 0.2, max: 0.2 },
        [negativeAlphaId]: { min: -0.8, max: -0.8 },
      },
    },
    constraints: {},
  });
  const assumptionsForRun = assumptions(45, 120, {
    dailyCashYield: 0, transactionCostBps: 10, slippageBps: 5,
  });
  const result = runB3Validation(snapshot, policy, snapshot, assumptionsForRun);
  assert.equal(result.status, "completed", result.reason);
  assert.ok(result.decisions.length >= 2, "must execute at least two historical decisions");
  assert.ok(result.decisions.every((decision) => decision.candidateWeights[positiveAlphaId] > 0));
  assert.ok(result.decisions.every((decision) => decision.candidateWeights[negativeAlphaId] < 0));
  assert.ok(result.decisions.some((decision) =>
    Object.values(decision.targetAssetWeights).some((exposure) => exposure < 0)),
  "the consolidated underlying target must contain an actual short");
  assert.ok(result.decisions.every((decision) =>
    decision.optimizer.riskModel?.type === "STATISTICAL_FACTOR" &&
    decision.optimizer.riskModel.provenance.informationCutoff === decision.informationCutoff &&
    decision.optimizer.riskModel.provenance.dates.every((date) => date <= decision.informationCutoff)));

  for (const decision of result.decisions) {
    close(decision.targetAssetExposureSum + decision.totalCash, 1);
    close(decision.optimizer.signedOverlay!.cashTarget, 1 - decision.targetAssetExposureSum);
    close(Object.values(decision.candidateAssetContributions[positiveAlphaId]).reduce((a, b) => a + b, 0) +
      Object.values(decision.candidateAssetContributions[negativeAlphaId]).reduce((a, b) => a + b, 0),
    decision.targetAssetExposureSum);
  }
  const first = result.decisions[0];
  const firstExecution = result.dailyLedger.find((entry) => entry.date === first.executionDate)!;
  assert.ok(firstExecution.externalTrades.some((trade) => trade.quantity < 0),
    "short sale should increase execution cash");
  assert.equal(firstExecution.externalTrades.length, 1, "opposing alpha instructions must net by underlying asset");
  close(firstExecution.transactionCosts, firstExecution.beginningNav * 0.35 * 10 / 10000);
  close(firstExecution.slippage, firstExecution.beginningNav * 0.35 * 5 / 10000);
  close(firstExecution.externalTradedNotional,
    firstExecution.externalTrades.reduce((sum, trade) => sum + Math.abs(trade.notional), 0));
  const laterExecutions = result.decisions.slice(1).map((decision) =>
    result.dailyLedger.find((entry) => entry.date === decision.executionDate)!);
  assert.ok(laterExecutions.some((entry) => entry.externalTrades.some((trade) => trade.quantity > 0)),
    "later rebalance must cover part of the short");
  const sourceRows = snapshot.dataset.csvContent.trimEnd().split(/\r?\n/);
  for (const [index, execution] of laterExecutions.entries()) {
    const decision = result.decisions[index + 1];
    const executionPrice = Number(sourceRows.find((line) => line.slice(0, 10) === execution.date)!.split(",")[1]);
    const preTradeNav = execution.beginningNav + execution.assetPnl + execution.cashPnl;
    const currentWeight = (execution.beginningPositions.find((position) => position.ticker === "A")?.quantity ?? 0) *
      executionPrice / preTradeNav;
    const targetWeight = decision.targetAssetWeights.A ?? 0;
    const turnover = Math.abs(targetWeight - currentWeight) / 2;
    close(execution.transactionCosts, preTradeNav * turnover * 10 / 10000);
    close(execution.slippage, preTradeNav * turnover * 5 / 10000);
    assert.equal(execution.externalTrades.length, 1);
  }
  assert.ok(result.diagnostics.limitations.some((limitation) =>
    limitation.includes("Borrow and financing frictions beyond the declared cash/cost model are not modeled.")));

  for (const entry of result.dailyLedger) {
    close(entry.beginningNav + entry.assetPnl + entry.cashPnl -
      entry.transactionCosts - entry.slippage, entry.endingNav);
    close(entry.endingCash + entry.endingPositions.reduce((sum, position) => sum + position.marketValue, 0),
      entry.endingNav);
    if (!result.decisionCalendar.some((decision) => decision.executionDate === entry.date)) {
      const prior = result.dailyLedger[result.dailyLedger.indexOf(entry) - 1];
      if (prior)
        assert.deepEqual(entry.endingPositions.map(({ ticker, quantity }) => ({ ticker, quantity })),
          prior.endingPositions.map(({ ticker, quantity }) => ({ ticker, quantity })));
    }
  }
  for (const decision of result.decisions) {
    const aligned = decision.optimizer.model!.dates;
    assert.deepEqual(decision.estimationDates, aligned);
    assert.ok(aligned.every((date) => date <= decision.informationCutoff));
  }

  const replay = runB3Validation(snapshot, structuredClone(policy), snapshot, structuredClone(assumptionsForRun));
  assert.deepEqual(replay, result, replay.reason);

  const cutoff = result.decisions[0].informationCutoff;
  const mutatedCsv = snapshot.dataset.csvContent.split("\n").map((line, index) => {
    if (index === 0 || line.slice(0, 10) <= cutoff) return line;
    const [date, price] = line.split(",");
    return `${date},${(Number(price) * 1.7).toFixed(10)}`;
  }).join("\n");
  const mutatedValidation = prepareSnapshot({
    request: structuredClone(snapshot.request), csvContent: mutatedCsv,
    factorVersion: snapshot.factorSet.version, factors: snapshot.factorSet.factors,
    datasetId: snapshot.dataset.id ?? undefined,
  });
  const firstEnd = snapshot.dataset.csvContent.split(/\r?\n/).slice(1)
    .map((line) => line.slice(0, 10)).filter((date) => date > first.executionDate)[1];
  assert.ok(firstEnd);
  const changed = runB3Validation(snapshot, policy, mutatedValidation,
    { ...assumptionsForRun, evaluationEndDate: firstEnd });
  const oneDecisionBaseline = runB3Validation(snapshot, policy, snapshot,
    { ...assumptionsForRun, evaluationEndDate: firstEnd });
  assert.equal(changed.status, "completed", changed.reason);
  assert.equal(oneDecisionBaseline.status, "completed", oneDecisionBaseline.reason);
  const decisionInputsAndSolution = (decision: (typeof changed.decisions)[number]) => ({
    decisionDate: decision.decisionDate,
    informationCutoff: decision.informationCutoff,
    estimationDates: decision.estimationDates,
    candidateWeights: decision.candidateWeights,
    targetAssetWeights: decision.targetAssetWeights,
    mu: decision.optimizer.model!.mu,
    sigma: decision.optimizer.model!.sigma,
    H: decision.optimizer.model!.H,
    factorRiskCovariance: decision.optimizer.riskModel!.covariance,
  });
  assert.deepEqual(decisionInputsAndSolution(changed.decisions[0]),
    decisionInputsAndSolution(oneDecisionBaseline.decisions[0]),
    "future-price mutation must not alter the first point-in-time solve");
});