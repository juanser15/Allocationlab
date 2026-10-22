import {
  SPEC,
  TURNOVER,
  requestSchema,
  type RequestSpec,
  type Capabilities,
} from "./api";
export const CAPITAL_TABS = [
  "Setup",
  "Results",
  "Compare",
  "Runs",
  "Audit",
] as const;
export interface FormDesign {
  from: string;
  to: string;
  training: string;
  window: string;
  rebalance: string;
  cost: string;
}
export const blankDesign = (): FormDesign => ({
  from: "",
  to: "",
  training: "",
  window: "",
  rebalance: "",
  cost: "",
});
export function readDesign(f: FormDesign, c: Capabilities): RequestSpec | null {
  if (Object.values(f).some((x) => !x.trim())) return null;
  const n = Number(f.training),
    cost = Number(f.cost);
  if (
    !Number.isSafeInteger(n) ||
    n < c.training_window_rules.minimum_months ||
    n > c.training_window_rules.maximum_months ||
    !Number.isFinite(cost) ||
    cost < 0
  )
    return null;
  const parsed = requestSchema.safeParse({
    contract_version: SPEC,
    research_mode: "CAPITAL_MARKET_EXPOSURE",
    execution_scope: "EMPIRICAL",
    universe: "SPY",
    validation_protocol: "TRADITIONAL_WALK_FORWARD",
    evaluation_start: f.from,
    evaluation_end_exclusive: f.to,
    window_type: f.window,
    training_window_months: n,
    rebalance_frequency: f.rebalance,
    transaction_cost_bps: cost,
    selection_cost_bps: cost,
    turnover_constraint_methodology_version: TURNOVER,
  });
  return parsed.success ? parsed.data : null;
}
export const duplicateDesign = (s: RequestSpec): FormDesign => ({
  from: s.evaluation_start,
  to: s.evaluation_end_exclusive,
  training: String(s.training_window_months),
  window: s.window_type,
  rebalance: s.rebalance_frequency,
  cost: String(s.transaction_cost_bps),
});
export const modules = [
  {
    id: "data",
    label: "Data & Universe",
    description:
      "Define the investable universe and inspect point-in-time data coverage.",
  },
  {
    id: "signals",
    label: "Signals",
    description:
      "Develop and catalogue research signals with explicit information boundaries.",
  },
  {
    id: "health",
    label: "Signal Health",
    description:
      "Evaluate signal stability and eligibility before portfolio construction.",
  },
  {
    id: "capital",
    label: "Capital Exposure",
    description: "Research how much capital is exposed to SPY versus cash.",
  },
  {
    id: "etf",
    label: "ETF Selection",
    description:
      "Research which instruments may express an eligible investment view.",
  },
  {
    id: "portfolio",
    label: "Portfolio Optimization",
    description:
      "Construct constrained portfolios from approved research inputs.",
  },
  {
    id: "robustness",
    label: "Robustness & Stress",
    description: "Inspect portfolio sensitivity and stress behavior.",
  },
  {
    id: "promote",
    label: "Compare & Promote",
    description:
      "Review evidence before a future explicit governance decision.",
  },
] as const;
export const percent = (n: number | null | undefined) =>
  typeof n === "number"
    ? new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 2,
      }).format(n)
    : "Not supported";
export const number = (n: number | null | undefined, d = 2) =>
  typeof n === "number"
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: d }).format(n)
    : "Not supported";
export const dateLabel = (s: string) =>
  new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  });
export const dataMonth = (s: string) =>
  new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    timeZone: "UTC",
  });
