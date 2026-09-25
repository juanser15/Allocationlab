import {
  defaultBacktestConfig, generateRebalanceDates, parseCsv, runBacktestEngine,
  type BacktestInitialState, type Constraints,
} from "./calculator";
import { optimizePreparedSnapshot, type AllocationRequest, type AllocationResult } from "./allocation-b2";
import {
  canonicalJson, prepareSnapshot, type PreparedCandidate, type PreparedSnapshot,
} from "./prepared-inputs";
import { hashDataset } from "./run-snapshot";

export interface B3Assumptions {
  evaluationStartDate: string;
  evaluationEndDate: string;
  decisionCalendar: "monthly" | "quarterly";
  executionTiming: "same_close" | "next_close";
  initialNav: number;
  initialHoldings: Record<string, number>;
  initialCash: number;
  transactionCostBps: number;
  slippageBps: number;
  dailyCashYield: number;
  benchmarkTicker?: string;
}

export interface B3Decision {
  decisionDate: string;
  informationCutoff: string;
  executionDate: string;
  estimationDates: string[];
  inputDatasetHash: string;
  policyCandidateIds: string[];
  validationCandidateIds: string[];
  pointInTimeCandidateIds: string[];
  candidateTargetAssetExposures: Record<string, Record<string, number>>;
  optimizer: AllocationResult;
  candidateWeights: Record<string, number>;
  masterCash: number;
  totalCash: number;
  targetAssetWeights: Record<string, number>;
  targetAssetExposureSum: number;
  candidateAssetContributions: Record<string, Record<string, number>>;
  executedAssetWeights?: Record<string, number>;
  executedTargetDifferences?: Record<string, number>;
  constraintChecks: AllocationResult["constraintSlacks"];
}

export interface B3DailyLedgerEntry {
  date: string;
  intervalStart: string;
  beginningNav: number;
  beginningCash: number;
  beginningPositions: Array<{ ticker: string; quantity: number; price: number; marketValue: number; weight: number }>;
  assetPnl: number;
  cashPnl: number;
  transactionCosts: number;
  slippage: number;
  externalTrades: Array<{ ticker: string; quantity: number; notional: number }>;
  externalTradedNotional: number;
  netPnl: number;
  dailyNetReturn: number;
  endingNav: number;
  endingCash: number;
  endingPositions: Array<{ ticker: string; quantity: number; price: number; marketValue: number; weight: number }>;
  reconciliationDifference: number;
}

export interface B3Result {
  status: "completed" | "failed";
  reason?: string;
  failureDate?: string;
  policyIdentity: {
    representation: AllocationRequest["representation"];
    candidateIds: string[];
    validationCandidateIds: Record<string, string>;
    datasetHash: string;
    validationDatasetHash: string;
    objective: AllocationRequest["objective"];
    estimationWindow: number;
    minObservations: number;
  };
  assumptions: B3Assumptions;
  decisionCalendar: Array<{ decisionDate: string; executionDate: string }>;
  decisions: B3Decision[];
  dailyLedger: B3DailyLedgerEntry[];
  metrics: {
    cumulativeReturn: number | null;
    annualizedReturn: number | null;
    annualizedVolatility: number | null;
    volatilityReason: string | null;
    sharpe: number | null;
    sharpeReason: string | null;
    maximumDrawdown: number | null;
    monthlyReturns: Array<{ month: string; return: number; partial: boolean }>;
    totalTransactionCosts: number;
    totalSlippage: number;
    externalTradedNotional: number;
    turnoverConvention: string;
    dailyCashYield: number;
    annualizationConvention: string;
  } | null;
  diagnostics: {
    reconciliationTolerance: number;
    maximumReconciliationDifference: number | null;
    engineVersion: string;
    solverVersions: string[];
    limitations: string[];
  };
}

