import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import type { AllocationRequest } from "./allocation-b2";
import { optimizePreparedSnapshot } from "./allocation-b2";
import {
  generateRebalanceDates, parseCsv,
} from "./calculator";
import { runB3Validation, type B3Assumptions } from "./b3-policy";
import type { FactorDefinition } from "./factor-library";
import {
  fingerprint, prepareSnapshot, type PreparedSnapshot,
} from "./prepared-inputs";

const shouldSeed = process.env.D5_SIMPLE_SEED_T6 === "1";
let databasePool: (typeof import("@workspace/db"))["pool"] | undefined;

after(async () => {
  if (databasePool) await databasePool.end();
});

const dateAt = (index: number) => new Date(Date.UTC(2022, 0, 1 + index)).toISOString().slice(0, 10);
const observationCount = 360;
const cutoffIndex = 239;
const evaluationStartIndex = 240;
const evaluationEndIndex = 329;
const alphaTickers = ["D5A", "D5B", "D5C", "D5D", "D5E", "D5F", "D5G", "D5H"];
const assetTickers = [...alphaTickers, "D5M1", "D5M2"];

const factor: FactorDefinition = {
  id: "d5-simple-t6-momentum",
  name: "D5 Simple T6 deterministic momentum",
  description: "Self-contained deterministic test factor for the D5 Simple fixture.",
  family: "Test",
  enabled: true,
  status: "active",
  inputSeries: "adjusted close",
  calculationType: "momentum",
  formula: "P(t-lag)/P(t-lag-lookback)-1",
  direction: "higher_is_better",
  lookback: 5,
  lag: 0,
  normalization: "percentile_rank",
  winsorizationLower: 0,
  winsorizationUpper: 1,
  missingDataTreatment: "exclude",
  baseWeight: 1,
  regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 },
  activeRegimes: ["risk_on", "neutral", "risk_off"],
  dataSource: "D5 Simple T6 synthetic test prices",
  benchmarkTicker: null,
  currentCoverage: 1,
  availabilityReason: null,
  version: "d5-simple-t6-fixture-v1",
};

function commonReturn(index: number): number {
  return 0.0012 + 0.002 * Math.sin(index * 0.17) + 0.001 * Math.cos(index * 0.071);
}

function idiosyncraticReturn(index: number, offset: number): number {
  return 0.0018 * Math.sin(index * (0.21 + offset * 0.013) + offset) +
    0.0011 * Math.cos(index * (0.33 + offset * 0.009) + offset * 0.37);
}

function priceCsv(): string {
  const rows = [`date,${assetTickers.join(",")}`];
  const prices = Object.fromEntries(assetTickers.map((ticker) => [ticker, 100])) as Record<string, number>;
  for (let index = 0; index < observationCount; index++) {
    if (index > 0) {
      const market = commonReturn(index);
      for (let i = 0; i < alphaTickers.length; i++) {
        const trend = i < 4 ? 0.00025 : -0.00005;
        prices[alphaTickers[i]] *= 1 + market * (0.35 + (i % 3) * 0.08) +
          idiosyncraticReturn(index, i + 1) + trend;
      }
      prices.D5M1 *= 1 + market + idiosyncraticReturn(index, 11) * 0.35;
      prices.D5M2 *= 1 + market * 0.7 + idiosyncraticReturn(index, 17) * 0.45;
    }
    rows.push(`${dateAt(index)},${assetTickers.map((ticker) => prices[ticker].toFixed(10)).join(",")}`);
  }
  return rows.join("\n");
}

const alphaDefinitions = alphaTickers.map((ticker, index) => ({
  name: `D5 Simple T6 mapped alpha ${String.fromCharCode(65 + index)}`,
  factorId: factor.id,
  assetTickers: [ticker],
  mapping: "single_asset_long_cash" as const,
  signalUnits: "oriented" as const,
  threshold: -1,
  grossFraction: 0.7,
  rebalanceFrequency: "monthly" as const,
  executionTiming: "next_close" as const,
  transactionCostBps: 0,
  slippageBps: 0,
  cashYieldAnnual: 0,
}));

function prepareAlphaSnapshot(csvContent: string, cutoffDate?: string): PreparedSnapshot {
  return prepareSnapshot({
    request: {
      representation: "alpha_streams",
      assetTickers,
      factorIds: [],
      alphaDefinitions: structuredClone(alphaDefinitions),
      ...(cutoffDate ? { cutoffDate } : {}),
    },
    csvContent,
    factorVersion: factor.version,
    factors: [factor],
  });
}

