import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, preparedInputsTable, allocationsTable, c2ExperimentsTable } from "@workspace/db";
import type { C2ExperimentInput } from "@workspace/api-zod";
import { fingerprint, prepareSnapshot, type PreparedSnapshot } from "./prepared-inputs";
import { computeRegime, parseCsv } from "./calculator";
import type { FactorDefinition } from "./factor-library";
import type { AllocationRequest } from "./allocation-b2";

const shouldSeed = process.env.C3_SEED_T8 === "1" && Boolean(process.env.DATABASE_URL);
let pool: (typeof import("@workspace/db"))["pool"] | undefined;

after(async () => {
  if (pool) await pool.end();
});

const dateAt = (index: number) => new Date(Date.UTC(2020, 0, 1 + index)).toISOString().slice(0, 10);
const observationCount = 360;
const divergenceScale = 0.6;
const developmentStartIndex = 180;
const developmentEndIndex = 350;
const evaluationStartIndex = 351;
const evaluationEndIndex = 359;

const fixtureFactor: FactorDefinition = {
  id: "c3-t8-deterministic-momentum",
  name: "C3 T8 deterministic momentum",
  description: "Deterministic retained C3 acceptance fixture",
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
  dataSource: "C3 deterministic fixture prices",
  benchmarkTicker: null,
  currentCoverage: 1,
  availabilityReason: null,
  version: "c3-t8-fixture-v1",
};

const alphaSpecifications = [
  { key: "A", ticker: "TA", grossFraction: 0.9, difference: 0 },
  { key: "B", ticker: "TA", grossFraction: 0.92, difference: 0 },
  { key: "C", ticker: "TC", grossFraction: 0.9, difference: 1 },
  { key: "D", ticker: "TD", grossFraction: 0.9, difference: 2 },
  { key: "E", ticker: "TE", grossFraction: 0.9, difference: 3 },
  { key: "F", ticker: "TF", grossFraction: 0.9, difference: 4 },
  { key: "G", ticker: "TG", grossFraction: 0.9, difference: 5 },
  { key: "H", ticker: "TH", grossFraction: 0.9, difference: 6 },
] as const;

const macroTickers = ["M1", "M2", "M3", "M4"];
const assetTickers = [...macroTickers, ...alphaSpecifications.map((item) => item.ticker)];

function marketReturn(index: number): number {
  if (index < 280) return 0.002 + 0.0008 * Math.sin(index * 0.17);
  if (index < 335) return -0.005 + 0.0006 * Math.sin(index * 0.21);
  return 0.003 + 0.0007 * Math.sin(index * 0.19);
}

function pairCommonReturn(index: number): number {
  return 0.0015 * Math.sin(index * 0.37) + 0.0012 * Math.cos(index * 0.13);
}

function divergentShock(index: number): number {
  return 0.0018 * Math.sin(index * 1.73) + 0.0011 * Math.cos(index * 1.17);
}

function standaloneNoise(index: number, offset: number): number {
  return 0.004 * Math.sin(index * (0.17 + offset * 0.031) + offset) +
    0.0025 * Math.cos(index * (0.29 + offset * 0.013) + offset * 0.41);
}

function priceRows(): string {
  const rows = [`date,${assetTickers.join(",")}`];
  const prices = Object.fromEntries(assetTickers.map((ticker) => [ticker, 100]));
  for (let index = 0; index < observationCount; index++) {
    if (index > 0) {
      const market = marketReturn(index);
      for (const ticker of macroTickers)
        prices[ticker] *= 1 + market + standaloneNoise(index, macroTickers.indexOf(ticker) + 10) * 0.05;
      for (const spec of alphaSpecifications) {
        let dailyReturn: number;
        if (spec.key === "A" || spec.key === "B") {
          dailyReturn = market * 0.15 + pairCommonReturn(index);
        } else if (spec.key === "C" || spec.key === "D") {
          const divergent = index >= 312
            ? (spec.key === "C" ? 1 : -1) * divergenceScale * divergentShock(index)
            : 0;
          dailyReturn = market * 0.15 + pairCommonReturn(index) + divergent;
        } else {
          dailyReturn = market * 0.1 + standaloneNoise(index, spec.difference);
        }
        prices[spec.ticker] *= 1 + dailyReturn;
      }
    }
    rows.push(`${dateAt(index)},${assetTickers.map((ticker) => prices[ticker].toFixed(10)).join(",")}`);
  }
  return rows.join("\n");
}