const TOLERANCE = 1e-8;
const DAYS_PER_YEAR = 252;

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function definitionsCompatible(policy: PreparedCandidate, validation: PreparedCandidate): boolean {
  if (policy.kind !== validation.kind || canonicalJson(policy.assetTickers) !== canonicalJson(validation.assetTickers) ||
    policy.factorId !== validation.factorId || policy.mapping !== validation.mapping ||
    policy.signalUnits !== validation.signalUnits)
    return false;
  if (policy.kind !== "alpha_streams") return true;
  const a = policy.lineage.definition as Record<string, unknown> | undefined;
  const b = validation.lineage.definition as Record<string, unknown> | undefined;
  if (!a || !b) return false;
  const withoutDisplayName = (definition: Record<string, unknown>) => {
    const copy = { ...definition };
    delete copy.name;
    return copy;
  };
  return canonicalJson(withoutDisplayName(a)) === canonicalJson(withoutDisplayName(b));
}

function engineConstraints(): Constraints {
  return {
    cashMin: 0, cashMax: 1, maxEtfWeight: 1, minEtfWeight: 0,
    minInclusionThreshold: 0, targetActiveEtfs: 1, diversificationEnabled: false,
  };
}

function executionDate(rows: Array<{ date: string }>, date: string, timing: B3Assumptions["executionTiming"]): string | null {
  const index = rows.findIndex((row) => row.date === date);
  if (index < 0) return null;
  if (timing === "same_close") return date;
  return rows[index + 1]?.date ?? null;
}

function dailySharpe(returns: number[], cashYield: number): { value: number | null; reason: string | null } {
  const excess = returns.map((value) => value - cashYield);
  if (excess.length < 2) return { value: null, reason: "At least two daily excess returns are required." };
  const average = excess.reduce((sum, value) => sum + value, 0) / excess.length;
  const variance = excess.reduce((sum, value) => sum + (value - average) ** 2, 0) / (excess.length - 1);
  if (variance <= 1e-24) return { value: null, reason: "Daily excess-return volatility is zero; Sharpe is undefined." };
  return { value: Math.sqrt(DAYS_PER_YEAR) * average / Math.sqrt(variance), reason: null };
}

function failureResult(
  assumptions: B3Assumptions,
  policy: AllocationRequest,
  policySnapshot: PreparedSnapshot,
  validationSnapshot: PreparedSnapshot,
  reason: string,
  failureDate?: string,
  decisions: B3Decision[] = [],
  decisionCalendar: Array<{ decisionDate: string; executionDate: string }> = [],
): B3Result {
  return {
    status: "failed", reason, failureDate, assumptions,
    policyIdentity: {
      representation: policy.representation, candidateIds: [...policy.candidateIds],
      validationCandidateIds: {},
      datasetHash: policySnapshot.dataset.sha256, validationDatasetHash: validationSnapshot.dataset.sha256,
      objective: policy.objective, estimationWindow: policy.estimationWindow, minObservations: policy.minObservations,
    },
    decisionCalendar, decisions, dailyLedger: [], metrics: null,
    diagnostics: {
      reconciliationTolerance: TOLERANCE, maximumReconciliationDifference: null,
      engineVersion: validationSnapshot.a1EngineVersion, solverVersions: [],
      limitations: ["A failed or partial simulation is not reported as a successful backtest."],
    },
  };
}

/**
 * Historical fixed-policy simulation. B1 is reconstructed from the selected
 * immutable validation snapshot through each decision date (retaining all
 * pre-evaluation warmup rows); decision-date B1 targets are timestamped at
 * their strict prior-close information cutoff for B2's point-in-time filter;
 * A1 executes the consolidated underlying asset target and maintains quantity
 * holdings between execution events.
 */