function prepareAssetReturnSnapshot(csvContent: string): PreparedSnapshot {
  return prepareSnapshot({
    request: { representation: "asset_returns", assetTickers, factorIds: [], alphaDefinitions: [] },
    csvContent,
    factorVersion: factor.version,
    factors: [factor],
  });
}

function snapshotFingerprint(snapshot: PreparedSnapshot): string {
  return fingerprint({
    request: snapshot.request,
    datasetHash: snapshot.dataset.sha256,
    factorVersion: snapshot.factorSet.version,
    engineVersion: snapshot.engineVersion,
  });
}

function alphaPolicyRequest(snapshot: PreparedSnapshot): AllocationRequest {
  const candidateIds = snapshot.candidates.map((candidate) => candidate.candidateId);
  const signedConstraints = {
    alphaBounds: Object.fromEntries(candidateIds.map((id, i) => [
      id, { min: i % 2 === 0 ? 0.12 : -0.04, max: i % 2 === 0 ? 0.12 : -0.04 },
    ])),
    grossAlphaMax: 0.8,
    grossAssetMax: 0.8,
    netAssetExposure: { min: 0.2, max: 0.8 },
    cash: { min: 0.2, max: 0.8 },
  };
  return {
    preparedInputId: 1,
    candidateIds,
    informationCutoff: dateAt(cutoffIndex),
    decisionTimestamp: dateAt(cutoffIndex),
    estimationWindow: 120,
    minObservations: 60,
    representation: "alpha_streams",
    returnConvention: "daily_decimal",
    expectedReturnShrinkage: 0,
    covarianceDiagonalShrinkage: 0,
    allocationMode: "SIGNED_OVERLAY",
    signedConstraints,
    riskModel: { type: "STATISTICAL_FACTOR", factorCount: 2, specificRiskFloorFraction: 0.05 },
    forecastModel: { type: "SAMPLE_MEAN" },
    robustness: { method: "ROBUST_MEAN_UNCERTAINTY", kappa: 0.5 },
    dailyCashYield: 0,
    objective: { type: "regularized_mean_variance", gamma: 1, eta: 0.1 },
    constraints: {},
  };
}

function b3Assumptions(startIndex: number, endIndex: number): B3Assumptions {
  return {
    evaluationStartDate: dateAt(startIndex),
    evaluationEndDate: dateAt(endIndex),
    decisionCalendar: "monthly",
    executionTiming: "next_close",
    initialNav: 100_000,
    initialHoldings: {},
    initialCash: 100_000,
    transactionCostBps: 0,
    slippageBps: 0,
    dailyCashYield: 0,
  };
}

function rebalanceRequest(snapshot: PreparedSnapshot, cutoff: string): AllocationRequest {
  const candidates = snapshot.candidates;
  const ids = candidates.map((candidate) => candidate.candidateId);
  const cutoffRow = parseCsv(snapshot.dataset.csvContent).find((row) => row.date === cutoff);
  assert.ok(cutoffRow, `regularization source needs the exact cutoff ${cutoff}`);
  const heldQuantity = 100;
  const nav = 100_000;
  return {
    preparedInputId: 1,
    candidateIds: ids,
    informationCutoff: cutoff,
    decisionTimestamp: cutoff,
    estimationWindow: 100,
    minObservations: 40,
    representation: "asset_returns",
    returnConvention: "daily_decimal",
    expectedReturnShrinkage: 0,
    covarianceDiagonalShrinkage: 0.25,
    rebalanceRegularization: {
      lambdaR: 0.01,
      holdings: {
        asOf: cutoff,
        quantities: { [assetTickers[0]]: heldQuantity },
        cash: nav - heldQuantity * cutoffRow.prices[assetTickers[0]],
        nav,
      },
    },
    dailyCashYield: 0,
    objective: { type: "regularized_mean_variance", gamma: 1, eta: 0.5 },
    constraints: { totalCash: { min: 0, max: 0.8 } },
  };
}

