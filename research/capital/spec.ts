import { createHash } from "node:crypto";
export type WindowType = "rolling" | "expanding";
export type Frequency = "monthly" | "quarterly" | "yearly" | "once";
export interface CandidateSpec {
  model_family: string;
  input_set: string[];
  transformations: Array<{ name: string; parameters?: Record<string, unknown> }>;
  model_parameters: Record<string, unknown>;
  exposure_policy: string;
  exposure_parameters: Record<string, unknown>;
  rebalance_frequency: "monthly" | "quarterly";
  recalibration_frequency: Frequency;
}
export interface Candidate { candidate_id: string; spec: CandidateSpec; }
export interface Campaign {
  experiment_id: string;
  validation_mode: "traditional" | "nested";
  window_type: WindowType;
  dates: { start: string; end_exclusive: string };
  train_months: number; test_months: number; step_months: number;
  inner_window_type?: WindowType;
  inner_train_months?: number; inner_test_months?: number; inner_step_months?: number;
  rebalance_frequency: "monthly" | "quarterly";
  recalibration_frequency: Frequency;
  search_method: "grid" | "random";
  candidate_budget?: number;
  random_seed?: string | number;
  grid_reduction?: { indices: number[] };
  candidate_space: Array<{ base: Omit<CandidateSpec, "rebalance_frequency" | "recalibration_frequency"> & Partial<Pick<CandidateSpec, "rebalance_frequency" | "recalibration_frequency">>; axes?: Record<string, unknown[]> }>;
  selection_metric: "net_sharpe" | "cagr" | "max_drawdown" | "return_drawdown_ratio";
  constraints: { max_turnover?: number; max_drawdown?: number; min_exposure?: number; max_exposure?: number };
  transaction_cost_bps: number[];
  selection_cost_bps: number;
  cash_yield: { type: "constant"; daily: number; reference_daily: number };
  risk_asset: string;
  reference_universe: string[];
  data_csv: string;
  data_sha256: string;
  data_provenance: string;
  warmup_rows: number;
  max_jobs: number;
}
export interface Fold {
  outer_fold: number; inner_fold?: number;
  train_start: string; train_end: string; test_start: string; test_end: string;
}
export const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).filter(k => (v as any)[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v);
};
export const hash = (v: unknown) => createHash("sha256").update(typeof v === "string" ? v : canonical(v)).digest("hex");
export const candidateId = (spec: CandidateSpec) => `c_${hash(spec).slice(0, 24)}`;
export function validateCampaign(c: Campaign) {
  if (!/^[a-zA-Z0-9_-]+$/.test(c.experiment_id)) throw new Error("Unsafe experiment_id");
  if (!["traditional", "nested"].includes(c.validation_mode) || !["rolling", "expanding"].includes(c.window_type) || !["grid", "random"].includes(c.search_method)) throw new Error("Invalid mode/window/search");
  if (c.inner_window_type && !["rolling", "expanding"].includes(c.inner_window_type)) throw new Error("Invalid inner_window_type");
  for (const n of [c.train_months, c.test_months, c.step_months, c.warmup_rows, c.max_jobs]) if (!Number.isInteger(n) || n <= 0) throw new Error("Positive integer clock/budget required");
  if (c.step_months < c.test_months) throw new Error("Overlapping outer tests unsupported in v1; require step_months >= test_months, never silently double-count");
  if (c.validation_mode === "nested") {
    for (const n of [c.inner_train_months, c.inner_test_months, c.inner_step_months]) if (!Number.isInteger(n) || n! <= 0) throw new Error("Inner clocks required");
    if (c.inner_step_months! < c.inner_test_months!) throw new Error("Overlapping inner OOS unsupported");
  }
  const budget = c.candidate_budget ?? 200;
  if (!Number.isInteger(budget) || budget < 1 || budget > 200) throw new Error("candidate_budget must be 1..200");
  if (c.search_method === "random" && c.random_seed === undefined) throw new Error("random_seed mandatory");
  if (!["net_sharpe", "cagr", "max_drawdown", "return_drawdown_ratio"].includes(c.selection_metric)) throw new Error("Selection metric required before performance");
  if (!c.transaction_cost_bps.length || new Set(c.transaction_cost_bps).size !== c.transaction_cost_bps.length || c.transaction_cost_bps.some(n => !Number.isFinite(n) || n < 0) || !c.transaction_cost_bps.includes(c.selection_cost_bps)) throw new Error("Invalid cost scenarios/selection scenario");
  if (c.cash_yield.type !== "constant" || !Number.isFinite(c.cash_yield.daily) || c.cash_yield.daily <= -1 || !Number.isFinite(c.cash_yield.reference_daily)) throw new Error("Explicit constant cash/reference yields required");
  for (const [k, v] of Object.entries(c.constraints)) if (!["max_turnover", "max_drawdown", "min_exposure", "max_exposure"].includes(k) || !Number.isFinite(v) || v < 0) throw new Error("Invalid constraint");
  if ((c.constraints.max_drawdown ?? 0) > 1 || (c.constraints.max_exposure ?? 1) > 1 || (c.constraints.min_exposure ?? 0) > (c.constraints.max_exposure ?? 1)) throw new Error("Incompatible exposure/drawdown constraints");
  for (const d of [c.dates.start, c.dates.end_exclusive]) if (!/^\d{4}-\d{2}-01$/.test(d) || !Number.isFinite(Date.parse(d))) throw new Error("Campaign clock boundaries must be month starts");
  if (c.dates.end_exclusive <= c.dates.start || !c.reference_universe.length || new Set(c.reference_universe).size !== c.reference_universe.length) throw new Error("Invalid dates/universe");
}
export function addMonths(date: string, n: number) {
  const d = new Date(date); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10);
}
export function makeFolds(c: Campaign): Fold[] {
  validateCampaign(c);
  const result: Fold[] = [];
  for (let test = addMonths(c.dates.start, c.train_months), i = 0; addMonths(test, c.test_months) <= c.dates.end_exclusive; test = addMonths(test, c.step_months), i++)
    result.push({ outer_fold: i, train_start: c.window_type === "rolling" ? addMonths(test, -c.train_months) : c.dates.start,
      train_end: test, test_start: test, test_end: addMonths(test, c.test_months) });
  return result;
}
export function innerFolds(c: Campaign, outer: Fold): Fold[] {
  const result: Fold[] = [];
  for (let test = addMonths(outer.train_start, c.inner_train_months!), i = 0; addMonths(test, c.inner_test_months!) <= outer.train_end; test = addMonths(test, c.inner_step_months!), i++)
    result.push({ outer_fold: outer.outer_fold, inner_fold: i,
      train_start: (c.inner_window_type ?? c.window_type) === "rolling" ? addMonths(test, -c.inner_train_months!) : outer.train_start,
      train_end: test, test_start: test, test_end: addMonths(test, c.inner_test_months!) });
  return result;
}
const setPath = (obj: any, path: string, value: unknown) => {
  const parts = path.split(".");
  if (parts.some(p => ["__proto__", "constructor", "prototype"].includes(p))) throw new Error("Unsafe candidate axis");
  let target = obj; for (const part of parts.slice(0, -1)) target = target[part] ??= {};
  target[parts.at(-1)!] = structuredClone(value);
};
export function generateCandidates(c: Campaign): { candidates: Candidate[]; cartesianSize: number } {
  validateCampaign(c);
  const templates = c.candidate_space.map(t => {
    const axes = Object.entries(t.axes ?? {}).sort(([a], [b]) => a.localeCompare(b));
    if (axes.some(([, a]) => !Array.isArray(a) || !a.length || new Set(a.map(canonical)).size !== a.length)) throw new Error("Empty/duplicate axis values");
    const size = axes.reduce((s, [, a]) => s * a.length, 1);
    if (!Number.isSafeInteger(size)) throw new Error("Search product exceeds safe integer range");
    return { t, axes, size };
  });
  const total = templates.reduce((s, t) => s + t.size, 0), budget = c.candidate_budget ?? 200;
  if (!total) throw new Error("Empty candidate space");
  if (c.search_method === "grid" && total > budget && !c.grid_reduction) throw new Error(`Grid product ${total} > budget ${budget}; explicit grid_reduction.indices or random search required`);
  const at = (index: number): Candidate => {
    const found = templates.find(t => { if (index < t.size) return true; index -= t.size; return false; })!;
    const spec = structuredClone({ ...found.t.base,
      rebalance_frequency: found.t.base.rebalance_frequency ?? c.rebalance_frequency,
      recalibration_frequency: found.t.base.recalibration_frequency ?? c.recalibration_frequency }) as CandidateSpec;
    for (const [path, values] of [...found.axes].reverse()) { setPath(spec, path, values[index % values.length]); index = Math.floor(index / values.length); }
    return { candidate_id: candidateId(spec), spec };
  };
  let indices: number[];
  if (c.search_method === "grid") indices = c.grid_reduction ? c.grid_reduction.indices : Array.from({ length: total }, (_, i) => i);
  else {
    let seed = parseInt(hash(c.random_seed).slice(0, 8), 16) >>> 0;
    const random = () => { seed += 0x6D2B79F5; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const selected = new Set<number>();
    while (selected.size < Math.min(total, budget)) selected.add(Math.floor(random() * total));
    indices = [...selected];
  }
  if (indices.length > budget || new Set(indices).size !== indices.length || indices.some(i => !Number.isSafeInteger(i) || i < 0 || i >= total)) throw new Error("Invalid explicit grid reduction");
  const unique = new Map(indices.map(i => { const x = at(i); return [x.candidate_id, x]; }));
  return { candidates: [...unique.values()].sort((a, b) => a.candidate_id.localeCompare(b.candidate_id)), cartesianSize: total };
}
