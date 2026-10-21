/** Post-run controls only. Never imported by the dynamic campaign/worker. */
import { beta, type Pair } from "../allocation-core/risk-analytics/analytics";
export const BENCHMARK_METHODOLOGY_VERSION = "capital-exposure-controls-1.0.0";
export const BETA_MATCH_TOLERANCE = 1e-9;
export interface ControlDay {
  date: string;
  fold_id: number;
  market_return: number;
  cash_return: number;
  fold_offset: number;
  fold_last: boolean;
}
export interface ControlPoint extends ControlDay {
  net_return: number;
  index: number;
  drawdown: number;
  spy_exposure: number;
  cash_allocation: number;
  turnover: number;
  realized_cost: number;
  beginning_nav: number;
  ending_nav: number;
  target_exposure: number;
  actual_traded_notional: number;
}
export class AttributionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const ensure = (ok: unknown, message: string) => {
  if (!ok) throw new AttributionError("BENCHMARK_ACCOUNTING_FAILED", message);
};

/** Constant target lambda, all-cash signal day, next-close entry, then daily
 * close maintenance so subsequent beginning exposures really equal lambda.
 * No final maintenance trade or liquidation. Each fold starts with NAV/cash=100.
 * Passive lambda=1 has no maintenance turnover; it enters and holds. */
export function controlTrack(
  days: ControlDay[],
  lambda: number,
  costBps: number,
): ControlPoint[] {
  ensure(
    Number.isFinite(lambda) &&
      lambda >= 0 &&
      lambda <= 1 &&
      Number.isFinite(costBps) &&
      costBps >= 0,
    "Invalid control inputs.",
  );
  const k = costBps / 10000;
  if (k >= 1 && lambda > 0 && lambda < 1)
    throw new AttributionError(
      "MATCHED_BETA_MAINTENANCE_COST_UNSUPPORTED",
      "A daily constant-weight control cannot be certified at trading-cost rates of 100% or more; the dynamic result is preserved.",
    );
  let nav = 100,
    composite = 100,
    high = 100,
    previousFold = -1;
  return days.map((day) => {
    ensure(
      Number.isFinite(day.market_return) &&
        day.market_return > -1 &&
        Number.isFinite(day.cash_return) &&
        day.cash_return > -1,
      "Invalid aligned control returns.",
    );
    if (day.fold_id !== previousFold) {
      ensure(day.fold_offset === 0, "Incomplete fold start.");
      nav = 100;
      previousFold = day.fold_id;
    }
    const beginning = nav;
    const exposure = day.fold_offset < 2 ? 0 : lambda;
    const grossReturn =
      exposure * day.market_return + (1 - exposure) * day.cash_return;
    const preTradeNav = beginning * (1 + grossReturn);
    const oldRiskValue = beginning * exposure * (1 + day.market_return);
    let afterCost = preTradeNav,
      traded = 0;
    // Entry is required even if it happens to be the final observation, exactly
    // as in the certified next-close engine. Later terminal maintenance is omitted.
    const execute =
      day.fold_offset === 1 ||
      (day.fold_offset > 1 && !day.fold_last && lambda > 0 && lambda < 1);
    if (execute) {
      const buying = lambda * preTradeNav >= oldRiskValue;
      const denominator = 1 + (buying ? 1 : -1) * k * lambda;
      ensure(denominator > 0, "Control cannot fund its maintenance trade.");
      afterCost =
        (preTradeNav + (buying ? 1 : -1) * k * oldRiskValue) / denominator;
      traded = Math.abs(lambda * afterCost - oldRiskValue);
    }
    const cost = traded * k;
    ensure(
      afterCost > 0 && [afterCost, cost, traded].every(Number.isFinite),
      "Control costs exhausted or overflowed its sleeve.",
    );
    ensure(
      Math.abs(preTradeNav - cost - afterCost) <=
        1e-9 * Math.max(1, preTradeNav),
      "Control self-financing identity failed.",
    );
    const netReturn = grossReturn - cost / beginning;
    nav = beginning * (1 + netReturn);
    composite *= 1 + netReturn;
    high = Math.max(high, composite);
    return {
      ...day,
      net_return: netReturn,
      index: composite,
      drawdown: composite / high - 1,
      spy_exposure: exposure,
      cash_allocation: 1 - exposure,
      turnover: traded / preTradeNav,
      realized_cost: cost,
      beginning_nav: beginning,
      ending_nav: nav,
      target_exposure: lambda,
      actual_traded_notional: traded,
    };
  });
}
const evaluate = (p: number[], x: number) =>
  p.reduceRight((s, c) => s * x + c, 0);
function polynomialRoots(
  coefficients: number[],
  lower = 0,
  upper = 1,
): number[] {
  const p = [...coefficients];
  while (p.length > 1 && p.at(-1) === 0) p.pop();
  if (p.length <= 1) return [];
  if (p.length === 2) {
    const x = -p[0] / p[1];
    return x >= lower && x <= upper ? [x] : [];
  }
  const critical = polynomialRoots(
    p.slice(1).map((c, i) => c * (i + 1)),
    lower,
    upper,
  );
  const boundaries = [
    lower,
    ...critical.filter((x) => x > lower && x < upper),
    upper,
  ].sort((a, b) => a - b);
  const tolerance =
    128 * Number.EPSILON * Math.max(...p.map(Math.abs), Number.MIN_VALUE);
  const roots = boundaries.filter((x) => Math.abs(evaluate(p, x)) <= tolerance);
  for (let i = 1; i < boundaries.length; i++) {
    let a = boundaries[i - 1],
      b = boundaries[i],
      fa = evaluate(p, a),
      fb = evaluate(p, b);
    if (fa * fb >= 0) continue;
    for (let n = 0; n < 80; n++) {
      const m = (a + b) / 2,
        fm = evaluate(p, m);
      if (Math.sign(fa) === Math.sign(fm)) {
        a = m;
        fa = fm;
      } else {
        b = m;
        fb = fm;
      }
    }
    roots.push((a + b) / 2);
  }
  return [...new Set(roots)].sort((a, b) => a - b);
}
const pairs = (days: ControlDay[], returns: number[]): Pair[] =>
  days.map((d, i) => ({
    date: d.date,
    portfolio: returns[i],
    market: d.market_return,
    rf: d.cash_return,
  }));

