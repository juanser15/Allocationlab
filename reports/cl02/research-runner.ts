import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  computeRegime, defaultBacktestConfig, generateRebalanceDates, parseCsv,
  resolveExecutionDate, runBacktestEngine, type BacktestLedgerEntry, type PriceRow,
} from "../../artifacts/api-server/src/lib/calculator";

// Research adapter only: explicit SPY targets, actual corrected production ledger.
const dir = "reports/cl02";
const source = "reports/oct2026-backtests/assets-preparation.response.json";
const configuration = "reports/oct2026-legacy-sector-diagnostic/configuration-snapshot.json";
const freeze = "reports/oct2026-backtests/freeze.json";
const read = (p: string) => readFileSync(p, "utf8");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const json = (p: string) => JSON.parse(read(p));
const save = (p: string, value: string) => {
  if (existsSync(p)) assert.equal(read(p), value, `Refuse to overwrite different artifact: ${p}`);
  else writeFileSync(p, value);
};
const saveJson = (p: string, value: unknown) => save(p, JSON.stringify(value, null, 2) + "\n");
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs: number[]) => Math.sqrt(xs.reduce((s, x) => s + (x - mean(xs)) ** 2, 0) / (xs.length - 1));
const near = (a: number, b: number, label: string) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= 1e-8, `${label}: ${a} vs ${b}`);
const csv = (records: Record<string, unknown>[]) => {
  const keys = Object.keys(records[0]);
  const cell = (v: unknown) => JSON.stringify(typeof v === "object" ? JSON.stringify(v) : String(v ?? ""));
  return keys.map(cell).join(",") + "\n" + records.map(r => keys.map(k => cell(r[k])).join(",")).join("\n") + "\n";
};

mkdirSync(dir, { recursive: true });
const dataset = json(source).snapshot.dataset;
assert.equal(sha(dataset.csvContent), dataset.sha256, "frozen CSV hash");
const prices = parseCsv(dataset.csvContent);
assert.equal(new Set(prices.map(r => r.date)).size, prices.length, "unique dates");
assert.ok(prices.every(r => Number.isFinite(r.prices.SPY) && r.prices.SPY > 0));
const settingsSnapshot = json(configuration);
const reference = settingsSnapshot.universe.etfs.filter((e: any) => e.enabled).map((e: any) => e.ticker) as string[];
const assumptions = json(freeze).assumptions;
const defaults = defaultBacktestConfig();
const cashMin = settingsSnapshot.constraints.cashMin, cashMax = settingsSnapshot.constraints.cashMax;
const cashExpression = "clamp(cashMin + (cashMax - cashMin) * 0.5 + ((50 - regime.composite) / 50) * (cashMax - cashMin) * 0.5, cashMin, cashMax)";
assert.ok(read("artifacts/api-server/src/lib/calculator.ts").includes(cashExpression), "adapter matches exact current cash expression");
const warmup = defaults.warmupDays;
const end = assumptions.evaluationEndDate;
const rows = prices.filter(r => r.date <= end);
const full = (r: PriceRow) => reference.every(t => Number.isFinite(r.prices[t]) && r.prices[t] > 0);
// Coverage alone determines clipping. No performance is computed in --prepare.
const monthly = generateRebalanceDates(rows, "monthly", warmup, assumptions.evaluationStartDate);
const start = monthly.find(date => {
  const i = rows.findIndex(r => r.date === date);
  return rows.slice(i - warmup, i).length === warmup && rows.slice(i - warmup, i).every(full);
});
assert.ok(start, "no documented-window segment with complete reference warmup");
const signalDates = generateRebalanceDates(rows, "monthly", warmup, start);
const firstIndex = rows.findIndex(r => r.date === start);
assert.ok(rows.slice(firstIndex - warmup).every(full), "no reference gaps in selected warmup/evaluation segment");
const targets = signalDates.map(signalDate => {
  const available = rows.filter(r => r.date < signalDate);
  const regime = computeRegime(available, reference);
  const cash = Math.max(cashMin, Math.min(cashMax, cashMin + (cashMax - cashMin) * 0.5 +
    ((50 - regime.composite) / 50) * (cashMax - cashMin) * 0.5));
  return { signalDate, informationCutoff: available.at(-1)!.date,
    informationRows: available.length, informationSha256: sha(JSON.stringify(available)),
    executionDate: resolveExecutionDate(rows, signalDate, "next_close"),
    referenceUniverse: reference, regime, cashTarget: cash, SPY: 1 - cash };
});
const bySignal = new Map(targets.map(t => [t.signalDate, t]));
const baselineDate = rows[firstIndex - 1].date;
const firstExecution = targets[0].executionDate!;
let postCloseTarget = 0;
const temporalTargets = rows.slice(firstIndex).map(r => {
  const fill = targets.find(t => t.executionDate === r.date);
  if (fill) postCloseTarget = fill.SPY;
  return { date: r.date, targetSPY: postCloseTarget };
});
const controlExposure = mean(temporalTargets.filter(r => r.date >= firstExecution).map(r => r.targetSPY));
const protectedFiles = ["artifacts/api-server/src/lib/calculator.ts", "artifacts/api-server/src/lib/factor-library.ts",
  "artifacts/api-server/src/lib/d6-trace.ts", "artifacts/api-server/src/lib/calculator.a1.db-shim.ts",
  "artifacts/api-server/src/lib/calculator.a1.test.ts", "artifacts/api-server/src/lib/calculator.cl01.test.ts",
  "artifacts/api-server/src/lib/calculator.cl01-regressions.test.ts", "reports/CL01_capital_layer.md",
  "package.json", "artifacts/api-server/package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml",
  `${dir}/research-runner.ts`, `${dir}/render.py`, source, configuration, freeze,
  "reports/oct2026-equity-real/AB-prep.response.json", "reports/oct2026-equity-real/live-refresh.response.json",
  `${dir}/checkpoint.branch.txt`, `${dir}/checkpoint.commit.txt`, `${dir}/checkpoint.status.txt`, `${dir}/checkpoint.calculator.patch`];
