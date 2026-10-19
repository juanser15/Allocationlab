import type { Campaign, Candidate } from "./spec";
export interface Observation { date: string; net_return: number; turnover: number; costs: number; exposure: number; }
export interface Metrics { observations: number; cagr: number; net_sharpe: number | null; max_drawdown: number; return_drawdown_ratio: number | null; volatility: number; turnover: number; turnover_annualized: number; costs: number; exposure: number; final_index: number; }
export function summarize(rows: Observation[], reference: number): Metrics {
  if (!Number.isFinite(reference) || !rows.length || rows.some(r =>
    ![r.net_return, r.turnover, r.costs, r.exposure].every(Number.isFinite) || r.net_return <= -1 || r.turnover < 0 || r.costs < 0)) throw new Error("Invalid/empty observations/reference");
  let index = 1, high = 1, dd = 0;
  for (const row of rows) { index *= 1 + row.net_return; high = Math.max(high, index); dd = Math.min(dd, index / high - 1); }
  const excess = rows.map(r => r.net_return - reference), anchor = excess[0];
  // Same sample-variance formula, evaluated in translated coordinates. Identical
  // returns have exact zero deltas; no tolerance or variance floor is introduced.
  const deltas = excess.map(r => r - anchor), deltaMean = deltas.reduce((s, r) => s + r, 0) / rows.length;
  const mean = anchor + deltaMean;
  const variance = rows.length > 1 ? deltas.reduce((s, r) => s + (r - deltaMean) ** 2, 0) / (rows.length - 1) : 0;
  const cagr = index ** (252 / rows.length) - 1, turnover = rows.reduce((s, r) => s + r.turnover, 0);
  const result = { observations: rows.length, cagr, net_sharpe: variance > 0 ? mean / Math.sqrt(variance) * Math.sqrt(252) : null,
    max_drawdown: dd, return_drawdown_ratio: dd < 0 ? cagr / -dd : null, volatility: Math.sqrt(variance * 252),
    turnover, turnover_annualized: turnover * 252 / rows.length, costs: rows.reduce((s, r) => s + r.costs, 0),
    exposure: rows.reduce((s, r) => s + r.exposure, 0) / rows.length, final_index: index * 100 };
  if (Object.values(result).some(v => v !== null && !Number.isFinite(v))) throw new Error("Nonfinite/overflow metrics");
  return result;
}
export interface Ranked { candidate: Candidate; metrics?: Metrics; status: string; reason?: string; score?: number; complexity: number; rank?: number; }
export function select(c: Campaign, candidates: Ranked[]): { winner?: Ranked; ranking: Ranked[] } {
  const ranking = candidates.map(x => ({ ...x }));
  for (const x of ranking) {
    if (x.status !== "VALID") continue;
    if (!x.metrics || Object.values(x.metrics).some(v => v !== null && !Number.isFinite(v))) { x.status = "INVALID_SELECTION"; x.reason = "Invalid metrics"; continue; }
    const m = x.metrics, lim = c.constraints, score = m[c.selection_metric];
    if (score === null || !Number.isFinite(score)) { x.status = "INVALID_SELECTION"; x.reason = "Primary metric undefined"; continue; }
    if ((lim.max_turnover !== undefined && m.turnover_annualized > lim.max_turnover) ||
      (lim.max_drawdown !== undefined && -m.max_drawdown > lim.max_drawdown) ||
      (lim.min_exposure !== undefined && m.exposure < lim.min_exposure) ||
      (lim.max_exposure !== undefined && m.exposure > lim.max_exposure)) {
      x.status = "CONSTRAINT_REJECTED"; x.reason = "Predeclared constraints"; continue;
    }
    x.score = score;
  }
  const eligible = ranking.filter(x => x.status === "VALID").sort((a, b) => b.score! - a.score! || a.metrics!.turnover_annualized - b.metrics!.turnover_annualized || a.complexity - b.complexity || a.candidate.candidate_id.localeCompare(b.candidate.candidate_id));
  eligible.forEach((x, i) => { x.rank = i + 1; });
  return { winner: eligible[0], ranking };
}
export function correlation(a: Observation[], b: Observation[]): number | null {
  const right = new Map(b.map(r => [r.date, r.net_return]));
  const pairs = a.filter(r => right.has(r.date)).map(r => [r.net_return, right.get(r.date)!]);
  if (pairs.length < 3) return null;
  const deltas = pairs.map(p => [p[0] - pairs[0][0], p[1] - pairs[0][1]]);
  const am = deltas.reduce((s, p) => s + p[0], 0) / pairs.length, bm = deltas.reduce((s, p) => s + p[1], 0) / pairs.length;
  const av = deltas.reduce((s, p) => s + (p[0] - am) ** 2, 0), bv = deltas.reduce((s, p) => s + (p[1] - bm) ** 2, 0);
  return av && bv ? deltas.reduce((s, p) => s + (p[0] - am) * (p[1] - bm), 0) / Math.sqrt(av * bv) : null;
}