test("D5 Simple T6 fixture source, exact cutoff prices, and monthly calendar are independently reproducible", () => {
  const firstCsv = priceCsv();
  const secondCsv = priceCsv();
  assert.equal(firstCsv, secondCsv, "synthetic test prices must be deterministic");
  const snapshot = prepareAlphaSnapshot(firstCsv, dateAt(cutoffIndex));
  const rows = parseCsv(snapshot.dataset.csvContent);
  assert.equal(snapshot.dataset.csvContent, firstCsv, "prepared B1 must retain the exact deterministic CSV source");
  assert.equal(snapshot.dataset.endDate, dateAt(cutoffIndex));
  assert.deepEqual(snapshot.dataset.tickers, assetTickers);
  const cutoffPrices = rows.find((row) => row.date === dateAt(cutoffIndex))?.prices;
  assert.ok(cutoffPrices, "fixture source must contain an exact cutoff close");
  for (const ticker of assetTickers)
    assert.ok(Number.isFinite(cutoffPrices[ticker]) && cutoffPrices[ticker] > 0,
      `exact positive cutoff price is required for ${ticker}`);
  const calendar = generateRebalanceDates(rows, "monthly", 0, dateAt(evaluationStartIndex));
  const executions = calendar.map((decisionDate) => rows[rows.findIndex((row) => row.date === decisionDate) + 1]?.date)
    .filter((date): date is string => Boolean(date && date <= dateAt(evaluationEndIndex)));
  assert.ok(calendar.length >= 2, `fixture must have at least two monthly decisions; got ${calendar.join(",")}`);
  assert.ok(executions.length >= 2, `fixture must have at least two next-close executions; got ${executions.join(",")}`);
  assert.equal(snapshot.dataset.sha256, prepareAlphaSnapshot(firstCsv, dateAt(cutoffIndex)).dataset.sha256);
});

test("D5 Simple T6 mapped-alpha policy solves factor-risk robust signed-overlay B2 and B3", () => {
  const csvContent = priceCsv();
  const policy = prepareAlphaSnapshot(csvContent, dateAt(cutoffIndex));
  const validation = prepareAlphaSnapshot(csvContent);
  const policyRequest = alphaPolicyRequest(policy);
  policyRequest.preparedInputId = 0;
  assert.equal(policy.candidates.length, 8);
  assert.ok(policy.candidates.every((candidate) => candidate.status === "READY"),
    policy.candidates.map((candidate) => `${candidate.name}:${candidate.status}:${candidate.reasons.join(";")}`).join("\n"));
  assert.equal(new Set(policy.candidates.map((candidate) => candidate.candidateId)).size, 8);
  assert.equal(policyRequest.riskModel?.type, "STATISTICAL_FACTOR");
  assert.ok((policyRequest.riskModel?.factorCount ?? 8) < policyRequest.candidateIds.length,
    "statistical factor dimension F must be smaller than alpha dimension N");
  assert.equal(policyRequest.robustness?.method, "ROBUST_MEAN_UNCERTAINTY");
  assert.ok((policyRequest.robustness?.kappa ?? 0) > 0);

  const optimized = optimizePreparedSnapshot(policy, policyRequest);
  assert.equal(optimized.status, "SOLVED", optimized.reason);
  assert.equal(optimized.riskModel?.type, "STATISTICAL_FACTOR");
  assert.equal(optimized.riskModel?.factorCount, 2);
  assert.equal(optimized.robustness?.method, "ROBUST_MEAN_UNCERTAINTY");
  assert.equal(optimized.robustness?.kappa, 0.5);
  assert.ok(Object.values(optimized.assetWeights ?? {}).some((weight) => weight > 0),
    "signed overlay must retain positive risky underlying exposure");
  assert.ok((optimized.signedOverlay?.netAssetExposure ?? 0) > 0);
  assert.ok(Object.values(optimized.candidateWeights ?? {}).some((weight) => weight < 0),
    "fixture policy must exercise a signed negative alpha coefficient");

  const result = runB3Validation(
    policy, policyRequest, validation,
    b3Assumptions(evaluationStartIndex, evaluationEndIndex),
  );
  assert.equal(result.status, "completed", result.reason ?? "");
  assert.ok(result.decisions.length >= 2,
    `at least two feasible B3 executions are required; got ${result.decisions.length}`);
  assert.ok(result.decisions.every((decision) => decision.optimizer.status === "SOLVED"));
  assert.ok(result.decisions.every((decision) => Object.values(decision.targetAssetWeights).some((weight) => weight > 0)));
  assert.ok(result.decisions.every((decision) => decision.d4Policy?.kappa === 0.5));
});