const coverage = reference.map(ticker => {
  const observed = rows.filter(r => Number.isFinite(r.prices[ticker]) && r.prices[ticker] > 0);
  return { ticker, first: observed[0]?.date, last: observed.at(-1)?.date,
    missingInFullSnapshot: rows.length - observed.length, missingInEvaluatedSegment: rows.slice(firstIndex - warmup).filter(r => !r.prices[ticker]).length };
});
const otherSPY = parseCsv(json("reports/oct2026-equity-real/AB-prep.response.json").snapshot.dataset.csvContent);
const observedSPY = new Map(otherSPY.map(r => [r.date, r.prices.SPY]));
const differences = rows.filter(r => observedSPY.has(r.date)).map(r => Math.abs(r.prices.SPY - observedSPY.get(r.date)!));
const manifestBody = {
  schema: "CL02-research-1", git: { repository: "juanser15/Allocationlab", cwd: process.cwd(),
    branch: read(`${dir}/checkpoint.branch.txt`).trim(),
    commit: read(`${dir}/checkpoint.commit.txt`).trim(),
    pendingAtFreeze: read(`${dir}/checkpoint.status.txt`),
    productionDiffSha256: sha(read(`${dir}/checkpoint.calculator.patch`)) },
  fileHashes: Object.fromEntries(protectedFiles.map(p => [p, sha(read(p))])),
  nodeVersion: process.version, dataset: { id: dataset.id, source, sha256: dataset.sha256,
    rows: rows.length, first: rows[0].date, last: rows.at(-1)!.date,
    adjustment: dataset.priceConvention, provenance: json(freeze).provenance,
    dividends: "embedded in adjusted-close claim; no separate dividend series or broker corporate-action verification",
    crossCheckSPY: { comparedRows: differences.length, maximumAbsoluteDifference: Math.max(...differences),
      against: "Yahoo-linked dataset 24 snapshot; does not verify provenance of other instruments" }, coverage },
  referenceUniverse: reference, operatedUniverse: ["SPY"],
  ruleB: { cashMin, cashMax, expression: cashExpression, regime: "production computeRegime on full enabled reference universe; no ETF selection" },
  protocol: { monthly: true, executionTiming: "next_close", informationCutoff: "row.date < signalDate",
    initialNav: assumptions.initialNav, initialCash: assumptions.initialNav, initialHoldings: {},
    allowShortPositions: false, leverage: false, d5GrossTradeCosts: true, turnoverCap: "not binding; explicit D5 targets",
    costScenariosBpsPerActualNotional: [0, 5], slippageBps: 0, warmupRows: warmup,
    warmupSource: "defaultBacktestConfig; all reference instruments require contiguous warmup",
    cashYield: { daily: assumptions.dailyCashYield, type: "constant research assumption recovered from freeze; no historical series" },
    sharpeReference: { daily: assumptions.dailyCashYield, label: "constant cash reference = 0, not measured historical risk-free rate" },
    requestedWindow: [assumptions.evaluationStartDate, end], windowSource: freeze,
    actualBaseline: baselineDate, firstSignal: start, firstExecution, end,
    clippingReason: "full 22-instrument reference warmup; XLC starts 2018-06-19; no substitution or reduced regime universe",
    previousAnalysis: "overlaps documented prior analyses; not a new holdout" },
  candidates: [
    { id: "A", status: "READY", definition: "constant target SPY=1, cash=0; monthly maintenance" },
    { id: "B", status: "READY", definition: "current cash rule; not identified as report V0" },
    { id: "B_control", status: "RETROSPECTIVE_CONTROL", constantExposure: controlExposure,
      meanDefinition: "trading-observation-weighted post-close B target, first execution through final close; not unweighted mean of monthly decisions",
      exAnte: false },
    { id: "C_V1", status: "BLOCKED", reason: "complete vol-managed definition absent, including k, volatility estimator/window and bounds; no parameters invented" },
    { id: "D_V3", status: "BLOCKED", reason: "complete trend definition absent, including signal window, thresholds and cash mapping" } ],
  searchScope: "bounded local reports/scripts/docs/attached text and seven existing committee/backtest PDFs; no complete V1/V3 recovered",
  metrics: { CAGR: "(endNAV/initialNAV)^(365.25/calendar_days)-1", volatility: "sample daily-return SD * sqrt(252)",
    Sharpe: "mean(daily_return-declared_daily_cash_reference)/sample_SD(excess)*sqrt(252)",
    targetExposure: "mean post-close target in ledger dates; waiting for first fill is zero",
    effectiveExposure: "mean beginning risky market value / beginning NAV; also export closing exposure",
    turnover: "sum actual absolute trade notional / pretrade NAV; includes initial entry, not half-L1 engine log",
    recovery: "date NAV regains the prior peak; pending if not regained by end; report all drawdown episodes" },
};
const manifestPath = `${dir}/manifest.json`;
// Pending filenames are not part of experiment identity, which is determined by content hashes.
const identity = sha(JSON.stringify({ ...manifestBody, git: { ...manifestBody.git, pendingAtFreeze: undefined } }));
if (existsSync(manifestPath)) assert.equal(json(manifestPath).manifestId, identity, "existing manifest differs: do not overwrite");
else {
  assert.equal(process.argv[2], "--prepare", "manifest must be frozen before performance");
  saveJson(manifestPath, { ...manifestBody, manifestId: identity, frozenAt: new Date().toISOString() });
}
save(`${dir}/adjusted-closes.csv`, dataset.csvContent);
saveJson(`${dir}/configuration.json`, settingsSnapshot);
saveJson(`${dir}/targets-B.json`, targets);
save(`${dir}/targets-B.csv`, csv(targets.map(t => ({ signalDate: t.signalDate, informationCutoff: t.informationCutoff,
  informationRows: t.informationRows, informationSha256: t.informationSha256, executionDate: t.executionDate,
  regimeComposite: t.regime.composite, targetSPY: t.SPY, cashTarget: t.cashTarget }))));
