import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseCsv, computeRegime, computeFactors, constructAllocation, runBacktestEngine,
  defaultBacktestConfig, type Constraints, type EtfEntry,
} from "./calculator";
import type { FactorDefinition } from "./factor-library";
import {
  ENGINE_VERSION, LEGACY_MESSAGE, REPRODUCTION_TOLERANCE, createRunSnapshot,
  frozenValidationInputs, hashDataset, reproduceRun, resolveRunSnapshot,
} from "./run-snapshot";
import { ADJUSTED_OHLC_CONVENTION } from "./price-ohlc";

const etfs: EtfEntry[] = [
  { ticker: "AAA", name: "Asset A", sector: "A", priorWeight: 0.2, enabled: true },
  { ticker: "BBB", name: "Asset B", sector: "B", priorWeight: 0, enabled: true },
];
const constraints: Constraints = {
  cashMin: 0.1, cashMax: 0.2, maxEtfWeight: 0.8, minInclusionThreshold: 0,
  targetActiveEtfs: 2, diversificationEnabled: true,
};
const factor: FactorDefinition = {
  id: "momentum", name: "Momentum", description: "", family: "Momentum", enabled: true,
  status: "active", inputSeries: "price", calculationType: "momentum", formula: "return(2)",
  direction: "higher_is_better", lookback: 2, lag: 0, normalization: "percentile_rank",
  winsorizationLower: 0, winsorizationUpper: 1, missingDataTreatment: "exclude",
  baseWeight: 1, regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 },
  activeRegimes: ["risk_on", "neutral", "risk_off"], dataSource: "price",
  benchmarkTicker: null, currentCoverage: 1, availabilityReason: null, version: "test",
};
const csv = "date,AAA,BBB\n2026-01-01,100,100\n2026-01-02,101,99\n2026-01-03,102,98\n" +
  "2026-01-04,103,97\n2026-01-05,104,96\n2026-01-06,105,95\n" +
  "2026-01-07,106,94\n2026-01-08,107,93";
const adjustedOhlcCsv = [
  "Date,Ticker,Open,High,Low,Close",
  ...parseCsv(csv).flatMap((row) => ["AAA", "BBB"].map((ticker) => {
    const close = row.prices[ticker];
    return `${row.date},${ticker},${close - 0.5},${close + 1},${close - 1},${close}`;
  })),
].join("\n");
const makeRun = (content = csv, settings: {
  etfs?: EtfEntry[]; constraints?: Constraints; factors?: FactorDefinition[]; version?: string; id?: number;
  ohlcCsvContent?: string;
} = {}) => {
  const universe = { etfs: settings.etfs ?? etfs, cashPriorWeight: 0.8 };
  const rules = settings.constraints ?? constraints;
  const factorSet = { version: settings.version ?? "factors-1", factors: settings.factors ?? [factor] };
  const rows = parseCsv(content);
  const active = universe.etfs.filter((e) => e.enabled).map((e) => e.ticker);
  const regime = computeRegime(rows, active);
  const factorData = computeFactors(rows, active, factorSet, regime.label);
  const allocations = constructAllocation(factorData, universe.etfs, rules, regime);
  const snapshot = createRunSnapshot({
    optimizationTimestamp: "2026-09-25T12:00:00.000Z",
    dataset: {
      id: settings.id ?? 1, sha256: hashDataset(content), startDate: rows[0].date,
      endDate: rows.at(-1)!.date, tickers: ["AAA", "BBB"], csvContent: content,
      ...(settings.ohlcCsvContent ? {
        ohlcCsvContent: settings.ohlcCsvContent,
        ohlcSha256: hashDataset(settings.ohlcCsvContent),
        ohlcConvention: ADJUSTED_OHLC_CONVENTION,
      } : {}),
    },
    universe, constraints: rules, factorSet,
    benchmarkConfiguration: { defaultTicker: "AAA" },
    outputs: { allocations, regime, factorData },
  });
  // JSON round-trip matches the persisted PostgreSQL JSONB representation.
  return JSON.parse(JSON.stringify({ allocations, regime, runSnapshot: snapshot })) as Record<string, unknown>;
};
const validate = (stored: Record<string, unknown>) => {
  const frozen = frozenValidationInputs(stored);
  assert.ok(frozen, "validation must require a complete same-version snapshot");
  return runBacktestEngine(frozen.priceRows, frozen.etfs, frozen.constraints,
    { ...defaultBacktestConfig(), warmupDays: 3, transactionCostBps: 0, slippageBps: 0 },
    null, frozen.factorSet);
};