export function runB3Validation(
  policySnapshot: PreparedSnapshot,
  policyRequest: AllocationRequest,
  validationSnapshot: PreparedSnapshot,
  assumptions: B3Assumptions,
): B3Result {
  const fail = (reason: string, date?: string, decisions: B3Decision[] = [],
    calendar: Array<{ decisionDate: string; executionDate: string }> = []) =>
    failureResult(assumptions, policyRequest, policySnapshot, validationSnapshot, reason, date, decisions, calendar);

  if (!policySnapshot?.dataset?.csvContent || !validationSnapshot?.dataset?.csvContent)
    return fail("Policy and validation snapshots with their immutable CSV content are required.");
  if (hashDataset(policySnapshot.dataset.csvContent) !== policySnapshot.dataset.sha256)
    return fail("Policy dataset integrity failure: snapshot content does not match its SHA-256 hash.");
  if (hashDataset(validationSnapshot.dataset.csvContent) !== validationSnapshot.dataset.sha256)
    return fail("Validation dataset integrity failure: snapshot content does not match its SHA-256 hash.");
  if (policySnapshot.representation !== policyRequest.representation ||
    validationSnapshot.representation !== policyRequest.representation)
    return fail("Policy request and both frozen preparations must use the same supported representation.");
  if (policyRequest.representation === "signals")
    return fail("B2 does not support predictive signal optimization; B3 requires asset_returns or alpha_streams.");
  if (!policyRequest.candidateIds.length || new Set(policyRequest.candidateIds).size !== policyRequest.candidateIds.length)
    return fail("Policy must freeze a nonempty unique set of canonical candidate IDs.");
  if (!validDate(assumptions.evaluationStartDate) || !validDate(assumptions.evaluationEndDate) ||
    assumptions.evaluationStartDate >= assumptions.evaluationEndDate)
    return fail("Evaluation dates must be valid YYYY-MM-DD values with start before end.");
  if (!["monthly", "quarterly"].includes(assumptions.decisionCalendar) ||
    !["same_close", "next_close"].includes(assumptions.executionTiming))
    return fail("B3 supports only monthly/quarterly calendars and A1 same_close/next_close execution.");
  if (![assumptions.initialNav, assumptions.initialCash, assumptions.transactionCostBps,
    assumptions.slippageBps, assumptions.dailyCashYield].every(isFiniteNumber) ||
    assumptions.initialNav <= 0 || assumptions.initialCash < 0 || assumptions.transactionCostBps < 0 ||
    assumptions.slippageBps < 0 || assumptions.dailyCashYield <= -1)
    return fail("Initial capital, costs, and cash-yield assumptions must be finite and in their valid ranges.");
  if (Object.values(assumptions.initialHoldings ?? {}).some((quantity) => !isFiniteNumber(quantity) || quantity < 0))
    return fail("Initial holdings must be finite nonnegative quantities.");
  if (policySnapshot.engineVersion !== validationSnapshot.engineVersion ||
    policySnapshot.a1EngineVersion !== validationSnapshot.a1EngineVersion)
    return fail("Policy and validation preparations use incompatible frozen B1/A1 engine versions.");
  const policyCandidates = policyRequest.candidateIds.map((id) => policySnapshot.candidates.find((candidate) =>
    candidate.candidateId === id && candidate.canonicalFingerprint === id));
  if (policyCandidates.some((candidate) => !candidate))
    return fail("A selected policy ID is not a canonical candidate in the frozen B1 policy snapshot.");
  const frozenCandidates = policyCandidates as PreparedCandidate[];
  const validationCandidates = policyRequest.candidateIds.map((id, i) => {
    const exact = validationSnapshot.candidates.find((candidate) => candidate.candidateId === id &&
      candidate.canonicalFingerprint === id && !candidate.diagnostics.duplicateOf);
    if (exact && definitionsCompatible(frozenCandidates[i], exact)) return exact;
    return validationSnapshot.candidates.find((candidate) => candidate.candidateId === candidate.canonicalFingerprint &&
      !candidate.diagnostics.duplicateOf && definitionsCompatible(frozenCandidates[i], candidate));
  });
  if (validationCandidates.some((candidate) => !candidate))
    return fail("Validation preparation does not contain compatible frozen canonical candidate definitions/mappings.");
  if (new Set((validationCandidates as PreparedCandidate[]).map((candidate) => candidate.candidateId)).size !==
    policyRequest.candidateIds.length)
    return fail("Frozen policy candidates do not map one-to-one to unique validation candidate identities.");
  if (policyRequest.representation === "alpha_streams" &&
    canonicalJson(policySnapshot.factorSet) !== canonicalJson(validationSnapshot.factorSet))
    return fail("Alpha validation must use the exact frozen B1 factor definitions and version.");
  const definitions = validationCandidates as PreparedCandidate[];
  const policyToValidationId = Object.fromEntries(policyRequest.candidateIds.map((id, i) =>
    [id, definitions[i].candidateId]));
  if (policyRequest.representation === "alpha_streams") {
    for (const candidate of definitions) {
      const definition = candidate.lineage.definition as {
        rebalanceFrequency?: string; executionTiming?: string;
      } | undefined;
      if (!definition || definition.rebalanceFrequency !== assumptions.decisionCalendar ||
        definition.executionTiming !== assumptions.executionTiming)
        return fail(`Candidate ${candidate.candidateId} has a saved schedule/execution incompatible with B3 assumptions.`,
          assumptions.evaluationStartDate);
    }
  }
  if (!validationSnapshot.dataset.startDate || validationSnapshot.dataset.startDate > assumptions.evaluationStartDate ||
    validationSnapshot.dataset.endDate < assumptions.evaluationEndDate)
    return fail("The explicitly selected validation snapshot must cover evaluation dates and the preceding B1 warmup history.");
  if (assumptions.benchmarkTicker && !validationSnapshot.dataset.tickers.includes(assumptions.benchmarkTicker))
    return fail(`Selected benchmark ${assumptions.benchmarkTicker} is absent from the validation dataset.`);
  if (policyRequest.constraints?.unsupported?.length)
    return fail(`Policy contains unsupported constraints: ${policyRequest.constraints.unsupported.join(", ")}.`);

  let rows: ReturnType<typeof parseCsv>;
  try {
    rows = parseCsv(validationSnapshot.dataset.csvContent);
  } catch (error) {
    return fail(`Validation dataset could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const evalRows = rows.filter((row) => row.date <= assumptions.evaluationEndDate);
  const expectedCalendar = generateRebalanceDates(
    evalRows, assumptions.decisionCalendar, 0, assumptions.evaluationStartDate,
  ).flatMap((decisionDate) => {
    const execution = executionDate(evalRows, decisionDate, assumptions.executionTiming);
    return execution && execution <= assumptions.evaluationEndDate ? [{ decisionDate, executionDate: execution }] : [];
  });
  if (!expectedCalendar.length)
    return fail("No executable decisions fall within the requested evaluation range.");
  if (expectedCalendar[0].decisionDate <= rows[0]?.date)
    return fail("Evaluation start has no preceding close for a point-in-time information cutoff.", expectedCalendar[0].decisionDate);

  const dates = new Set(expectedCalendar.map((item) => item.decisionDate));
  const decisions: B3Decision[] = [];
  let decisionFailure: { date: string; reason: string } | null = null;
  const readDecisionFailure = (): { date: string; reason: string } | null => decisionFailure;
  const historicalPreparation = (decisionDate: string): PreparedSnapshot => {
    // Include the execution close so B1's A1 scheduler retains a NEXT_CLOSE
    // decision-date target. The target itself still reads only prices strictly
    // before the decision; B2 is independently cut off at the preceding close.
    const b1PreparationEnd = executionDate(rows, decisionDate, assumptions.executionTiming) ?? decisionDate;
    const inputLines = validationSnapshot.dataset.csvContent.trimEnd().split(/\r?\n/);
    const prefixCsv = [inputLines[0], ...inputLines.slice(1).filter((line) =>
      line.split(",")[0].replace(/^"|"$/g, "") <= b1PreparationEnd)].join("\n");
    const request = structuredClone(validationSnapshot.request);
    return prepareSnapshot({
      request, csvContent: prefixCsv, factorVersion: validationSnapshot.factorSet.version,
      factors: validationSnapshot.factorSet.factors, datasetId: validationSnapshot.dataset.id ?? undefined,
    });
  };
  const decisionTarget = (decisionDate: string): Record<string, number> | null => {
    if (!dates.has(decisionDate)) return null;
    const rowIndex = rows.findIndex((row) => row.date === decisionDate);
    const informationCutoff = rows[rowIndex - 1]?.date;
    if (!informationCutoff) {
      decisionFailure = { date: decisionDate, reason: "No preceding close exists for the decision information cutoff." };
      return null;
    }
    let historical: PreparedSnapshot;
    try {
      historical = historicalPreparation(decisionDate);
    } catch (error) {
      decisionFailure = { date: decisionDate, reason: `Point-in-time B1 preparation failed: ${error instanceof Error ? error.message : String(error)}` };
      return null;
    }
    const mapped = definitions.map((base) => {
      let current: PreparedCandidate | undefined;
      if (base.kind === "asset_returns")
        current = historical.candidates.find((item) => item.candidateId === item.canonicalFingerprint &&
          !item.diagnostics.duplicateOf && item.kind === base.kind && item.assetTickers[0] === base.assetTickers[0]);
      else
        current = historical.candidates.find((item) => item.candidateId === item.canonicalFingerprint &&
          !item.diagnostics.duplicateOf && definitionsCompatible(base, item));
      if (!current) return null;
      return {
        ...current,
        targetHistory: current.targetHistory.map((item) =>
          item.signalDate === decisionDate && item.informationCutoff === informationCutoff
            ? { ...item, signalDate: informationCutoff }
            : item),
      };
    });
    if (mapped.some((candidate) => !candidate)) {
      decisionFailure = { date: decisionDate, reason: "A frozen candidate could not be reconstructed from validation B1 inputs as of this date." };
      return null;
    }
    const pointInTimeCandidates = mapped as PreparedCandidate[];
    if (new Set(pointInTimeCandidates.map((candidate) => candidate.candidateId)).size !== policyRequest.candidateIds.length) {
      decisionFailure = { date: decisionDate, reason: "Point-in-time candidate mapping is not unique; B2 variables cannot be safely translated." };
      return null;
    }
    const historicalForB2 = { ...historical, candidates: pointInTimeCandidates };
    const pointInTimeIds = pointInTimeCandidates.map((candidate) => candidate.candidateId);
    const translateRecord = <T>(record: Record<string, T> | undefined): Record<string, T> | undefined => record
      ? Object.fromEntries(policyRequest.candidateIds.flatMap((policyId, index) =>
        record[policyId] === undefined ? [] : [[pointInTimeIds[index], record[policyId]]]))
      : undefined;
    const request: AllocationRequest = {
      ...structuredClone(policyRequest),
      candidateIds: pointInTimeIds,
      informationCutoff, decisionTimestamp: decisionDate,
      constraints: {
        ...structuredClone(policyRequest.constraints),
        candidateBounds: translateRecord(policyRequest.constraints.candidateBounds),
        groupCaps: policyRequest.constraints.groupCaps?.map((group) => ({
          ...group,
          candidateIds: group.candidateIds.map((id) => pointInTimeIds[policyRequest.candidateIds.indexOf(id)]),
        })),
      },
    };
    const optimized = optimizePreparedSnapshot(historicalForB2, request);
    if (optimized.status !== "SOLVED" || !optimized.model || !optimized.assetWeights || !optimized.candidateWeights) {
      const detail = optimized.reason ?? optimized.solver.message ?? "no valid solution";
      const detailDates = [...detail.matchAll(/\d{4}-\d{2}-\d{2}/g)].map((match) => match[0]);
      decisionFailure = {
        date: detailDates.at(-1) ?? decisionDate,
        reason: `B2 ${optimized.status} at ${decisionDate}: ${detail}`,
      };
      return null;
    }
    if ((optimized.solver.maxConstraintViolation ?? Infinity) > 1e-8 ||
      (optimized.solver.scaledOptimalityResidual ?? Infinity) > 1e-6) {
      decisionFailure = { date: decisionDate, reason: `B2 independent solver/constraint validation failed at ${decisionDate}.` };
      return null;
    }
    const planned = expectedCalendar.find((item) => item.decisionDate === decisionDate)!;
    const targetAssetExposureSum = Object.values(optimized.assetWeights).reduce((sum, weight) => sum + weight, 0);
    const candidateWeights = Object.fromEntries(policyRequest.candidateIds.map((id, index) =>
      [id, optimized.candidateWeights![pointInTimeIds[index]]]));
    const candidateTargetAssetExposures = Object.fromEntries(policyRequest.candidateIds.map((id, index) => {
      const point = pointInTimeCandidates[index].targetHistory.find((item) => item.informationCutoff === informationCutoff &&
        (item.signalDate === decisionDate || item.signalDate === informationCutoff));
      return [id, point?.targetPositions ?? {}];
    }));
    const candidateAssetContributions = Object.fromEntries(policyRequest.candidateIds.map((id, candidateIndex) => [
      id,
      Object.fromEntries(optimized.model!.assetTickers.map((ticker, assetIndex) => [
        ticker, optimized.model!.H[assetIndex][candidateIndex] * candidateWeights[id],
      ])),
    ]));
    const optimizerWithPolicyIds: AllocationResult = {
      ...optimized,
      candidateWeights,
      model: { ...optimized.model, candidateIds: [...policyRequest.candidateIds] },
    };
    decisions.push({
      decisionDate, informationCutoff, executionDate: planned.executionDate,
      estimationDates: [...optimized.model.dates], inputDatasetHash: historical.dataset.sha256,
      policyCandidateIds: [...policyRequest.candidateIds],
      validationCandidateIds: definitions.map((candidate) => candidate.candidateId),
      pointInTimeCandidateIds: pointInTimeIds,
      candidateTargetAssetExposures,
      optimizer: optimizerWithPolicyIds, candidateWeights, masterCash: optimized.masterCash!,
      totalCash: optimized.totalCash!, targetAssetWeights: { ...optimized.assetWeights }, targetAssetExposureSum,
      candidateAssetContributions,
      constraintChecks: optimized.constraintSlacks,
    });
    return optimized.assetWeights;
  };
  const config = {
    ...defaultBacktestConfig(), rebalanceFrequency: assumptions.decisionCalendar,
    executionTiming: assumptions.executionTiming, transactionCostBps: assumptions.transactionCostBps,
    slippageBps: assumptions.slippageBps, cashYieldAnnual: 0, warmupDays: 0,
    startDate: assumptions.evaluationStartDate,
  };
  const tickerSet = [...new Set([
    ...validationSnapshot.dataset.tickers,
    ...definitions.flatMap((candidate) => candidate.assetTickers),
  ])];
  const etfs = tickerSet.map((ticker) => ({
    ticker, name: ticker, sector: "Underlying", priorWeight: 0, enabled: true,
  }));
  const initialState: BacktestInitialState = {
    initialNav: assumptions.initialNav,
    initialCash: assumptions.initialCash,
    initialHoldings: { ...assumptions.initialHoldings },
    dailyCashYield: assumptions.dailyCashYield,
  };
  const engine = runBacktestEngine(
    evalRows, etfs, engineConstraints(), config, assumptions.benchmarkTicker ?? null,
    { factors: validationSnapshot.factorSet.factors }, (date) => decisionTarget(date), initialState,
  );
  const callbackFailure = readDecisionFailure();
  if (callbackFailure) return fail(callbackFailure.reason, callbackFailure.date, decisions, expectedCalendar);
  if (!engine.hasSufficientData) {
    const reason = engine.insufficientReason ?? "A1 could not produce a complete underlying-book ledger.";
    const dated = [...reason.matchAll(/\d{4}-\d{2}-\d{2}/g)].map((match) => match[0]);
    return fail(reason, dated.at(-1) ?? expectedCalendar[0]?.decisionDate, decisions, expectedCalendar);
  }
  if (decisions.length !== expectedCalendar.length)
    return fail("A1 execution calendar and successfully solved B3 decisions do not reconcile.",
      expectedCalendar.find((item) => !decisions.some((decision) => decision.decisionDate === item.decisionDate))?.decisionDate,
      decisions, expectedCalendar);

  const ledger: B3DailyLedgerEntry[] = engine.dailyLedger.map((entry) => {
    const positions = (items: typeof entry.beginningPositions) => items.map((position) => ({
      ...position,
    }));
    const beginningNav = entry.beginningNav;
    const netPnl = entry.netPnl;
    const endingNav = entry.endingNav;
    const difference = beginningNav + netPnl - endingNav;
    return {
      date: entry.date, intervalStart: entry.intervalStart, beginningNav,
      beginningCash: entry.beginningCash,
      beginningPositions: positions(entry.beginningPositions),
      assetPnl: entry.etfPnl, cashPnl: entry.cashPnl,
      transactionCosts: entry.transactionCosts, slippage: entry.slippage,
      externalTrades: entry.trades.map((trade) => ({
        ticker: trade.ticker, quantity: trade.quantity, notional: trade.notional,
      })),
      externalTradedNotional: entry.trades.reduce((sum, trade) => sum + Math.abs(trade.notional), 0),
      netPnl, dailyNetReturn: beginningNav > 0 ? netPnl / beginningNav : 0,
      endingNav, endingCash: entry.endingCash, endingPositions: positions(entry.endingPositions),
      reconciliationDifference: difference,
    };
  });
  const maximumReconciliationDifference = ledger.reduce((max, entry) =>
    Math.max(max, Math.abs(entry.reconciliationDifference)), 0);
  if (maximumReconciliationDifference > TOLERANCE)
    return fail(`A1 daily ledger reconciliation exceeded ${TOLERANCE}: ${maximumReconciliationDifference}.`,
      ledger.find((entry) => Math.abs(entry.reconciliationDifference) > TOLERANCE)?.date, decisions, expectedCalendar);
  for (const decision of decisions) {
    const execution = ledger.find((entry) => entry.date === decision.executionDate);
    if (!execution) continue;
    const tickers = new Set([...Object.keys(decision.targetAssetWeights),
      ...execution.endingPositions.map((position) => position.ticker)]);
    const executed = Object.fromEntries([...tickers].map((ticker) => {
      const position = execution.endingPositions.find((item) => item.ticker === ticker);
      return [ticker, position ? position.marketValue / execution.endingNav : 0];
    }));
    decision.executedAssetWeights = executed;
    decision.executedTargetDifferences = Object.fromEntries(Object.keys({
      ...decision.targetAssetWeights, ...executed,
    }).map((ticker) => [ticker, (executed[ticker] ?? 0) - (decision.targetAssetWeights[ticker] ?? 0)]));
  }
  const dailyReturns = ledger.map((entry) => entry.dailyNetReturn);
  const excessSharpe = dailySharpe(dailyReturns, assumptions.dailyCashYield);
  const terminalNav = ledger.at(-1)?.endingNav ?? assumptions.initialNav;
  const cumulativeReturn = terminalNav / assumptions.initialNav - 1;
  const years = ledger.length / DAYS_PER_YEAR;
  const mean = dailyReturns.length ? dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length : 0;
  const calculatedVolatility = dailyReturns.length > 1 ? Math.sqrt(dailyReturns.reduce((sum, value) => sum +
    (value - mean) ** 2, 0) / (dailyReturns.length - 1)) * Math.sqrt(DAYS_PER_YEAR) : null;
  const volatility = calculatedVolatility !== null && calculatedVolatility > 1e-12 ? calculatedVolatility : null;
  const volatilityReason = volatility !== null ? null : dailyReturns.length > 1
    ? "Daily return volatility is zero; annualized volatility is undefined."
    : "At least two daily returns are required to estimate annualized volatility.";
  let peak = assumptions.initialNav;
  let maximumDrawdown = 0;
  for (const entry of ledger) {
    peak = Math.max(peak, entry.endingNav);
    maximumDrawdown = Math.min(maximumDrawdown, entry.endingNav / peak - 1);
  }
  const monthlyGroups = new Map<string, B3DailyLedgerEntry[]>();
  for (const entry of ledger) {
    const month = entry.date.slice(0, 7);
    monthlyGroups.set(month, [...(monthlyGroups.get(month) ?? []), entry]);
  }
  const monthlyReturns = [...monthlyGroups].map(([month, values]) => ({
    month,
    return: values.at(-1)!.endingNav / values[0].beginningNav - 1,
    partial: values[0].date > (rows.find((row) => row.date.slice(0, 7) === month)?.date ?? values[0].date) ||
      values.at(-1)!.date < (rows.filter((row) => row.date.slice(0, 7) === month).at(-1)?.date ?? values.at(-1)!.date),
  }));
  return {
    status: "completed", assumptions,
    policyIdentity: {
      representation: policyRequest.representation, candidateIds: [...policyRequest.candidateIds],
      validationCandidateIds: policyToValidationId,
      datasetHash: policySnapshot.dataset.sha256, validationDatasetHash: validationSnapshot.dataset.sha256,
      objective: policyRequest.objective, estimationWindow: policyRequest.estimationWindow,
      minObservations: policyRequest.minObservations,
    },
    decisionCalendar: expectedCalendar, decisions, dailyLedger: ledger,
    metrics: {
      cumulativeReturn, annualizedReturn: years > 0 && terminalNav > 0
        ? (terminalNav / assumptions.initialNav) ** (1 / years) - 1 : null,
      annualizedVolatility: volatility, volatilityReason, sharpe: excessSharpe.value, sharpeReason: excessSharpe.reason,
      maximumDrawdown, monthlyReturns,
      totalTransactionCosts: ledger.reduce((sum, entry) => sum + entry.transactionCosts, 0),
      totalSlippage: ledger.reduce((sum, entry) => sum + entry.slippage, 0),
      externalTradedNotional: ledger.reduce((sum, entry) => sum + entry.externalTradedNotional, 0),
      turnoverConvention: "A1 applies costs once to one-way turnover: half the sum of absolute changes in consolidated underlying target weights; external traded notional is reported separately as the sum of absolute underlying fill notionals.",
      dailyCashYield: assumptions.dailyCashYield,
      annualizationConvention: "Daily returns are decimal close-to-close values; annualized return compounds over ledger tradingDays/252, annualized volatility is sample standard deviation times sqrt(252), and Sharpe is sqrt(252) times mean(dailyNetReturn - dailyCashYield) divided by sample standard deviation.",
    },
    diagnostics: {
      reconciliationTolerance: TOLERANCE, maximumReconciliationDifference,
      engineVersion: validationSnapshot.a1EngineVersion,
      solverVersions: [...new Set(decisions.map((decision) => decision.optimizer.solver.version))],
      limitations: [
        "Fixed-candidate-universe historical simulation; not an independent model-selection validation or proof of alpha efficacy.",
        "Input uses adjusted-close prices and does not model broker-level corporate actions.",
        "A1 applies declared fees and slippage to consolidated underlying-book one-way turnover (half the absolute target-weight-change sum), as implemented by its existing execution convention.",
      ],
    },
  };
}