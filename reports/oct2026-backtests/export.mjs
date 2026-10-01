import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
const DIR = path.dirname(new URL(import.meta.url).pathname);
const read = async file => { try { return JSON.parse(await fs.readFile(path.join(DIR, file), "utf8")); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
const freeze = await read("freeze.json");
const source = await read("assets-preparation.response.json");
const allPrices = source.snapshot.dataset.csvContent.trim().split(/\r?\n/).map(line => line.split(","));
const header = allPrices.shift(), spyIndex = header.indexOf("SPY");
const spy = Object.fromEntries(allPrices.map(row => [row[0], Number(row[spyIndex])]));
const names = { assets: "Assets · historical sample mean", signals: "Assets + Signals · SIGNAL_RIDGE", alpha: "AlphaStreams · cross-sectional long-only" };
const alphaPreparation = await read("alpha2-preparation.response.json");
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}` : JSON.stringify(value);
const factorHash = snapshot => crypto.createHash("sha256").update(canonical(snapshot.factorSet)).digest("hex");
const strategies = [];
for (const key of Object.keys(names)) {
  const original = key !== "alpha" ? await read(`${key}-allocation.response.json`) : null;
  const suffixes = key === "alpha" ? [""] : ["-gamma100", "-gamma10", ...(key === "assets" ? ["-equivalent"] : ["-reference"]), ""];
  let chosen, suffix, validation, job;
  for (const s of suffixes) {
    const a = await read(`${key}${s}-allocation.response.json`);
    if (a && !a.error) { chosen = a; suffix = s; break; }
  }
  if (chosen) {
    validation = await read(`${key}${suffix}-validation.response.json`);
    job = await read(`${key}${suffix}-job-terminal.json`) ?? await read(`${key}${suffix}-job-latest.response.json`) ?? await read(`${key}${suffix}-job.response.json`);
  }
  const result = validation?.result;
  const ledger = result?.dailyLedger ?? [];
  const decisions = result?.decisions ?? [];
  const trades = ledger.filter(row => row.externalTrades?.length);
  let peak = freeze.assumptions.initialNav;
  const baseDate = ledger[0]?.intervalStart;
  const baseSpy = spy[baseDate];
  const equity = ledger.map(row => {
    peak = Math.max(peak, row.endingNav);
    return { date: row.date, nav: row.endingNav, benchmarkNav: baseSpy && spy[row.date] ? 100000 * spy[row.date] / baseSpy : null, drawdown: row.endingNav / peak - 1 };
  });
  const annualReturns = [];
  for (const year of [...new Set(ledger.map(row => row.date.slice(0, 4)))]) {
    const entries = ledger.filter(row => row.date.startsWith(year));
    annualReturns.push({ year: Number(year), return: entries.at(-1).endingNav / entries[0].beginningNav - 1,
      startDate: entries[0].date, endDate: entries.at(-1).date, partial: year === "2016" || year === "2026",
      convention: "Compounded actual daily net returns; partial requested calendar years explicitly marked." });
  }
  const allocationData = a => a?.status === "SOLVED" ? {
    informationCutoff: a.request.informationCutoff, decisionTimestamp: a.request.decisionTimestamp,
    assets: Object.entries(a.result.assetWeights).map(([ticker, weight]) => ({ ticker, weight })),
    cash: a.result.totalCash, candidateWeights: a.result.candidateWeights, masterCash: a.result.masterCash,
    executed: false,
  } : null;
  const terminal = ledger.at(-1);
  const currentIsOct1 = chosen?.request.informationCutoff === "2026-09-30" && chosen?.request.decisionTimestamp?.startsWith("2026-10-01");
  const previousAttempts = [];
  for (const s of key === "alpha" ? [] : ["", key === "assets" ? "-equivalent" : "-reference", "-gamma10"]) {
    const a = await read(`${key}${s}-allocation.response.json`);
    if (!a) continue;
    const v = await read(`${key}${s}-validation.response.json`);
    const j = await read(`${key}${s}-job-terminal.json`) ?? await read(`${key}${s}-job-latest.response.json`) ?? await read(`${key}${s}-job.response.json`);
    previousAttempts.push({ allocationId: a.id, allocationStatus: a.status, gamma: a.request?.objective?.gamma, factorIds: a.request?.forecastModel?.factorIds,
      allocationReason: a.result?.reason ?? null, jobId: j?.jobId ?? null, jobStatus: j?.status ?? null,
      jobError: j?.error ?? null,
      validationRunId: v?.validationRunId ?? null, financialStatus: v?.status ?? null, reconciliationStatus: v?.reconciliationStatus ?? null,
      failureDate: v?.result?.failureDate ?? null, failureReason: v?.result?.reason ?? j?.error?.message ?? null, completedDecisions: v?.result?.decisions?.length ?? null,
      scheduledDecisions: v?.result?.decisionCalendar?.length ?? null,
      rawAllocationFile: `${key}${s}-allocation.response.json`, rawValidationFile: v ? `${key}${s}-validation.response.json` : null });
  }
  strategies.push({
    key, name: names[key], status: result?.status === "completed" && validation?.status === "success" ? "COMPLETE"
      : result?.status === "failed" || job?.status === "failed" ? "FAILED" : job?.status?.toUpperCase() ?? (chosen?.status === "SOLVED" ? "READY_FOR_VALIDATION" : "BLOCKED"),
    executionStatus: job?.status ?? null,
    failureCategory: job?.status === "failed" ? validation ? "FINANCIAL_VALIDATION_FAILED" : "EXECUTION_OR_PERSISTENCE_FAILED" : null,
    jobPhase: job?.phase ?? null,
    ids: { preparedInputId: chosen?.preparedInputId ?? (key === "alpha" ? null : freeze.assetPreparedInputId), allocationId: chosen?.id ?? null,
      validationRunId: validation?.validationRunId ?? job?.validationRunId ?? null, jobId: job?.jobId ?? null },
    hashes: { allocationFingerprint: chosen?.fingerprint, validationInputHash: validation?.validationInputHash, datasetHash: freeze.datasetHash, factorSetHash: freeze.factorSetHash },
    config: chosen?.request ?? (key === "alpha" ? await read("alpha-preparation.request.json") : null),
    metrics: result?.metrics ?? null,
    currentAllocation: currentIsOct1 ? allocationData(chosen) : null,
    currentAllocationStatus: currentIsOct1 ? chosen?.status : key === "signals" ? "UNAVAILABLE_CALENDAR" : "UNAVAILABLE",
    currentAllocationFreshness: key === "alpha" ? "AS_OF_OPTIMIZATION_USING_PRIOR_SCHEDULED_ALPHA_MAPPING"
      : key === "signals" ? "STALE_REFERENCE_ONLY_NOT_OCT1" : "OCT1_TARGET_UNEXECUTED",
    latestExecutableReferenceAllocation: !currentIsOct1 ? allocationData(chosen) : null,
    alphaCandidateDefinitions: key === "alpha" ? alphaPreparation?.candidates.map(c => ({ candidateId: c.candidateId, factorId: c.factorId, name: c.name,
      latestAvailableScheduledMapping: c.targetHistory.at(-1), definition: c.lineage.definition })) : undefined,
    terminalBacktestHoldings: terminal ? { date: terminal.date, nav: terminal.endingNav, cash: terminal.endingCash / terminal.endingNav,
      cashDollars: terminal.endingCash, assets: terminal.endingPositions.map(p => ({ ticker: p.ticker, weight: p.weight, quantity: p.quantity })) } : null,
    equity, annualReturns,
    actualDates: { ledgerStart: ledger[0]?.date ?? null, ledgerEnd: terminal?.date ?? null, firstTrade: trades[0]?.date ?? null, lastTrade: trades.at(-1)?.date ?? null,
      firstDecision: decisions[0]?.decisionDate ?? null, lastDecision: decisions.at(-1)?.decisionDate ?? null,
      firstInformationCutoff: decisions[0]?.informationCutoff ?? null, decisionCount: decisions.length, scheduledDecisionCount: result?.decisionCalendar?.length ?? null },
    totalCosts: result?.metrics ? { transactionCosts: result.metrics.totalTransactionCosts, slippage: result.metrics.totalSlippage,
      total: result.metrics.totalTransactionCosts + result.metrics.totalSlippage, externalTradedNotional: result.metrics.externalTradedNotional,
      turnoverConvention: result.metrics.turnoverConvention } : null,
    flags: { financialStatus: validation?.status ?? null, reconciliationStatus: validation?.reconciliationStatus ?? null,
      reproducibilityStatus: validation?.reproducibilityStatus ?? null, maximumReconciliationDifference: result?.diagnostics?.maximumReconciliationDifference ?? null,
      reconciliationTolerance: result?.diagnostics?.reconciliationTolerance ?? null, fullDecisionCalendar: result ? decisions.length === result.decisionCalendar?.length : false,
      noReplayRunForReport: true,
      pointInTimeEstimationDates: decisions.length ? decisions.every(d => d.estimationDates.every(date => date <= d.informationCutoff)) : null,
      currentConstraintsSatisfied: chosen?.status === "SOLVED" ? chosen.result.totalCash >= 0.1 - 1e-8 && chosen.result.totalCash <= 0.2 + 1e-8 &&
        Object.values(chosen.result.assetWeights).every(weight => weight >= -1e-8 && weight <= 0.3 + 1e-8) : null,
      currentAllocationSumResidual: chosen?.status === "SOLVED" ? Math.abs(Object.values(chosen.result.assetWeights).reduce((sum, value) => sum + value, 0) + chosen.result.totalCash - 1) : null,
      sameDatasetHash: key === "alpha" ? alphaPreparation?.snapshot.dataset.sha256 === freeze.datasetHash : source.snapshot.dataset.sha256 === freeze.datasetHash,
      sameFrozenFactorHash: key === "alpha" ? factorHash(alphaPreparation.snapshot) === freeze.factorSetHash : factorHash(source.snapshot) === freeze.factorSetHash,
      historicalTargetConstraintsSatisfied: decisions.length ? decisions.every(d =>
        d.totalCash >= 0.1 - 1e-8 && d.totalCash <= 0.2 + 1e-8 &&
        Object.values(d.targetAssetWeights).every(w => w >= -1e-8 && w <= 0.3 + 1e-8)) : null,
      historicalMaximumSolverConstraintViolation: decisions.length ? Math.max(...decisions.map(d => d.optimizer.solver.maxConstraintViolation ?? 0)) : null,
      ledgerCostSumDifference: ledger.length && result?.metrics ? Math.abs(ledger.reduce((sum, row) => sum + row.transactionCosts + row.slippage, 0)
        - result.metrics.totalTransactionCosts - result.metrics.totalSlippage) : null,
    },
    currentSolverDiagnostics: chosen?.result?.solver ?? null,
    error: result?.reason ?? result?.diagnostic ?? job?.error ?? chosen?.result?.reason ?? (key === "alpha" ? "B1 returned HTTP422 during 313MB frozen-snapshot database insertion. API omits underlying database-driver cause." : null),
    failureDate: result?.failureDate ?? null,
    originalOct1Attempt: original ? { allocationId: original.id, status: original.status, reason: original.result?.reason } : null,
    previousAttempts,
    limitations: result?.diagnostics?.limitations ?? [],
    rawResponses: chosen ? { allocation: `${key}${suffix}-allocation.response.json`, validation: validation ? `${key}${suffix}-validation.response.json` : null }
      : { preparationError: "error-summary.json", request: "alpha-preparation.request.json" },
  });
}
const summary = {
  generatedAt: new Date().toISOString(), period: { start: "2016-10-01", end: "2026-09-30" },
  asOf: { informationCutoff: "2026-09-30", decisionTimestamp: "2026-10-01T00:00:00Z", targetOnly: true },
  universe: freeze.universe, exclusions: freeze.coverage.filter(c => !c.eligible), eligibilityRule: freeze.eligibilityRule,
  assumptions: freeze.assumptions, provenance: { status: "UNVERIFIED_VENDOR", note: freeze.provenance, datasetId: freeze.datasetId,
    datasetHash: freeze.datasetHash, factorSetVersion: freeze.factorSetVersion, factorSetHash: freeze.factorSetHash, sourceCoverage: [freeze.datasetStart, freeze.datasetEnd] },
  strategyComparability: [
    "Assets and Signals share the same 20 underlying assets, CAPITAL_LONG_ONLY, regularized_mean_variance, explicit cash10–20% and ETF cap30%; no target-nine-holdings constraint implemented.",
    "Ridge selected factors are explicitly listed in strategy config (original seven-factor attempt; bounded recovery momentum+mean_reversion), lambda1, training252/min60, HAC0, next_close. SIGNAL_RIDGE is an asset_returns forecast, not a raw-signal capital allocation.",
    "B1 alpha streams incur standalone10bps fees+5bps slippage. CAPITAL_LONG_ONLY B2 estimates gross stream returns by adding those ledger costs back; B3 executes and charges the consolidated underlying book. Do not add B1 hypothetical sleeve costs a second time to B3 realized costs.",
    "Actual A1/B3 fee convention is 10bps+5bps on one-way turnover defined as HALF the sum of absolute consolidated target-weight changes, not on the sum of absolute fill notionals. Preserve the engine's dollar ledger costs; they are not a literal 15bps brokerage charge on every buy and sell dollar.",
    "The original seven-stream plan included oriented zero-threshold volatility/drawdown streams that can remain all cash. Two-factor recovery is a distinct disclosed model, not the original seven-factor model.",
    "Current targets are unexecuted policy outputs; terminal backtest holdings are separate. Current Ridge Oct1 next_close is unavailable because the dataset ends Sep30. Any stale reference is explicitly dated.",
    "Alpha B2's Sep30-cutoff output uses its latest saved scheduled mapping (Sep1 signal, Aug31 cutoff, Sep2 execution), not newly computed Oct1 alpha mappings. This is an as-of optimization over saved mapping history; do not label it a fresh Oct1 signal construction or an executed trade.",
    "Benchmark series, when present, is gross buy-and-hold SPY from the first ledger interval-start close, normalized to100000, without benchmark fees; not an independently executed SPY ledger.",
  ],
  metricDefinitions: { returnUnits: "decimal (multiply by100 for percent)", currency: "USD", annualizedReturn: "Engine annualization, see metrics.annualizationConvention",
    sharpe: "Engine daily-return Sharpe with daily cash yield0; see engine convention", drawdown: "nav / running maximum including initial100000 -1", annualReturns: "Derived from actual beginning/ending daily ledger NAV, not synthetic estimates" },
  recoveryPlan: await read("recovery-plan.json"), changedCommonAssumptions: await read("gamma100-common-recovery.json") ?? await read("gamma10-common-recovery.json"),
  changedFactorSelection: await read("factor-count-recovery.json"),
  priorPreparationError: await read("error-summary.json"),
  recoveryExecutionNote: "Final gamma100 jobs were submitted once each with stable idempotency keys after the owning agent explicitly authorized queueing behind the running gamma10 Ridge job. Worker queue preserves sequential execution; queued is not completed.",
  strategies,
};
await fs.writeFile(path.join(DIR, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ summary: "reports/oct2026-backtests/summary.json", strategies: strategies.map(s => ({ key: s.key, status: s.status, ids: s.ids, currentAllocationStatus: s.currentAllocationStatus })) }));