import assert from "node:assert/strict";
import type { BacktestLedgerEntry } from "../../artifacts/api-server/src/lib/calculator";
import type { Campaign } from "../capital/spec";
import type { Ranked } from "../capital/metrics";
import { select } from "../capital/metrics";

export const TOTAL_V1 = "TOTAL_TURNOVER_INCLUDING_INITIAL_V1" as const;
export const RECURRING_V2 = "RECURRING_TURNOVER_EXCLUDING_INITIAL_V2" as const;
export const TURNOVER_TOLERANCE = 1e-10;
export type TurnoverMethodology = typeof TOTAL_V1 | typeof RECURRING_V2;

/** Actual certified self-financing fills / same-day pre-cost NAV. The first
 * nonzero actual implementation fill is identified once per independent book.
 * Zero-target decisions do not manufacture an implementation trade. */
export function ledgerTurnover(ledger: BacktestLedgerEntry[], observations: number, costBps: number) {
  assert.ok(Number.isSafeInteger(observations) && observations > 0 && ledger.length === observations, "Annualization uses every observed ledger row, including entry and no-trade days");
  let initial = 0, recurring = 0, total = 0, initialCost = 0, recurringCost = 0, entered = false;
  let firstDate: string | null = null, recurringTrades = 0;
  for (const day of ledger) {
    const notional = day.trades.reduce((s, t) => s + Math.abs(t.notional), 0);
    const nav = day.beginningNav + day.etfPnl + day.cashPnl;
    assert.ok(nav > 0 && Number.isFinite(nav) && notional >= 0 && Number.isFinite(notional));
    const turnover = notional / nav;
    assert.ok(Math.abs(day.transactionCosts - notional * costBps / 10000) <= TURNOVER_TOLERANCE * Math.max(1, day.transactionCosts), "All actual fills, including implementation, remain costed");
    total += turnover;
    if (!entered && notional > 0) {
      initial = turnover; initialCost = day.transactionCosts; entered = true; firstDate = day.date;
    } else {
      recurring += turnover; recurringCost += day.transactionCosts;
      if (notional > 0) recurringTrades++;
    }
  }
  assert.ok(Math.abs(total - initial - recurring) <= TURNOVER_TOLERANCE * Math.max(1, total));
  const realized = ledger.reduce((s, d) => s + d.transactionCosts, 0);
  assert.ok(Math.abs(realized - initialCost - recurringCost) <= TURNOVER_TOLERANCE * Math.max(1, realized));
  return {
    initial_implementation_turnover: initial, recurring_gross_turnover: recurring, total_gross_turnover: total,
    annualized_total_turnover: total * 252 / observations,
    annualized_recurring_turnover: recurring * 252 / observations,
    annualization_observations: observations, annualization_trading_days: 252,
    initial_implementation_date: firstDate, recurring_trade_days: recurringTrades,
    initial_implementation_cost: initialCost, recurring_simulated_cost: recurringCost, realized_simulated_cost: realized,
    warnings: recurringTrades === 0 ? ["NO_RECURRING_REBALANCE_OBSERVED"] : [],
    recurring_turnover_interpretation: recurringTrades === 0
      ? "The training interval contains no portfolio change after initial implementation, so the recurring-turnover constraint is not informative for this candidate."
      : "Recurring turnover measures actual subsequent traded notional using the full observed interval.",
  };
}
export type TurnoverEvidence = ReturnType<typeof ledgerTurnover>;
export function turnoverConstraint(evidence: TurnoverEvidence, limit: number, methodology: TurnoverMethodology) {
  const metric = methodology === TOTAL_V1 ? "annualized_total_turnover" : "annualized_recurring_turnover";
  return { ...evidence, turnover_constraint_limit: limit, turnover_constraint_metric: metric,
    turnover_constraint_methodology_version: methodology,
    turnover_constraint_status: evidence[metric] <= limit ? "ELIGIBLE" : "CONSTRAINT_REJECTED" };
}

/** Only eligibility's turnover numerator changes. Certified score, all other
 * constraints and the original TOTAL-turnover tie break remain exact. */
export function selectRecurring(c: Campaign, candidates: Ranked[], jobs: Array<{ candidate_id: string; outer_fold: number; stage: string; scenario: number; status: string; ledger: BacktestLedgerEntry[]; observations: unknown[] }>, foldId: number) {
  const evidence = new Map<string, ReturnType<typeof turnoverConstraint>>();
  for (const x of candidates) {
    const job = jobs.find(j => j.outer_fold === foldId && j.stage === "train" && j.scenario === c.selection_cost_bps && j.candidate_id === x.candidate.candidate_id);
    if (job?.status === "VALID" && x.metrics) {
      const decomposition = ledgerTurnover(job.ledger, job.observations.length, c.selection_cost_bps);
      assert.ok(Math.abs(decomposition.total_gross_turnover - x.metrics.turnover) <= TURNOVER_TOLERANCE * Math.max(1, x.metrics.turnover));
      evidence.set(x.candidate.candidate_id, turnoverConstraint(decomposition, c.constraints.max_turnover!, RECURRING_V2));
    }
  }
  // Let certified select apply score/exposure/drawdown with turnover disabled
  // here only; explicitly apply the unchanged limit to recurring turnover below.
  const { max_turnover: _totalLimit, ...otherConstraints } = c.constraints;
  const base = select({ ...c, constraints: otherConstraints }, candidates);
  for (const x of base.ranking) {
    const e = evidence.get(x.candidate.candidate_id);
    if (x.status === "VALID" && (!e || e.turnover_constraint_status !== "ELIGIBLE")) {
      x.status = "CONSTRAINT_REJECTED"; x.reason = "Recurring turnover exceeds predeclared constraint"; delete x.score;
    }
    delete x.rank;
  }
  const eligible = base.ranking.filter(x => x.status === "VALID").sort((a, b) => b.score! - a.score! || a.metrics!.turnover_annualized - b.metrics!.turnover_annualized || a.complexity - b.complexity || a.candidate.candidate_id.localeCompare(b.candidate.candidate_id));
  eligible.forEach((x, i) => { x.rank = i + 1; });
  return { winner: eligible[0], ranking: base.ranking, turnover_evidence: Object.fromEntries(evidence) };
}