if (process.argv[2] === "--prepare") {
  console.log(JSON.stringify({ prepared: true, manifestId: identity, baselineDate, start, firstExecution, end, controlExposure, performanceCalculated: false }));
  process.exit(0);
}
assert.equal(process.argv[2], "--run");
const metrics: any[] = [];
const checks: any[] = [];
for (const candidate of ["A", "B", "B_control"]) for (const costBps of [0, 5]) {
  const id = `${candidate}_${costBps}bps`;
  const ledgerPath = `${dir}/${id}.ledger.jsonl`;
  const exposureTarget = (signalDate: string) => candidate === "A" ? 1 : candidate === "B" ? bySignal.get(signalDate)!.SPY : controlExposure;
  const explicitTargets = targets.map(t => ({ signalDate: t.signalDate, informationCutoff: t.informationCutoff,
    executionDate: t.executionDate, targetSPY: exposureTarget(t.signalDate), targetCash: 1 - exposureTarget(t.signalDate) }));
  save(`${dir}/${id}.targets.csv`, csv(explicitTargets));
  let ledger: BacktestLedgerEntry[];
  const reused = existsSync(ledgerPath);
  if (reused) ledger = read(ledgerPath).trim().split("\n").map(s => JSON.parse(s));
  else {
    const result = runBacktestEngine(rows, [{ ticker: "SPY", name: "SPY", sector: "Risk", priorWeight: 0, enabled: true }],
      { cashMin: 0, cashMax: 1, maxEtfWeight: 1, minEtfWeight: 0, minInclusionThreshold: 0, targetActiveEtfs: 1, diversificationEnabled: false },
      { ...defaults, rebalanceFrequency: "monthly", executionTiming: "next_close", startDate: start,
        transactionCostBps: costBps, slippageBps: 0, maxTurnoverPerRebalance: 1, cashYieldAnnual: 0 },
      null, undefined, (signalDate, available, context) => {
        const target = bySignal.get(signalDate)!;
        assert.ok(available.every(r => r.date < signalDate));
        assert.equal(available.at(-1)!.date, target.informationCutoff);
        assert.equal(sha(JSON.stringify(available)), target.informationSha256);
        assert.equal(context!.asOf, target.informationCutoff);
        return { SPY: exposureTarget(signalDate) };
      }, { initialNav: assumptions.initialNav, initialCash: assumptions.initialNav, initialHoldings: {},
        dailyCashYield: assumptions.dailyCashYield, allowShortPositions: false, d5GrossTradeCosts: true });
    assert.equal(result.hasSufficientData, true, result.insufficientReason ?? "");
    ledger = result.dailyLedger;
    save(ledgerPath, ledger.map(d => JSON.stringify(d)).join("\n") + "\n");
  }
  let nav = assumptions.initialNav, targetAtClose = 0, high = nav;
  const rowByDate = new Map(rows.map(r => [r.date, r]));
  const exported: any[] = [];
  let grossTurnover = 0, totalCosts = 0, totalTradedNotional = 0, invalidReason: string | null = null;
  try {
    assert.equal(ledger[0].intervalStart, baselineDate);
    assert.equal(ledger.at(-1)!.date, end);
    for (const day of ledger) {
      const previous = rowByDate.get(day.intervalStart)!, current = rowByDate.get(day.date)!;
      const oldQ = day.beginningPositions.reduce((s, p) => s + p.quantity, 0);
      const newQ = day.endingPositions.reduce((s, p) => s + p.quantity, 0);
      near(day.beginningNav, nav, "NAV continuity");
      near(day.etfPnl, oldQ * (current.prices.SPY - previous.prices.SPY), "prior-held P&L");
      near(day.cashPnl, day.beginningCash * assumptions.dailyCashYield, "cash interest");
      const notional = day.trades.reduce((s, t) => s + Math.abs(t.notional), 0);
      near(day.transactionCosts, notional * costBps / 10000, "actual-notional fees");
      near(day.slippage, 0, "no extra slippage");
      near(newQ, oldQ + day.trades.reduce((s, t) => s + t.quantity, 0), "share roll-forward");
      for (const trade of day.trades) {
        assert.equal(trade.ticker, "SPY");
        near(trade.notional, trade.quantity * current.prices.SPY, "fill-price notional");
      }
      near(day.endingCash, day.beginningCash + day.cashPnl - day.trades.reduce((s, t) => s + t.notional, 0) - day.transactionCosts, "cash book");
      near(day.endingNav, day.beginningNav + day.etfPnl + day.cashPnl - day.transactionCosts, "equity roll-forward");
      near(day.endingNav, day.endingCash + newQ * current.prices.SPY, "cash plus SPY");
      near(day.netPnl, day.endingNav - day.beginningNav, "net P&L");
      assert.ok(day.endingCash >= -1e-8 && newQ >= 0 && day.endingNav > 0, "no leverage or short");
      if (day.executionSignalDate) {
        assert.equal(day.date, bySignal.get(day.executionSignalDate)!.executionDate);
        targetAtClose = exposureTarget(day.executionSignalDate);
        near(newQ * current.prices.SPY / day.endingNav, targetAtClose, "target applied once; no binding cap");
      } else { assert.equal(day.trades.length, 0); near(newQ, oldQ, "held quantities"); }
      grossTurnover += notional / (day.beginningNav + day.etfPnl + day.cashPnl);
      totalCosts += day.transactionCosts;
      totalTradedNotional += notional;
      nav = day.endingNav; high = Math.max(high, nav);
      exported.push({ date: day.date, intervalStart: day.intervalStart, beginningNav: day.beginningNav,
        endingNav: nav, beginningCash: day.beginningCash, endingCash: day.endingCash,
        beginningPositions: day.beginningPositions, endingPositions: day.endingPositions, trades: day.trades,
        transactionCosts: day.transactionCosts, slippage: day.slippage, etfPnl: day.etfPnl, cashPnl: day.cashPnl,
        netPnl: day.netPnl, dailyReturn: nav / day.beginningNav - 1, targetSPY: targetAtClose,
        effectiveSPYBeginning: oldQ * previous.prices.SPY / day.beginningNav,
        effectiveSPYClose: newQ * current.prices.SPY / nav, drawdown: nav / high - 1 });
    }
  } catch (error) { invalidReason = String(error); }
  save(`${dir}/${id}.ledger.csv`, csv(exported));
  checks.push({ id, manifestId: identity, reusedLedger: reused, status: invalidReason ? "INVALID_NET_RESULT" : "PASS", invalidReason,
    checkedIntervals: exported.length, feeConvention: "actual absolute fill notional", costBps, slippageBps: 0 });
  if (invalidReason) { metrics.push({ id, status: "INVALID", invalidReason }); continue; }
  const curve = [{ date: baselineDate, nav: assumptions.initialNav }, ...exported.map(d => ({ date: d.date, nav: d.endingNav }))];
  let peak = curve[0], episode: any = null;
  const episodes: any[] = [];
  for (const point of curve.slice(1)) {
    if (point.nav >= peak.nav) {
      if (episode) { episode.recoveryDate = point.date; episode.pending = false; episodes.push(episode); episode = null; }
      peak = point;
    } else {
      if (!episode) episode = { peakDate: peak.date, peakNav: peak.nav, troughDate: point.date,
        troughNav: point.nav, drawdown: point.nav / peak.nav - 1, recoveryDate: null, pending: true };
      if (point.nav < episode.troughNav) { episode.troughNav = point.nav; episode.troughDate = point.date; episode.drawdown = point.nav / peak.nav - 1; }
    }
  }
  if (episode) episodes.push(episode);
  const worst = episodes.reduce((a, b) => b.drawdown < a.drawdown ? b : a, { drawdown: 0, recoveryDate: null, pending: false });
  const calendarDays = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;
  for (const e of episodes) {
    e.peakToRecoveryOrEndCalendarDays = calendarDays(e.peakDate, e.recoveryDate ?? end);
    e.troughToRecoveryOrEndCalendarDays = calendarDays(e.troughDate, e.recoveryDate ?? end);
    e.sessionsUnderwaterOrUntilRecovery = curve.filter(p => p.date > e.peakDate && p.date <= (e.recoveryDate ?? end)).length;
  }
  saveJson(`${dir}/${id}.drawdown-episodes.json`, episodes);
  const returns = exported.map(d => d.dailyReturn);
  const excess = returns.map(r => r - assumptions.dailyCashYield);
  metrics.push({ id, candidate, costBps, status: "VALID_CONDITIONAL_ON_SNAPSHOT", baselineDate, end, intervals: returns.length,
    initialNav: assumptions.initialNav, finalNav: nav,
    CAGR: (nav / assumptions.initialNav) ** (365.25 / calendarDays(baselineDate, end)) - 1,
    annualizedVolatility: sd(returns) * Math.sqrt(252), Sharpe: mean(excess) / sd(excess) * Math.sqrt(252),
    maxDrawdown: worst.drawdown, maxDrawdownPeak: worst.peakDate, maxDrawdownTrough: worst.troughDate,
    maxDrawdownRecovery: worst.recoveryDate, maxDrawdownRecoveryPending: worst.pending,
    maxDrawdownPeakToRecoveryOrEndCalendarDays: worst.peakToRecoveryOrEndCalendarDays,
    pendingEpisodes: episodes.filter(e => e.pending).length,
    meanTargetSPYAllLedgerCloses: mean(exported.map(d => d.targetSPY)),
    meanTargetSPYAfterFirstExecution: mean(exported.filter(d => d.date >= firstExecution).map(d => d.targetSPY)),
    meanEffectiveSPYBeginning: mean(exported.map(d => d.effectiveSPYBeginning)),
    meanEffectiveSPYClose: mean(exported.map(d => d.effectiveSPYClose)),
    grossTurnover, totalTradedNotional, totalCosts, costSumOverBeginningNAV: exported.reduce((s, d) => s + d.transactionCosts / d.beginningNav, 0) });
  console.log(`${id}: ${ledger.length} intervals; actual-notional fees/book/timing PASS${reused ? "; reused" : ""}`);
}
// Reused-ledger provenance flag is execution metadata, not experiment output identity.
saveJson(`${dir}/verification.json`, checks.map(({ reusedLedger, ...rest }) => rest));
saveJson(`${dir}/metrics.json`, metrics);
save(`${dir}/metrics.csv`, csv(metrics));
const comparisons = [0, 5].flatMap(costBps => {
  const a = metrics.find(m => m.id === `A_${costBps}bps`), b = metrics.find(m => m.id === `B_${costBps}bps`), c = metrics.find(m => m.id === `B_control_${costBps}bps`);
  return [{ costBps, contrast: "B minus A", CAGR_difference: b.CAGR - a.CAGR, maxDrawdown_difference: b.maxDrawdown - a.maxDrawdown,
    finalNav_relative_difference: b.finalNav / a.finalNav - 1, totalCosts_difference: b.totalCosts - a.totalCosts },
  { costBps, contrast: "B minus retrospective equal-target-mean control", CAGR_difference: b.CAGR - c.CAGR,
    maxDrawdown_difference: b.maxDrawdown - c.maxDrawdown, finalNav_relative_difference: b.finalNav / c.finalNav - 1,
    totalCosts_difference: b.totalCosts - c.totalCosts }];
});
saveJson(`${dir}/comparisons.json`, comparisons);
assert.ok(checks.every(c => c.status === "PASS"), "invalid net result: do not publish performance");
console.log(JSON.stringify({ manifestId: identity, runs: metrics.length, intervalsPerRun: metrics[0].intervals, allVerified: true }));