test("D5 Simple T6 rebalance regularization optimizer and B3 preflight", () => {
  const csvContent = priceCsv();
  const prepared = prepareAssetReturnSnapshot(csvContent);
  const cutoff = dateAt(199);
  const request = rebalanceRequest(prepared, cutoff);
  const optimized = optimizePreparedSnapshot(prepared, request);
  assert.equal(optimized.status, "SOLVED", optimized.reason);
  assert.equal(optimized.rebalanceRegularization?.lambdaR, 0.01);
  assert.ok(Object.values(optimized.assetWeights ?? {}).some((weight) => weight > 0),
    "regularized optimization must retain a positive risky exposure");

  const b3Request = {
    ...request,
    preparedInputId: 0,
    rebalanceRegularization: { lambdaR: 0.01 },
  };
  const result = runB3Validation(
    prepared, b3Request, prepared,
    b3Assumptions(evaluationStartIndex, evaluationEndIndex),
  );
  assert.equal(result.status, "completed", result.reason ?? "");
  assert.ok(result.decisions.length >= 2,
    `rebalance regularization requires at least two feasible B3 executions; got ${result.decisions.length}`);
  assert.ok(result.decisions.every((decision) => decision.optimizer.status === "SOLVED"));
  assert.ok(result.decisions.every((decision) =>
    decision.rebalanceRegularization?.lambdaR === 0.01 &&
    Object.values(decision.targetAssetWeights).some((weight) => weight > 0)));
});

test("D5_SIMPLE_SEED_T6=1 inserts and retains two fresh immutable B1 preparations", {
  skip: !shouldSeed,
}, async () => {
  if (!process.env.DATABASE_URL)
    throw new Error("D5_SIMPLE_SEED_T6=1 requires DATABASE_URL; refusing to skip database seeding.");
  const dbModule = await import("@workspace/db");
  databasePool = dbModule.pool;
  const { db, preparedInputsTable } = dbModule;
  const csvContent = priceCsv();
  const policySnapshot = prepareAlphaSnapshot(csvContent, dateAt(cutoffIndex));
  const evaluationSnapshot = prepareAlphaSnapshot(csvContent);
  const candidateIds = policySnapshot.candidates.map((candidate) => candidate.candidateId);
  assert.equal(candidateIds.length, 8);
  assert.ok(policySnapshot.candidates.every((candidate) => candidate.status === "READY"));
  assert.ok(evaluationSnapshot.candidates.every((candidate) => candidate.status === "READY"));

  const [policyRow] = await db.insert(preparedInputsTable).values({
    representation: policySnapshot.representation,
    fingerprint: snapshotFingerprint(policySnapshot),
    snapshot: structuredClone(policySnapshot),
  }).returning();
  const [evaluationRow] = await db.insert(preparedInputsTable).values({
    representation: evaluationSnapshot.representation,
    fingerprint: snapshotFingerprint(evaluationSnapshot),
    snapshot: structuredClone(evaluationSnapshot),
  }).returning();
  assert.ok(policyRow && evaluationRow, "both new immutable prepared-input rows must be inserted");
  assert.notEqual(policyRow.id, evaluationRow.id);
  assert.equal(policyRow.representation, "alpha_streams");
  assert.equal(evaluationRow.representation, "alpha_streams");
  assert.equal(policyRow.fingerprint, snapshotFingerprint(policySnapshot));
  assert.equal(evaluationRow.fingerprint, snapshotFingerprint(evaluationSnapshot));

  const cutoffRow = parseCsv(csvContent).find((row) => row.date === dateAt(cutoffIndex));
  assert.ok(cutoffRow, "exact synthetic cutoff price row must exist");
  const descriptor = {
    namespace: `D5-SIMPLE-T6-${policyRow.id}-${evaluationRow.id}`,
    b1PolicyId: policyRow.id,
    b1EvaluationId: evaluationRow.id,
    policyCandidateIds: candidateIds,
    evaluationCandidateIds: evaluationSnapshot.candidates.map((candidate) => candidate.candidateId),
    cutoffDate: dateAt(cutoffIndex),
    evaluationStartDate: dateAt(evaluationStartIndex),
    evaluationEndDate: dateAt(evaluationEndIndex),
    cutoffAssetPrices: Object.fromEntries(assetTickers.map((ticker) => [ticker, cutoffRow.prices[ticker]])),
    assetTickers,
    alphaTickers,
    datasetHash: policySnapshot.dataset.sha256,
    evaluationDatasetHash: evaluationSnapshot.dataset.sha256,
    observationCount: observationCount,
    decisionCalendar: "monthly",
    executionTiming: "next_close",
  };
  await writeFile("/tmp/d5-simple-fixture.json", JSON.stringify(descriptor, null, 2));
  console.log(JSON.stringify(descriptor));
});