function makeSnapshot(csvContent: string): PreparedSnapshot {
  return prepareSnapshot({
    request: {
      representation: "alpha_streams",
      assetTickers,
      factorIds: [],
      alphaDefinitions: alphaSpecifications.map((spec) => ({
        name: `C3 T8 Alpha ${spec.key}`,
        factorId: fixtureFactor.id,
        assetTickers: [spec.ticker],
        mapping: "single_asset_long_cash" as const,
        signalUnits: "oriented" as const,
        threshold: -100,
        grossFraction: spec.grossFraction,
        rebalanceFrequency: "monthly" as const,
        executionTiming: "next_close" as const,
        transactionCostBps: 0,
        slippageBps: 0,
        cashYieldAnnual: 0,
      })),
    },
    csvContent,
    factorVersion: fixtureFactor.version,
    factors: [fixtureFactor],
  });
}

function preparedFingerprint(snapshot: PreparedSnapshot): string {
  return fingerprint({
    request: snapshot.request,
    datasetHash: snapshot.dataset.sha256,
    factorVersion: snapshot.factorSet.version,
    engineVersion: snapshot.engineVersion,
  });
}

function fixtureAssumptions(startDate: string, endDate: string) {
  return {
    evaluationStartDate: startDate,
    evaluationEndDate: endDate,
    decisionCalendar: "monthly" as const,
    executionTiming: "next_close" as const,
    initialNav: 1,
    initialHoldings: {},
    initialCash: 1,
    transactionCostBps: 0,
    slippageBps: 0,
    dailyCashYield: 0.0001,
  };
}

