// Independent QA reference. Does not call engine metrics/selection/fold helpers.
import type { Observation, Metrics } from "./metrics";
import type { Campaign, Fold } from "./spec";
import type { PriceRow } from "../../artifacts/api-server/src/lib/calculator";
export function metricOracle(rows: Observation[], reference: number): Metrics {
  if (!Number.isFinite(reference) || !rows.length || rows.some(r => ![r.net_return, r.turnover, r.costs, r.exposure].every(Number.isFinite) || r.net_return <= -1 || r.turnover < 0 || r.costs < 0)) throw new Error("Oracle invalid observations");
  const xs = rows.map(r => r.net_return - reference);
  // Pairwise variance identity avoids reusing engine's two-pass implementation.
  let pairs = 0; for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) pairs += (xs[i] - xs[j]) ** 2;
  const variance = xs.length > 1 ? pairs / (xs.length * (xs.length - 1)) : 0;
  const average = xs[0] + xs.reduce((s, x) => s + (x - xs[0]), 0) / xs.length;
  const curve = [1]; for (const r of rows) curve.push(curve.at(-1)! * (1 + r.net_return));
  const dd = Math.min(...curve.map((v, i) => v / Math.max(...curve.slice(0, i + 1)) - 1));
  const final = curve.at(-1)!, cagr = Math.pow(final, 252 / rows.length) - 1;
  const turnover = rows.reduce((s, r) => s + r.turnover, 0);
  const out = { observations: rows.length, cagr, net_sharpe: variance === 0 ? null : average / Math.sqrt(variance) * Math.sqrt(252),
    max_drawdown: dd, return_drawdown_ratio: dd === 0 ? null : cagr / -dd, volatility: Math.sqrt(variance) * Math.sqrt(252),
    turnover, turnover_annualized: turnover * 252 / rows.length, costs: rows.reduce((s, r) => s + r.costs, 0),
    exposure: rows.reduce((s, r) => s + r.exposure, 0) / rows.length, final_index: final * 100 };
  if (Object.values(out).some(v => v !== null && !Number.isFinite(v))) throw new Error("Oracle nonfinite metrics");
  return out;
}
const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const monthDate = (n: number) => `${String(Math.floor(n / 12)).padStart(4, "0")}-${String(n % 12 + 1).padStart(2, "0")}-01`;
export function foldOracle(c: Campaign): Fold[] {
  const first = monthIndex(c.dates.start), last = monthIndex(c.dates.end_exclusive), result: Fold[] = [];
  for (let t = first + c.train_months, i = 0; t + c.test_months <= last; t += c.step_months, i++) result.push({
    outer_fold: i, train_start: monthDate(c.window_type === "rolling" ? t - c.train_months : first), train_end: monthDate(t),
    test_start: monthDate(t), test_end: monthDate(t + c.test_months) });
  return result;
}
export function innerOracle(c: Campaign, outer: Fold): Fold[] {
  const first = monthIndex(outer.train_start), last = monthIndex(outer.train_end), result: Fold[] = [];
  for (let t = first + c.inner_train_months!, i = 0; t + c.inner_test_months! <= last; t += c.inner_step_months!, i++) result.push({
    outer_fold: outer.outer_fold, inner_fold: i,
    train_start: monthDate((c.inner_window_type ?? c.window_type) === "rolling" ? t - c.inner_train_months! : first), train_end: monthDate(t),
    test_start: monthDate(t), test_end: monthDate(t + c.inner_test_months!) });
  return result;
}
export function sleeveOracle(rows: PriceRow[], start: string, end: string, risk: (date: string) => number, bps: number, cashRate: number, frequency: "monthly" | "quarterly" = "monthly") {
  const signals: number[] = []; let priorPeriod = "";
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; if (r.date < start || r.date >= end) continue;
    const month = Number(r.date.slice(5, 7)) - 1;
    const key = frequency === "monthly" ? r.date.slice(0, 7) : r.date.slice(0, 4) + String(Math.floor(month / 3));
    if (key !== priorPeriod) { signals.push(i); priorPeriod = key; }
  }
  if (!signals.length || signals[0] < 1) throw new Error("No oracle execution interval");
  let cash = 100, quantity = 0, nav = 100;
  const output: any[] = []; const fee = bps / 10000;
  for (let i = signals[0]; i < rows.length && rows[i].date < end; i++) {
    const p0 = rows[i - 1].prices.R, p1 = rows[i].prices.R, previousNav = nav, previousCash = cash, old = quantity;
    const pnl = old * (p1 - p0), interest = previousCash * cashRate;
    cash += interest; const before = cash + old * p1;
    let cost = 0, trade = 0;
    if (signals.includes(i - 1)) {
      const target = risk(rows[i - 1].date), heldValue = old * p1;
      // Closed-form solution of N + fee*|target*N-heldValue| = before.
      const after = target * before >= heldValue ? (before + fee * heldValue) / (1 + fee * target) : (before - fee * heldValue) / (1 - fee * target);
      if (!Number.isFinite(after) || after <= 0) throw new Error("Oracle insolvency");
      quantity = target * after / p1;
      trade = (quantity - old) * p1; cost = fee * Math.abs(trade);
      cash = (1 - target) * after;
    }
    nav = cash + quantity * p1;
    output.push({ date: rows[i].date, beginningNav: previousNav, beginningCash: previousCash, endingNav: nav, endingCash: cash,
      quantity, notional: trade, fees: cost, etfPnl: pnl, cashPnl: interest,
      observation: { date: rows[i].date, net_return: (pnl + interest - cost) / previousNav,
        turnover: Math.abs(trade) / before, costs: cost, exposure: old * p0 / previousNav } });
  }
  return output;
}