/** Net beta is N(lambda)/(1-k^2 lambda^2), N cubic. The coefficients
 * include entry-lag/cost rows and no-terminal-maintenance rows. AL02's exact
 * covariance/variance implementation supplies each coefficient's beta.
 * Roots of its quartic derivative certify all extrema on [0,1] for k<1. */
export function matchBeta(
  days: ControlDay[],
  dynamicReturns: number[],
  costBps: number,
) {
  ensure(
    days.length === dynamicReturns.length && days.length > 1,
    "Control sample must equal the dynamic sample.",
  );
  const dynamic = beta(pairs(days, dynamicReturns));
  if (dynamic.value === null)
    return {
      status: "MATCHED_BETA_CONTROL_UNDEFINED",
      reason: dynamic.reason,
      dynamic_beta: dynamic,
      track: "NOT_SUPPORTED" as const,
    };
  const k = costBps / 10000;
  if (k >= 1)
    return {
      status: "MATCHED_BETA_MAINTENANCE_COST_UNSUPPORTED",
      reason:
        "Cannot certify daily constant-weight maintenance at a fee rate >=100%; no substitution or cost rounding is performed.",
      dynamic_beta: dynamic,
      track: "NOT_SUPPORTED" as const,
    };
  const coefficients = days.map((d) => {
    const r = d.cash_return,
      delta = d.market_return - r;
    if (d.fold_offset === 0) return [r, 0, -r * k * k, 0];
    if (d.fold_offset === 1) return [r, -(1 + r) * k, k * k, 0];
    if (d.fold_last) return [r, delta, -r * k * k, -delta * k * k];
    const sign = delta >= 0 ? -1 : 1;
    return [
      r,
      delta * (1 + sign * k),
      -r * k * k - sign * k * delta * (1 + sign * k),
      0,
    ];
  });
  const n = [0, 1, 2, 3].map(
    (j) =>
      beta(
        pairs(
          days,
          coefficients.map((c) => c[j]),
        ),
      ).value!,
  );
  ensure(n.every(Number.isFinite), "Matched-beta coefficients are undefined.");
  const value = (lambda: number) =>
    evaluate(n, lambda) / (1 - k * k * lambda * lambda);
  const derivative = [
    n[1],
    2 * (n[2] + k * k * n[0]),
    3 * n[3] + k * k * n[1],
    0,
    -k * k * n[3],
  ];
  const extrema = [0, 1, ...polynomialRoots(derivative)].map((lambda) => ({
    lambda,
    beta: value(lambda),
  }));
  const minimum = Math.min(...extrema.map((x) => x.beta)),
    maximum = Math.max(...extrema.map((x) => x.beta));
  const roots = polynomialRoots([
    n[0] - dynamic.value,
    n[1],
    n[2] + dynamic.value * k * k,
    n[3],
  ]);
  // Degenerate constant-beta families may match everywhere: choose lambda=0.
  const matching = [
    ...roots,
    ...extrema
      .filter((x) => Math.abs(x.beta - dynamic.value!) <= BETA_MATCH_TOLERANCE)
      .map((x) => x.lambda),
  ].sort((a, b) => a - b);
  const closest = [...extrema].sort(
    (a, b) =>
      Math.abs(a.beta - dynamic.value!) - Math.abs(b.beta - dynamic.value!) ||
      a.lambda - b.lambda,
  )[0];
  const lambda = matching[0] ?? closest.lambda;
  const track = controlTrack(days, lambda, costBps);
  const achieved = beta(
    pairs(
      days,
      track.map((d) => d.net_return),
    ),
  );
  ensure(
    achieved.value !== null &&
      Math.abs(achieved.value - value(lambda)) <= BETA_MATCH_TOLERANCE,
    "Analytic and ledger matched-control betas disagree.",
  );
  const difference = achieved.value! - dynamic.value;
  const feasible = Math.abs(difference) <= BETA_MATCH_TOLERANCE;
  if (
    !feasible &&
    dynamic.value >= minimum - BETA_MATCH_TOLERANCE &&
    dynamic.value <= maximum + BETA_MATCH_TOLERANCE
  )
    throw new AttributionError(
      "MATCHED_BETA_NUMERICAL_FAILURE",
      "The target is within the attainable beta range but the deterministic solver did not reconcile it.",
    );
  return {
    status: feasible ? "MATCHED" : "MATCHED_BETA_CONTROL_INFEASIBLE",
    label: "Retrospective matched-beta diagnostic",
    explanation:
      "This control is constructed after observing the completed OOS path. It is a diagnostic benchmark, not an ex-ante investable strategy.",
    dynamic_beta: dynamic,
    minimum_attainable_control_beta: minimum,
    maximum_attainable_control_beta: maximum,
    best_attainable_lambda: lambda,
    achieved_control_beta: achieved,
    remaining_beta_difference: difference,
    absolute_tolerance: BETA_MATCH_TOLERANCE,
    solver: "RATIONAL_BETA_CUBIC_ROOTS_QUARTIC_EXTREMA_BISECTION_80_V1",
    solver_coefficients: n,
    extrema,
    track,
  };
}
