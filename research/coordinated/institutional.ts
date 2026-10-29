import assert from "node:assert/strict";
import { SUPPORT_TOLERANCE, CONSTRAINT_TOLERANCE, PORTFOLIO_CONSTRAINT_SCOPE } from "../../artifacts/api-server/src/lib/workbench/portfolio-numerics";
import { runCoordinated } from "./engine";
import { remuneratedLedger } from "../workbench/institutional-ledger";
import { hash } from "../capital/spec";
import { summarize, type Observation } from "../capital/metrics";
import { cashIntervals, parseInstitutional, INSTITUTIONAL_VERSION } from "../../artifacts/api-server/src/lib/workbench/institutional-contract";
import { CalendarContractError } from "../../artifacts/api-server/src/lib/workbench/calendar-v2";
import type { P0Spec, P0Dataset } from "../../artifacts/api-server/src/lib/workbench/p0-calendar";
import { engineRequest, planP0WithData, requestFromP0Spec } from "../../artifacts/api-server/src/lib/workbench/p0-calendar";
import { qualityObserver, STRUCTURAL_POLICY, QUALITY_POLICY_HASH } from "./quality";

export function institutionalMetrics(points: Observation[], cash: Map<string, number>) {
  const base = summarize(points, 0);
  const excess = points.map(p => {
    const r = cash.get(p.date);
    if (r === undefined) throw new Error("Cash benchmark alignment missing");
    return p.net_return - r;
  });
  const first = excess[0], delta = excess.map(x => x - first), meanDelta = delta.reduce((s, x) => s + x, 0) / delta.length;
  const variance = delta.length > 1 ? delta.reduce((s, x) => s + (x - meanDelta) ** 2, 0) / (delta.length - 1) : 0;
  return { ...base, net_sharpe: variance > 0 ? (first + meanDelta) / Math.sqrt(variance) * Math.sqrt(252) : null };
}
export function validateTargets(date: string, targets: Record<string, number>, request: ReturnType<typeof requestFromP0Spec>, benchmark = false, targetScope: "STRATEGIC" | "EFFECTIVE_CAPITAL" = "STRATEGIC") {
  const weights = Object.values(targets), active = weights.filter(w => w > SUPPORT_TOLERANCE), exposure = weights.reduce((s, w) => s + w, 0);
  const cash = 1 - exposure, m = request.mandate;
  const construction = targetScope === "STRATEGIC";
  const explicitAllCash = weights.length > 0 && weights.every(w => w === 0);
  const study = request.research_scope === "CAPITAL_EXPOSURE";
  const within = weights.every(w => Number.isFinite(w) && w >= -1e-10) && exposure <= 1 + 1e-8 && cash >= -1e-8;
  const cap = benchmark || request.control_mode !== "MAX_EXPOSURE" ? 1 : request.maximum_exposure;
  const allowed = benchmark || study ? ["SPY"] : request.etfs;
  const checks = {
    self_financing_long_only: within,
    candidate_universe: Object.keys(targets).every(t => allowed.includes(t)),
    maximum_exposure: exposure <= cap + 1e-8,
    ...(construction ? {
      maximum_weight: benchmark || study || weights.every(w => w <= request.maximum_etf_weight + 1e-8),
      holding_count: !m || benchmark || explicitAllCash || (active.length >= m.minimum_positions && active.length <= m.maximum_positions),
      minimum_weight: !m || benchmark || active.every(w => w >= m.minimum_weight - CONSTRAINT_TOLERANCE),
    } : {}),
  };
  const evidence = { decision_date: date,
    ...(m ? { nav_target_weights: { ...targets } } : {}),
    ...(!construction && m ? { construction_floor_deviation_due_to_overlay: Math.max(0, ...active.map(w => m.minimum_weight - w)), construction_deviation_informational_only: true } : {}),
    passed: Object.values(checks).every(Boolean), checks, exposure, cash, positions: active.length, scope: targetScope === "EFFECTIVE_CAPITAL" ? "EFFECTIVE_TARGET_EXECUTION_SAFETY_ONLY" : m ? PORTFOLIO_CONSTRAINT_SCOPE : "DECISION_TARGETS_NOT_POST_TRADE_DRIFT", ...(construction ? {} : { construction_limits_not_reapplied: ["minimum_weight", "maximum_weight", "holding_count"] }), tolerance: CONSTRAINT_TOLERANCE };
  if (!evidence.passed) {
    // This is an assertion/audit gate. Mandates are constructed inside the
    // optimizer; an escaped breach is a numerical/integration defect, not a request to repair weights.
    const n = (x: number) => `${Number((x * 100).toFixed(4))}%`;
    const conflict =
      construction && !checks.holding_count
        ? { message: `The optimizer produced ${active.length} holdings; the final-holdings mandate requires ${m!.minimum_positions}–${m!.maximum_positions}. Adjust the holdings mandate or candidate selection.`,
            fields: ["mandate.minimum_positions", "mandate.maximum_positions", "etfs"] }
        : construction && !checks.minimum_weight
          ? { message: `An optimized asset weight is below the ${n(m!.minimum_weight)} minimum per held asset. Lower the minimum weight or change the candidate selection; weights were not raised automatically.`,
              fields: ["mandate.minimum_weight", "etfs"] }
          : construction && !checks.maximum_weight
            ? { message: `An optimized asset exceeds the ${n(request.maximum_etf_weight)} maximum weight per asset. No weights were published.`,
                fields: ["maximum_etf_weight"] }
            : !checks.maximum_exposure
              ? { message: `Optimized exposure (${n(exposure)}) exceeds the ${n(cap)} exposure ceiling. No weights were published.`,
                  fields: ["maximum_exposure"] }
              : { message: "Calculated targets violate the frozen mandate's long-only, funding or candidate-universe rules. No fallback, floor uplift or redistribution was applied.",
                  fields: ["etfs"] };
    throw new CalendarContractError("NUMERICAL_FAILURE", "Post-solve mandate audit failed. No portfolio was published. " + conflict.message, { category: "NUMERICAL_FAILURE", reason: "MANDATE_AUDIT_FAILURE", ...evidence, fields: conflict.fields }, 422);
  }
  return evidence;
}
/** Independent reconciliation: this observes the ledger, it does not alter fills. */
export function reconcileLedger(ledger: any[], cash: Map<string, number>, feeBps: number, slippageBps: number) {
  let maxError = 0;
  const close = (actual: number, expected: number, name: string) => {
    assert.ok(Number.isFinite(actual) && Number.isFinite(expected), `${name}: finite values`);
    const error = Math.abs(actual - expected); maxError = Math.max(maxError, error);
    assert.ok(error <= 1e-8 * Math.max(1, Math.abs(expected)), name);
  };
  for (const day of ledger) {
    const gross = day.trades.reduce((s: number, t: any) => s + Math.abs(t.notional), 0);
    close(day.cashPnl, day.beginningCash * cash.get(day.date)!, "Beginning cash earns exactly the declared interval return");
    close(day.transactionCosts, gross * feeBps / 10000, "Fees use actual gross fill notional");
    close(day.slippage, gross * slippageBps / 10000, "Slippage uses actual gross fill notional");
    close(day.endingCash, day.beginningCash + day.cashPnl - day.trades.reduce((s: number, t: any) => s + t.notional, 0) - day.transactionCosts - day.slippage, "Cash reconciliation");
    close(day.endingNav, day.beginningNav + day.etfPnl + day.cashPnl - day.transactionCosts - day.slippage, "NAV reconciliation");
    close(day.endingNav, day.endingCash + day.endingPositions.reduce((s: number, p: any) => s + p.marketValue, 0), "Book reconciliation");
    assert.ok(day.endingNav > 0 && day.endingCash >= -1e-8 && day.endingPositions.every((p: any) => p.quantity >= 0), "No leverage or short positions");
    if (!day.executionSignalDate) assert.equal(day.trades.length, 0, "No implicit drift trades");
    else assert.ok(day.executionSignalDate < day.date, "Execution follows signal");
  }
  return { passed: true, observations: ledger.length, maximum_absolute_residual: maxError, tolerance: "1e-8 relative to expected amount", cost_basis: "ABSOLUTE_TRADED_NOTIONAL" };
}
export function runInstitutional(spec: P0Spec, data: P0Dataset, progress: (p: any) => void = () => {}, dependencies: Parameters<typeof runCoordinated>[5] = {}) {
  const request = requestFromP0Spec(spec), financial = parseInstitutional(request);
  const plan = planP0WithData(request, data), intervals = cashIntervals(data.rows, plan.folds[0].decision_date, request.evaluation_end_exclusive,financial.cash_policy);
  const mandates: any[] = [], capitalTargets: any[] = [], study = request.research_scope === "CAPITAL_EXPOSURE";
  const quality = qualityObserver(request.quality_control?.enabled ?? false);
  let call = 0;
  const runner: typeof import("../workbench/interactive-ledger").runScheduledLedger = (...args) => {
    const benchmark = call++ > 0;
    return remuneratedLedger(intervals, financial.slippage_bps, (date, weights) => {
      if (!benchmark && request.mandate) capitalTargets.push(validateTargets(date, weights, request, false, "EFFECTIVE_CAPITAL"));
      else if (!benchmark) mandates.push(validateTargets(date, weights, request));
      else validateTargets(date, weights, request, true);
    })(...args);
  };
  const result = runCoordinated({ ...spec, ...engineRequest(request) }, data, progress, runner, study ? undefined : quality.observe, {
    ...dependencies,
    ...(request.mandate ? { onStrategicTargets: (date: string, weights: Record<string, number>) => {
      mandates.push(validateTargets(date, weights, request));
      dependencies.onStrategicTargets?.(date, weights);
    } } : {}),
  });
  if (request.mandate) assert.equal(mandates.length, plan.number_of_folds, "One strategic construction audit per scheduled rebalance");
  if (!study) assert.equal(quality.decisions.length, plan.number_of_folds, "Exactly one Quality Control evaluation per rebalance");
  result.metrics = institutionalMetrics(result.points, intervals);
  const accounting = reconcileLedger(result.ledger, intervals, request.transaction_cost_bps, financial.slippage_bps);
  if (result.benchmark) {
    result.benchmark.metrics = institutionalMetrics(result.benchmark.points, intervals);
    reconcileLedger(result.benchmark.ledger, intervals, request.transaction_cost_bps, financial.slippage_bps);
  }
  const cashPoints = result.points.map(p => ({ ...p, net_return: intervals.get(p.date)!, turnover: 0, costs: 0, exposure: 0 }));
  const cashReference = { label: "Cash · 0% return", metrics: institutionalMetrics(cashPoints, intervals) };
  const evidence = {
    ...result, methodology_version: INSTITUTIONAL_VERSION,
    accounting: { ...result.accounting, cash_yield: "ZERO_RETURN", cash_policy: financial.cash_policy, cash_proxy_semantics: "Cash earns exactly 0% on every observed interval. No SGOV prices or yields are required or used for cash accrual.", slippage_bps: financial.slippage_bps },
    metrics_convention: { sharpe: "Mean portfolio net return minus zero cash return, divided by sample standard deviation of those excess returns, multiplied by sqrt(252). Undefined when variance is zero.", volatility: "Portfolio net-return sample standard deviation, annualized sqrt(252); not excess-return volatility.", annualization: "252 observed sessions; not calendar-year CAGR.", turnover: "Gross actual fill notional / pretrade NAV inclusive of cash income.", benchmark: "Passive SPY: identical dates, initial cash, first next-close fill and fee/slippage conventions." },
    cash_reference: cashReference,
    mandate_evidence: mandates,
    ...(request.mandate ? { capital_target_evidence: capitalTargets, construction_constraint_scope: PORTFOLIO_CONSTRAINT_SCOPE } : {}),
    capital_gate: study ? { status: "ISOLATED_COMPOSITION_VERIFIED", fixed_risk_asset: "SPY", optimizer: "NONE", quality_gate: "NOT_USED_CAPITAL_ONLY", fallback: "NONE", policy: request.regime_model, response: request.regime_response } : { status: "COORDINATED_CAPITAL_AND_PORTFOLIO", fixed_risk_asset: null, optimizer: request.mandate ? "CARDINALITY_AWARE_CONSTRAINED_SUPPORT_SEARCH" : "EXISTING_CONVENTIONAL_OPTIMIZER", fallback: "NONE", policy: request.regime_model, response: request.regime_response },
    quality_gate_evidence: study ? { status: "NOT_REQUIRED_CAPITAL_ONLY", every_rebalance: false, reason: "Fixed SPY sleeve; no ETF ranking, PCA gate or allocation optimizer is consumed." } : {
      enabled: request.quality_control!.enabled, policy_version: STRUCTURAL_POLICY.version, policy_hash: QUALITY_POLICY_HASH, policy: STRUCTURAL_POLICY,
      status: !request.quality_control!.enabled ? "OFF_OBSERVE_ONLY" : quality.decisions.some(d => d.warnings.length) ? "WARN" : "PASS",
      every_rebalance: quality.decisions.length === plan.number_of_folds,
      expected_rebalances: plan.number_of_folds, evaluated_rebalances: quality.decisions.length,
      decisions: quality.decisions, predictive_quality: STRUCTURAL_POLICY.predictive_quality,
    },
    validation_evidence: { accounting },
  };
  evidence.financial_result_hash = hash(JSON.parse(JSON.stringify({ metrics: evidence.metrics, points: evidence.points, decisions: evidence.decisions, accounting: evidence.accounting, benchmark: evidence.benchmark, mandate_evidence: mandates, quality_gate_evidence: evidence.quality_gate_evidence, methodology_version: INSTITUTIONAL_VERSION })));
  return evidence;
}