test("C3 T8 retained eight-alpha B1/B2/C2 verification fixture (C3_SEED_T8=1)", {
  skip: !shouldSeed,
}, async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  const { hashDataset } = await import("./run-snapshot");
  const csvContent = priceRows();
  const snapshot = makeSnapshot(csvContent);
  const alphaIds = snapshot.candidates.map((candidate) => candidate.candidateId);
  assert.equal(alphaIds.length, 8);
  assert.equal(new Set(alphaIds).size, 8);
  assert.deepEqual(snapshot.candidates.map((candidate) => candidate.status), Array(8).fill("READY"));
  assert.equal(snapshot.dataset.sha256, hashDataset(csvContent));

  let priorFixture: Record<string, any> | undefined;
  try {
    priorFixture = JSON.parse(await readFile("/tmp/c3-t8-fixture.json", "utf8"));
  } catch {
    priorFixture = undefined;
  }
  if (!priorFixture?.b1PolicyId || !priorFixture?.b1EvaluationId)
    throw new Error("Expected the retained C3 T8 B1 fixture descriptor at /tmp/c3-t8-fixture.json.");
  const snapshotFingerprint = preparedFingerprint(snapshot);
  const matchingB1Rows = await db.select().from(preparedInputsTable)
    .where(eq(preparedInputsTable.fingerprint, snapshotFingerprint));
  const [priorPolicyRow] = await db.select().from(preparedInputsTable)
    .where(eq(preparedInputsTable.id, priorFixture.b1PolicyId)).limit(1);
  const [priorValidationRow] = await db.select().from(preparedInputsTable)
    .where(eq(preparedInputsTable.id, priorFixture.b1EvaluationId)).limit(1);
  let policyRow = matchingB1Rows.find((row) => row.id === priorPolicyRow?.id) ?? matchingB1Rows[0];
  if (!policyRow) {
    [policyRow] = await db.insert(preparedInputsTable).values({
      representation: snapshot.representation,
      fingerprint: snapshotFingerprint,
      snapshot: structuredClone(snapshot),
    }).returning();
  }
  let validationRow = matchingB1Rows.find((row) =>
    row.id !== policyRow?.id && row.id === priorValidationRow?.id) ??
    matchingB1Rows.find((row) => row.id !== policyRow?.id);
  if (!validationRow) {
    [validationRow] = await db.insert(preparedInputsTable).values({
      representation: snapshot.representation,
      fingerprint: snapshotFingerprint,
      snapshot: structuredClone(snapshot),
    }).returning();
  }
  assert.ok(policyRow, "Could not persist the new immutable B1 policy preparation.");
  assert.ok(validationRow, "Could not persist the new immutable B1 evaluation preparation.");
  assert.equal(policyRow.fingerprint, snapshotFingerprint);
  assert.equal(validationRow.fingerprint, snapshotFingerprint);
  if (priorFixture.divergenceScale !== divergenceScale) {
    assert.notEqual(policyRow.id, priorFixture.b1PolicyId, "The strengthened shock must use a new immutable B1 policy preparation.");
    assert.notEqual(validationRow.id, priorFixture.b1EvaluationId, "The strengthened shock must use a new immutable B1 evaluation preparation.");
  }
  assert.deepEqual((policyRow.snapshot as any).candidates.map((candidate: any) => candidate.candidateId), alphaIds);
  assert.deepEqual((validationRow.snapshot as any).candidates.map((candidate: any) => candidate.candidateId), alphaIds);

  const developmentStartDate = dateAt(developmentStartIndex);
  const developmentEndDate = dateAt(developmentEndIndex);
  const evaluationStartDate = dateAt(evaluationStartIndex);
  const evaluationEndDate = dateAt(evaluationEndIndex);
  assert.ok(developmentEndDate < evaluationStartDate);
  const startDate = developmentStartDate;
  const endDate = developmentEndDate;
  const regimeMapping = {
    "Risk-On": "riskOn",
    Constructive: "riskOn",
    Neutral: "riskOff",
    Cautious: "riskOff",
    "Risk-Off": "riskOff",
  };
  const rawRegimes = new Set(parseCsv(csvContent)
    .filter((row) => row.date >= startDate && row.date <= endDate)
    .map((row) => computeRegime(parseCsv(csvContent).filter((prior) => prior.date < row.date), assetTickers).label));
  assert.ok(rawRegimes.size >= 2, `Fixture must contain multiple development regimes; got ${[...rawRegimes]}`);

  const robustB2BaseRequest: AllocationRequest = {
    preparedInputId: policyRow.id,
    candidateIds: [...alphaIds],
    informationCutoff: developmentEndDate,
    decisionTimestamp: developmentEndDate,
    estimationWindow: 60,
    minObservations: 25,
    representation: "alpha_streams",
    returnConvention: "daily_decimal",
    expectedReturnShrinkage: 0,
    covarianceDiagonalShrinkage: 1,
    dailyCashYield: 0.0001,
    objective: { type: "regularized_mean_variance", gamma: 1, eta: 10 },
    constraints: { totalCash: { min: 0, max: 0.5 } },
  };
  const priorAllocations = await db.select().from(allocationsTable)
    .where(eq(allocationsTable.preparedInputId, policyRow.id));
  const { optimizePreparedSnapshot } = await import("./allocation-b2");
  const { runB3Validation } = await import("./b3-policy");
  const b3Assumptions = {
    evaluationStartDate,
    evaluationEndDate,
    decisionCalendar: "monthly" as const,
    executionTiming: "next_close" as const,
    initialNav: 1,
    initialHoldings: {},
    initialCash: 1,
    transactionCostBps: 0,
    slippageBps: 0,
    dailyCashYield: 0.0001,
  };
  const regularizationStrengths = [10];
  const failedPreflights: Array<{ eta: number; b2: string; b3?: string }> = [];
  let robustB2Request: AllocationRequest | undefined;
  let allocationResult: ReturnType<typeof optimizePreparedSnapshot> | undefined;
  let keepAllPreflight: ReturnType<typeof runB3Validation> | undefined;
  let allocation = undefined as typeof allocationsTable.$inferSelect | undefined;
  for (const eta of regularizationStrengths) {
    const requestedPolicy: AllocationRequest = {
      ...robustB2BaseRequest,
      objective: { type: "regularized_mean_variance", gamma: 1, eta },
    };
    const existing = priorAllocations.find((row) =>
      fingerprint(row.frozenRequest) === fingerprint(requestedPolicy));
    const candidateResult = existing
      ? existing.frozenResult as ReturnType<typeof optimizePreparedSnapshot>
      : optimizePreparedSnapshot(policyRow.snapshot as PreparedSnapshot, requestedPolicy);
    if (candidateResult.status !== "SOLVED") {
      failedPreflights.push({ eta, b2: candidateResult.reason ?? candidateResult.status });
      continue;
    }
    const candidatePreflight = runB3Validation(
      policyRow.snapshot as PreparedSnapshot,
      requestedPolicy,
      validationRow.snapshot as PreparedSnapshot,
      b3Assumptions,
    );
    if (candidatePreflight.status !== "completed") {
      failedPreflights.push({ eta, b2: "SOLVED", b3: candidatePreflight.reason ?? "failed" });
      continue;
    }
    const alreadyVerifiedDependencies = existing?.id === priorFixture.b2Id &&
      typeof priorFixture.c2Id === "number" && priorFixture.evidenceAlphaIds?.length === alphaIds.length;
    if (!alreadyVerifiedDependencies) {
      const developmentAssumptions = {
        ...b3Assumptions,
        evaluationStartDate: developmentStartDate,
        evaluationEndDate: developmentEndDate,
      };
      const developmentPreflight = runB3Validation(
        policyRow.snapshot as PreparedSnapshot,
        requestedPolicy,
        validationRow.snapshot as PreparedSnapshot,
        developmentAssumptions,
      );
      if (developmentPreflight.status !== "completed") {
        failedPreflights.push({ eta, b2: "SOLVED", b3: `development KEEP_ALL: ${developmentPreflight.reason ?? "failed"}` });
        continue;
      }
      const failedExclusion = alphaIds.find((excludedId) => {
        const exclusionRequest: AllocationRequest = {
          ...requestedPolicy,
          candidateIds: alphaIds.filter((id) => id !== excludedId),
        };
        const exclusionPreflight = runB3Validation(
          policyRow.snapshot as PreparedSnapshot,
          exclusionRequest,
          validationRow.snapshot as PreparedSnapshot,
          developmentAssumptions,
        );
        if (exclusionPreflight.status === "completed") return false;
        failedPreflights.push({
          eta,
          b2: `SOLVED after excluding ${excludedId}`,
          b3: exclusionPreflight.reason ?? "failed",
        });
        return true;
      });
      if (failedExclusion) continue;
    }
    robustB2Request = requestedPolicy;
    allocationResult = candidateResult;
    keepAllPreflight = candidatePreflight;
    allocation = existing;
    break;
  }
  assert.ok(robustB2Request && allocationResult && keepAllPreflight,
    `No deterministic diagonal-shrinkage/regularization B2 policy passed KEEP_ALL B3 preflight: ${JSON.stringify(failedPreflights)}`);
  if (!allocation) {
    const frozenSnapshot = structuredClone(policyRow.snapshot);
    const frozenRequest = structuredClone(robustB2Request);
    const frozenResult = structuredClone(allocationResult);
    const frozenSnapshotHash = fingerprint(frozenSnapshot);
    const engineVersion = `allocation-b2-api.1; ${allocationResult.solver.name}@${allocationResult.solver.version}`;
    const allocationFingerprint = fingerprint({
      preparedInputId: policyRow.id,
      representation: policyRow.representation,
      engineVersion,
      request: frozenRequest,
      snapshotHash: frozenSnapshotHash,
      result: frozenResult,
    });
    [allocation] = await db.insert(allocationsTable).values({
      preparedInputId: policyRow.id,
      representation: policyRow.representation,
      fingerprint: allocationFingerprint,
      frozenSnapshotHash,
      engineVersion,
      frozenRequest,
      frozenSnapshot,
      frozenResult,
    }).returning();
  }
  assert.ok(allocation, "Could not persist the immutable robust B2 allocation.");
  assert.equal((allocation.frozenResult as any).status, "SOLVED");
  assert.equal(fingerprint(allocation.frozenSnapshot), fingerprint(policyRow.snapshot));
  assert.equal((allocation.frozenRequest as any).covarianceDiagonalShrinkage, 1);
  if (priorFixture.divergenceScale !== divergenceScale)
    assert.notEqual(allocation.id, priorFixture.b2Id,
      "The strengthened shock must use a new immutable B2 allocation, leaving the prior B2 untouched.");
  assert.equal(keepAllPreflight.status, "completed",
    `Real B3 KEEP_ALL preflight must complete on evaluation #${validationRow.id}: ${keepAllPreflight.reason ?? "unknown failure"}`);

  const input: C2ExperimentInput = {
    allocationId: allocation.id,
    validationPreparedInputId: validationRow.id,
    c1ExperimentId: null,
    assumptions: fixtureAssumptions(startDate, endDate),
    alphaIds,
    startDate,
    endDate,
    regimeSource: "frozen_b1_prefix",
    regimeMapping,
    rollingWindow: 20,
    rollingStep: 10,
    contributionWindow: 20,
    contributionStep: 10,
    minRollingPaired: 8,
    minRegimePaired: 2,
    minSharpeObservations: 10,
    highCorrelationThreshold: 0.8,
    materialCorrelationGap: 0.25,
  };

  const { getC2Experiment, persistC2Experiment, replayC2Experiment } = await import("./c2-experiment-store");
  const priorC2Rows = await db.select().from(c2ExperimentsTable)
    .where(eq(c2ExperimentsTable.allocationId, allocation.id));
  const priorEightAlphaRow = priorC2Rows.reverse().find((row) => {
    const manifestInput = (row.manifestJson as any)?.input;
    return row.validationPreparedInputId === validationRow.id &&
      Array.isArray(manifestInput?.alphaIds) &&
      manifestInput.alphaIds.length === alphaIds.length &&
      manifestInput.startDate === input.startDate &&
      manifestInput.endDate === input.endDate &&
      alphaIds.every((id) => manifestInput.alphaIds.includes(id));
  });
  if (!priorEightAlphaRow) {
    const { persistC1Experiment, replayC1Experiment } = await import("./c1-experiment-store");
    for (const batch of [alphaIds.slice(0, 5), alphaIds.slice(5)]) {
      const savedC1 = await persistC1Experiment({
        allocationId: allocation.id,
        validationPreparedInputId: validationRow.id,
        assumptions: fixtureAssumptions(startDate, endDate),
        mode: "single",
        exclusionSets: batch.map((alphaId) => [alphaId]),
      });
      if (!("experiment" in savedC1) || !savedC1.experiment ||
          savedC1.experiment.status !== "completed")
        throw new Error("Could not persist the real C1 B3 dependency batch: " +
          ("error" in savedC1 ? savedC1.error : JSON.stringify(savedC1)));
      const c1Replay = await replayC1Experiment(savedC1.experiment.id);
      assert.equal(c1Replay?.status, "pass", c1Replay?.differences.join("\n"));
    }
  }
  const savedC2 = priorEightAlphaRow
    ? { experiment: await getC2Experiment(priorEightAlphaRow.id) }
    : await persistC2Experiment(input);
  if (!("experiment" in savedC2) || !savedC2.experiment)
    throw new Error("Could not persist real C2 development evidence: " +
      ("error" in savedC2 ? savedC2.error : "missing response"));
  assert.deepEqual((savedC2.experiment.manifest as any).input.alphaIds, alphaIds,
    "Persisted C2 manifest must cover all eight canonical alpha IDs.");
  const c2Replay = await replayC2Experiment(savedC2.experiment.id);
  assert.equal(c2Replay?.status, "pass", c2Replay?.differences.join("\n"));
  const c2Result = savedC2.experiment.result as any;
  const pairCD = c2Result.dependence?.pairs?.find((pair: any) =>
    pair.alphaA === alphaIds[2] && pair.alphaB === alphaIds[3] ||
    pair.alphaA === alphaIds[3] && pair.alphaB === alphaIds[2]);
  const pairAB = c2Result.dependence?.pairs?.find((pair: any) =>
    pair.alphaA === alphaIds[0] && pair.alphaB === alphaIds[1] ||
    pair.alphaA === alphaIds[1] && pair.alphaB === alphaIds[0]);
  assert.ok(pairAB, "C2 must persist actual A/B pairwise evidence.");
  assert.ok(pairCD, "C2 must persist actual C/D pairwise evidence.");
  assert.ok(typeof input.highCorrelationThreshold === "number" && input.highCorrelationThreshold >= 0.8,
    `C2 fixture highCorrelationThreshold must be at least 0.8; got ${input.highCorrelationThreshold}`);
  assert.ok(pairCD.fullSample.correlation >= 0.8,
    `C2 C/D full correlation must meet the declared >=0.8 high-correlation threshold; got ${pairCD.fullSample.correlation}`);
  const riskOffCorrelation = pairCD.regimeCorrelation.find((item: any) =>
    item.regime.toLowerCase().replace(/[^a-z]/g, "") === "riskoff");
  const riskOnCorrelation = pairCD.regimeCorrelation.find((item: any) =>
    item.regime.toLowerCase().replace(/[^a-z]/g, "") === "riskon");
  assert.ok(riskOnCorrelation?.correlation >= 0.8,
    `Actual C2 Risk-On C/D correlation must be at least 0.8; got ${riskOnCorrelation?.correlation}`);
  assert.ok(riskOffCorrelation &&
    pairCD.fullSample.correlation - riskOffCorrelation.correlation >= 0.25,
  `Actual C2 Risk-Off correlation must trail full C/D correlation by >=0.25; full=${pairCD.fullSample.correlation}, riskOff=${riskOffCorrelation?.correlation}`);
  assert.equal(pairCD.flag, "REGIME_DIVERGENCE_OBSERVED",
    `Actual C2 evidence must detect the intended C/D regime divergence; full=${pairCD.fullSample?.correlation}, regimes=${JSON.stringify(pairCD.regimeCorrelation)}`);

  const thresholds = {
    returnCorrelation: 0.98,
    rollingMedianCorrelation: 0.98,
    exposureSimilarity: 0.95,
    regimeCorrelation: 0.9,
    minPairedObservations: 60,
    minRollingWindows: 4,
    minRegimeObservations: 2,
    epsilon: 0.02,
  };
  const { previewC3Experiment } = await import("./c3-experiment-store");
  const preview = await previewC3Experiment({
    allocationId: allocation.id,
    validationPreparedInputId: validationRow.id,
    c2ExperimentId: savedC2.experiment.id,
    alphaIds,
    developmentStartDate,
    developmentEndDate,
    evaluationStartDate,
    evaluationEndDate,
    thresholds,
    groupCaps: {},
    manualOverrides: {},
  });
  assert.ok("plan" in preview && preview.plan,
    `C3 preview must accept an eight-alpha universe backed by the complete persisted eight-alpha C2 evidence: ${JSON.stringify(preview)}`);
  assert.ok(preview.plan.groups.length >= 1,
    `C3 preview must produce at least one complete-linkage redundancy group; pair A/B: ${JSON.stringify(pairAB)}, preview: ${JSON.stringify(preview.plan)}`);
  const expectedGroup = preview.plan.groups.find((group: any) =>
    alphaIds.slice(0, 2).every((id) => group.memberIds.includes(id)));
  assert.ok(expectedGroup, "The high-correlation same-exposure A/B pair must form a group.");
  const preservedPair = preview.plan.preservedPairs.find((pair: any) =>
    new Set([pair.alphaA, pair.alphaB]).size === 2 &&
    alphaIds.slice(2, 4).every((id) => [pair.alphaA, pair.alphaB].includes(id)));
  assert.ok(preservedPair, "C3 preview must preserve the C/D pair backed by C2 REGIME_DIVERGENCE_OBSERVED evidence.");
  const groupCaps = Object.fromEntries(preview.plan.groups.map((group: any) => [group.id, 0.1]));
  const cappedPreview = await previewC3Experiment({
    allocationId: allocation.id,
    validationPreparedInputId: validationRow.id,
    c2ExperimentId: savedC2.experiment.id,
    alphaIds,
    developmentStartDate,
    developmentEndDate,
    evaluationStartDate,
    evaluationEndDate,
    thresholds,
    groupCaps,
    manualOverrides: {},
    assumptions: b3Assumptions,
  });
  assert.ok("plan" in cappedPreview && cappedPreview.plan,
    `C3 preview must accept the declared deterministic group cap: ${JSON.stringify(cappedPreview)}`);
  assert.deepEqual(cappedPreview.plan.groups.map((group: any) => group.id), preview.plan.groups.map((group: any) => group.id));
  assert.deepEqual(cappedPreview.plan.policyRequests.GROUP_CAP.constraints.groupCaps,
    preview.plan.groups.map((group: any) => ({
      name: `c3:${group.id}`,
      candidateIds: [...group.memberIds].sort(),
      max: 0.1,
    })));

  const { getC3Experiment, persistC3Experiment, replayC3Experiment } = await import("./c3-experiment-store");
  const samePriorC3 = priorFixture.b2Id === allocation.id &&
    priorFixture.c2Id === savedC2.experiment.id &&
    priorFixture.groupCaps?.[expectedGroup.id] === 0.1 &&
    typeof priorFixture.c3Id === "number";
  let c3Experiment: any;
  let c3Replay: any;
  if (samePriorC3) {
    c3Experiment = await getC3Experiment(priorFixture.c3Id);
    c3Replay = await replayC3Experiment(priorFixture.c3Id);
  } else {
    const savedC3 = await persistC3Experiment({
      allocationId: allocation.id,
      validationPreparedInputId: validationRow.id,
      c2ExperimentId: savedC2.experiment.id,
      alphaIds,
      developmentStartDate,
      developmentEndDate,
      evaluationStartDate,
      evaluationEndDate,
      thresholds,
      groupCaps,
      manualOverrides: {},
      assumptions: b3Assumptions,
    });
    if (!("experiment" in savedC3) || !savedC3.experiment)
      throw new Error("C3 B3 KEEP_ALL/GROUP_CAP/REPRESENTATIVE preflight failed: " +
        ("error" in savedC3 ? savedC3.error : "missing C3 response"));
    c3Experiment = savedC3.experiment;
    c3Replay = await replayC3Experiment(c3Experiment.id);
  }
  assert.ok(c3Experiment, `C3 B3 preflight record #${priorFixture.c3Id ?? "new"} was not found.`);
  assert.equal(c3Replay?.status, "pass",
    `Real C3 B3 preflight must replay all policies: ${c3Replay?.differences?.join("\n") ?? "no replay response"}`);
  assert.equal(c3Experiment.manifest.policyRequests.GROUP_CAP.constraints.groupCaps[0].max, 0.1);
  const cappedWeights = c3Experiment.manifest.allocations.GROUP_CAP.result.candidateWeights;
  assert.ok(expectedGroup.memberIds.reduce((sum: number, id: string) => sum + (cappedWeights[id] ?? 0), 0) <= 0.10000001,
    "GROUP_CAP B2 result must exhibit the nontrivial declared A/B exposure cap.");
  assert.equal(c3Experiment.manifest.policyRequests.REPRESENTATIVE.candidateIds.length, 7,
    "REPRESENTATIVE preflight must retain one member for the A/B redundancy group.");

  const descriptor = {
    namespace: `C3-T8-${allocation.id}`,
    divergenceScale,
    b1PolicyId: policyRow.id,
    b1EvaluationId: validationRow.id,
    b2Id: allocation.id,
    c2Id: savedC2.experiment.id,
    c3Id: c3Experiment.id,
    alphaIds,
    evidenceAlphaIds: input.alphaIds,
    alphaNames: Object.fromEntries(alphaSpecifications.map((spec, index) => [spec.key, alphaIds[index]])),
    developmentStartDate,
    developmentEndDate,
    evaluationStartDate,
    evaluationEndDate,
    c2Thresholds: {
      highCorrelationThreshold: input.highCorrelationThreshold,
      materialCorrelationGap: input.materialCorrelationGap,
    },
    c2Correlations: {
      cdFull: pairCD.fullSample.correlation,
      cdRiskOn: riskOnCorrelation.correlation,
      cdRiskOff: riskOffCorrelation.correlation,
      cdRiskOffGap: pairCD.fullSample.correlation - riskOffCorrelation.correlation,
    },
    thresholds,
    groupCaps,
    expectedGroup: {
      id: expectedGroup.id,
      alphaIds: alphaIds.slice(0, 2),
      evidenceFlag: pairAB.flag,
      fullCorrelation: pairAB.fullSample.correlation,
    },
    expectedPreservedPair: {
      alphaIds: alphaIds.slice(2, 4),
      flag: pairCD.flag,
      fullCorrelation: pairCD.fullSample.correlation,
      regimeCorrelations: pairCD.regimeCorrelation,
    },
    developmentRegimes: [...rawRegimes],
    selectedEvidenceCount: input.alphaIds.length,
    robustB2Policy: {
      covarianceDiagonalShrinkage: (allocation.frozenRequest as any).covarianceDiagonalShrinkage,
      objective: (allocation.frozenRequest as any).objective,
      totalCashBounds: (allocation.frozenRequest as any).constraints.totalCash,
    },
    keepAllB3Preflight: {
      status: keepAllPreflight.status,
      decisionCount: keepAllPreflight.decisions.length,
      dailyLedgerCount: keepAllPreflight.dailyLedger.length,
      maximumReconciliationDifference: keepAllPreflight.diagnostics.maximumReconciliationDifference,
    },
    c3B3Preflight: {
      status: c3Replay.status,
      policies: Object.fromEntries(Object.entries(c3Experiment.result.policies).map(([key, value]: [string, any]) =>
        [key, { allocationId: value.allocationId, validationRunId: value.validationRunId, metrics: value.metrics }])),
    },
    previewPolicySummaries: cappedPreview.plan.policies,
    preview: cappedPreview,
  };
  await writeFile("/tmp/c3-t8-fixture.json", JSON.stringify(descriptor, null, 2));
  assert.equal(savedC2.experiment.manifestHash.length, 64);
  console.log(JSON.stringify({
    b1PolicyId: policyRow.id,
    b1EvaluationId: validationRow.id,
    b2Id: allocation.id,
    c2Id: savedC2.experiment.id,
    c3Id: c3Experiment.id,
    keepAllB3Status: keepAllPreflight.status,
    c3B3Status: c3Replay.status,
    c2AlphaCount: input.alphaIds.length,
    groupIds: preview.plan.groups.map((group: any) => group.id),
    preservedPair: [preservedPair.alphaA, preservedPair.alphaB],
  }));
});