test("TEST 1 — current factors change after run", () => {
  const runA = makeRun();
  const before = validate(runA);
  const currentFactors = [{ ...factor, id: "replacement", direction: "lower_is_better" as const }];
  assert.notDeepEqual(currentFactors, frozenValidationInputs(runA)!.factorSet.factors);
  assert.deepEqual(validate(runA), before);
  assert.equal(frozenValidationInputs(runA)!.factorSet.factors[0].id, "momentum");
  assert.equal(reproduceRun(runA).status, "pass");
});

test("TEST 2 — current constraints change after run", () => {
  const runA = makeRun();
  const before = validate(runA);
  const currentConstraints = { ...constraints, cashMin: 0.8, cashMax: 0.9 };
  assert.notDeepEqual(currentConstraints, frozenValidationInputs(runA)!.constraints);
  assert.deepEqual(validate(runA), before);
  assert.equal(frozenValidationInputs(runA)!.constraints.cashMin, 0.1);
});

test("TEST 3 — dataset changes after run", () => {
  const runA = makeRun();
  const before = validate(runA);
  const currentCsv = csv.replace("2026-01-05,104,96", "2026-01-05,180,96");
  assert.notEqual(hashDataset(currentCsv), (runA.runSnapshot as ReturnType<typeof createRunSnapshot>).dataset.sha256);
  assert.equal(frozenValidationInputs(runA)!.priceRows[4].prices.AAA, 104);
  assert.deepEqual(validate(runA), before);
});

test("TEST 4 — historical run immutability when Run B is saved", () => {
  const archive = new Map<number, Record<string, unknown>>();
  archive.set(1, makeRun());
  const original = JSON.stringify(archive.get(1));
  const runB = makeRun(csv.replace("2026-01-05,104,96", "2026-01-05,130,96"), {
    id: 2, version: "factors-2", factors: [{ ...factor, id: "replacement" }],
    constraints: { ...constraints, cashMin: 0.2, cashMax: 0.3 },
  });
  archive.set(2, runB);
  assert.equal(JSON.stringify(archive.get(1)), original);
  assert.notEqual((archive.get(1)!.runSnapshot as ReturnType<typeof createRunSnapshot>).dataset.sha256,
    (runB.runSnapshot as ReturnType<typeof createRunSnapshot>).dataset.sha256);
  assert.equal(reproduceRun(archive.get(1)!).status, "pass");
});

test("TEST 5 — exact rerun and named reproducibility failure", () => {
  const runA = makeRun();
  const replay = reproduceRun(runA);
  assert.equal(replay.status, "pass", replay.differences.join("; "));
  assert.equal(replay.tolerance, REPRODUCTION_TOLERANCE);
  const tampered = structuredClone(runA);
  (tampered.allocations as Array<{ weight: number }>)[0].weight += 0.01;
  const failure = reproduceRun(tampered);
  assert.equal(failure.status, "fail");
  assert.equal(failure.message, "REPRODUCIBILITY FAIL");
  assert.ok(failure.differences.some((d) => d.includes("allocations[0].weight")));
});

test("TEST 6 — dataset SHA-256 content integrity", () => {
  assert.equal(hashDataset(csv), hashDataset(`${csv}`));
  assert.match(hashDataset(csv), /^[a-f0-9]{64}$/);
  const changed = csv.replace("2026-01-05,104,96", "2026-01-05,104.01,96");
  assert.notEqual(hashDataset(csv), hashDataset(changed));
  const runA = makeRun();
  (runA.runSnapshot as ReturnType<typeof createRunSnapshot>).dataset.csvContent = changed;
  assert.equal(resolveRunSnapshot(runA).status, "integrity_fail");
  assert.equal(frozenValidationInputs(runA), null);
});

test("TEST 7 — legacy and engine-version mismatch never replay as current", () => {
  const legacy = { allocations: makeRun().allocations, regime: makeRun().regime };
  assert.equal(resolveRunSnapshot(legacy).message, LEGACY_MESSAGE);
  assert.equal(reproduceRun(legacy).status, "legacy");
  assert.equal(frozenValidationInputs(legacy), null);
  const oldEngine = makeRun();
  (oldEngine.runSnapshot as ReturnType<typeof createRunSnapshot>).engineVersion = "allocation-old";
  const status = reproduceRun(oldEngine);
  assert.equal(status.status, "engine_mismatch");
  assert.equal(status.message, "Historical inputs are preserved, but exact reproduction requires engine version allocation-old.");
  assert.equal(frozenValidationInputs(oldEngine), null);
  assert.equal(ENGINE_VERSION, "allocation-a2.1");
});

test("TEST 8 — frozen adjusted OHLC survives serialized persistence and next_open replay", () => {
  const saved = makeRun(csv, { ohlcCsvContent: adjustedOhlcCsv });
  // Match the JSONB serialization boundary used for a persisted run_snapshot.
  const persisted = JSON.parse(JSON.stringify(saved)) as Record<string, unknown>;
  const snapshot = persisted.runSnapshot as ReturnType<typeof createRunSnapshot>;
  assert.equal(snapshot.dataset.ohlcCsvContent, adjustedOhlcCsv);
  assert.equal(snapshot.dataset.ohlcSha256, hashDataset(adjustedOhlcCsv));
  assert.equal(snapshot.dataset.ohlcConvention, ADJUSTED_OHLC_CONVENTION);

  const frozen = frozenValidationInputs(persisted);
  assert.ok(frozen, "serialized adjusted-OHLC snapshot must remain eligible for frozen validation");
  assert.deepEqual(frozen.priceRows[0].opens, { AAA: 99.5, BBB: 99.5 });
  const config = {
    ...defaultBacktestConfig(), warmupDays: 3, executionTiming: "next_open" as const,
    transactionCostBps: 0, slippageBps: 0,
  };
  const originalReplay = runBacktestEngine(frozen.priceRows, frozen.etfs, frozen.constraints,
    config, null, frozen.factorSet);
  const reloadedReplay = runBacktestEngine(
    frozenValidationInputs(JSON.parse(JSON.stringify(persisted)) as Record<string, unknown>)!.priceRows,
    frozen.etfs, frozen.constraints, config, null, frozen.factorSet);
  assert.equal(originalReplay.hasSufficientData, true);
  assert.ok(originalReplay.dailyLedger.length > 0, "next_open replay must produce persisted execution results");
  assert.deepEqual(reloadedReplay, originalReplay, "next_open results must be identical after snapshot reload");
  assert.equal(reproduceRun(persisted).status, "pass");
});

test("TEST 9 — adjusted OHLC hash tampering fails frozen snapshot integrity", () => {
  const persisted = makeRun(csv, { ohlcCsvContent: adjustedOhlcCsv });
  const tampered = JSON.parse(JSON.stringify(persisted)) as Record<string, unknown>;
  const snapshot = tampered.runSnapshot as ReturnType<typeof createRunSnapshot>;
  snapshot.dataset.ohlcCsvContent = adjustedOhlcCsv.replace("2026-01-01,AAA,99.5", "2026-01-01,AAA,99.6");

  const resolution = resolveRunSnapshot(tampered);
  assert.equal(resolution.status, "integrity_fail");
  assert.match(resolution.message, /adjusted OHLC hash/);
  assert.equal(frozenValidationInputs(tampered), null);
  assert.equal(reproduceRun(tampered).status, "fail");
});

test("TEST 10 — historical close-only snapshots still replay without OHLC companions", () => {
  const persisted = JSON.parse(JSON.stringify(makeRun())) as Record<string, unknown>;
  const snapshot = persisted.runSnapshot as ReturnType<typeof createRunSnapshot>;
  assert.equal("ohlcCsvContent" in snapshot.dataset, false);
  assert.equal(resolveRunSnapshot(persisted).status, "ready");
  const frozen = frozenValidationInputs(persisted);
  assert.ok(frozen);
  assert.equal("opens" in frozen.priceRows[0], false);
  assert.equal(reproduceRun(persisted).status, "pass");
});
