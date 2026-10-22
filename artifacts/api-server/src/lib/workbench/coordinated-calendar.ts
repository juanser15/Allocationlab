import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  planInteractive,
  preparedDataset,
  INTERACTIVE_SPEC,
  interactiveCodeVersion,
} from "./interactive-calendar";
import { RECURRING_V2 } from "./turnover-product";
import { CalendarContractError, sha256, boundaryV2 } from "./calendar-v2";
import { canonicalJson, calculateRunId } from "./identity";
import { resolveWorkbenchRepositoryRoot } from "./repository-root";
export { preparedDataset };
import {
  COORDINATED_SPEC,
  ETF_UNIVERSE,
  type CoordinatedRequest,
  type ResearchSubmission,
  PORTFOLIO_FIELDS,
  isCapitalStudy,
} from "./coordinated-contract";
export {
  COORDINATED_SPEC,
  ETF_UNIVERSE,
  type CoordinatedRequest,
  type ResearchSubmission,
};
export const requestFields = [
  "research_scope",
  "contract_version",
  "evaluation_start",
  "evaluation_end_exclusive",
  "training_window_months",
  "window_type",
  "rebalance_frequency",
  "transaction_cost_bps",
  "control_mode",
  "maximum_exposure",
  "risk_budget",
  "regime_model",
  "regime_response",
  "defensive_multiplier",
  "etfs",
  "maximum_etf_weight",
  "risk_aversion",
  "covariance_shrinkage",
];
export function parseCoordinated(value: unknown): ResearchSubmission {
  const v = value as ResearchSubmission;
  const invalid = (message: string) => {
    throw new CalendarContractError(
      "INVALID_COORDINATED_DESIGN",
      message,
      {},
      422,
    );
  };
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !requestFields.includes(k)) ||
    requestFields
      .filter(
        (k) =>
          k !== "research_scope" &&
          !(
            v.research_scope === "CAPITAL_EXPOSURE" &&
            PORTFOLIO_FIELDS.includes(k as any)
          ),
      )
      .some((k) => !Object.hasOwn(v, k))
  )
    invalid(
      "Supply every coordinated design field; unknown fields are rejected.",
    );
  if (v.contract_version !== COORDINATED_SPEC)
    invalid("Unsupported coordinated design version.");
  if (
    v.research_scope !== undefined &&
    !["PORTFOLIO", "CAPITAL_EXPOSURE"].includes(v.research_scope)
  )
    invalid("Unsupported research scope.");
  if (isCapitalStudy(v) && PORTFOLIO_FIELDS.some((k) => Object.hasOwn(v, k)))
    invalid(
      "Capital Exposure studies take only the capital policy and study calendar. ETF selection and optimizer inputs belong to Portfolio Construction.",
    );
  for (const [key, allowed] of Object.entries({
    control_mode: ["MAX_EXPOSURE", "RISK_BUDGET"],
    regime_model: ["CURRENT", "TREND", "TREND_VOL", "HMM"],
    regime_response: ["FIXED", "ADAPTIVE"],
  }))
    if (!allowed.includes(String((v as any)[key])))
      invalid(`Unsupported ${key}.`);
  for (const [key, min, max] of [
    ["maximum_exposure", 0, 1],
    ["risk_budget", 0.001, 1],
    ["defensive_multiplier", 0, 1],
    ["transaction_cost_bps", 0, 1000],
  ] as const) {
    const n = v[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max)
      invalid(`${key} must be between ${min} and ${max}.`);
  }
  if (!isCapitalStudy(v)) {
    for (const [key, min, max] of [
      ["maximum_etf_weight", 0.001, 1],
      ["risk_aversion", 0.1, 100],
      ["covariance_shrinkage", 0.01, 1],
    ] as const) {
      const n = v[key];
      if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max)
        invalid(`${key} must be between ${min} and ${max}.`);
    }
    if (
      !Array.isArray(v.etfs) ||
      !v.etfs.length ||
      v.etfs.length > 8 ||
      new Set(v.etfs).size !== v.etfs.length ||
      v.etfs.some((t) => !ETF_UNIVERSE.includes(t as any))
    )
      invalid("Choose one to eight distinct supported ETFs.");
  }
  if (
    v.regime_response === "ADAPTIVE" &&
    v.control_mode === "RISK_BUDGET" &&
    v.defensive_multiplier === 0
  )
    invalid("A risk budget requires a positive defensive multiplier.");
  // Validation of dates and calendar is shared with the existing contract.
  return isCapitalStudy(v)
    ? { ...v }
    : { ...v, research_scope: "PORTFOLIO", etfs: [...v.etfs].sort() };
}
export function requestFromSpec(spec: CoordinatedSpec) {
  return parseCoordinated(
    Object.fromEntries(
      requestFields
        .filter((k) => Object.hasOwn(spec, k))
        .map((k) => [k, (spec as any)[k]]),
    ),
  );
}
export function planCoordinated(value: unknown, data = preparedDataset()) {
  const request = parseCoordinated(value);
  const base = planInteractive(
    {
      contract_version: INTERACTIVE_SPEC,
      research_mode: "CAPITAL_MARKET_EXPOSURE",
      execution_scope: "EMPIRICAL",
      universe: "SPY",
      validation_protocol: "TRADITIONAL_WALK_FORWARD",
      evaluation_start: request.evaluation_start,
      evaluation_end_exclusive: request.evaluation_end_exclusive,
      window_type: request.window_type,
      training_window_months: request.training_window_months,
      rebalance_frequency: request.rebalance_frequency,
      transaction_cost_bps: request.transaction_cost_bps,
      selection_cost_bps: request.transaction_cost_bps,
      turnover_constraint_methodology_version: RECURRING_V2,
    },
    data,
  );
  const history = data.rows.filter(
    (r) =>
      r.date >= base.folds[0].training_start &&
      r.date < request.evaluation_end_exclusive,
  );
  const etfs = isCapitalStudy(request) ? ["SPY"] : request.etfs;
  if (
    history.some((r) =>
      etfs.some((t) => !Number.isFinite(r.prices[t]) || r.prices[t] <= 0),
    )
  )
    throw new CalendarContractError(
      "INCOMPLETE_ETF_HISTORY",
      "A selected ETF has missing or invalid prices. Change the universe or dates explicitly.",
      {},
      422,
    );
  return {
    ...base,
    normalized_request: request,
    total_work_units: base.folds.length + 2,
    estimated_jobs: base.folds.length + 2,
    warnings: [
      boundaryV2.pit_classification,
      "One continuous long-only portfolio; zero cash yield; next observed close fills. Constraints apply to decision targets, not intraperiod drift.",
      "Risk budget is an estimated annualized volatility ceiling, not a guaranteed loss limit.",
      "Historical mean and covariance estimates; no point-in-time vintage certification.",
      ...(isCapitalStudy(request)
        ? [
            "Independent capital policy study: SPY/cash only; no ETF optimization. Passive SPY buys once at the same first next-close fill, with the same costs and zero cash yield.",
          ]
        : []),
    ],
    plan_hash: sha256(
      canonicalJson({
        request,
        folds: base.folds,
        data: data.snapshot.sha256,
        version: COORDINATED_SPEC,
      }),
    ),
  };
}
export function normalizeCoordinated(value: unknown, data = preparedDataset()) {
  const plan = planCoordinated(value, data),
    root = resolveWorkbenchRepositoryRoot({ moduleUrl: import.meta.url });
  const files = [
    "artifacts/api-server/src/lib/workbench/coordinated-contract.ts",
    "research/coordinated/models.ts",
    "research/coordinated/engine.ts",
    "artifacts/api-server/src/lib/workbench/coordinated-calendar.ts",
    "artifacts/api-server/src/lib/workbench/coordinated-service.ts",
    "artifacts/api-server/src/workbench-coordinated-worker.ts",
  ];
  return {
    ...plan.normalized_request,
    identity_namespace: COORDINATED_SPEC,
    data_snapshot: data.snapshot,
    code_version: sha256(
      canonicalJson({
        baseline: interactiveCodeVersion(data),
        files: files.map((p) => [p, sha256(readFileSync(resolve(root, p)))]),
      }),
    ),
    runtime_versions: { node: process.versions.node, v8: process.versions.v8 },
    engine_version: "coordinated-continuous-ledger-1.0.0",
    calendar_methodology: baseCalendar,
    methodology: {
      cash_yield: 0,
      execution: "next_close",
      accounting: "CONTINUOUS_HOLDINGS",
      forecast: isCapitalStudy(plan.normalized_request)
        ? "UNUSED_CAPITAL_POLICY_ONLY"
        : "HISTORICAL_ARITHMETIC_MEAN_252",
      covariance: isCapitalStudy(plan.normalized_request)
        ? "SPY_SAMPLE_VARIANCE_252"
        : "SAMPLE_DIAGONAL_SHRINKAGE_252",
      optimizer: isCapitalStudy(plan.normalized_request)
        ? "NONE_CAPITAL_POLICY_ONLY"
        : "LONG_ONLY_MEAN_VARIANCE_L1_COST",
      hmm: "GAUSSIAN_2_STATE_EM_FILTERED_V1",
    },
  };
}
const baseCalendar = "ANCHORED_NEXT_TRADING_DAY_V1";
export type CoordinatedSpec = ReturnType<typeof normalizeCoordinated>;
export const coordinatedRunId = (s: CoordinatedSpec) => calculateRunId(s);
export function coordinatedCapabilities() {
  const data = preparedDataset();
  return {
    ...boundaryV2,
    supported_spec_version: COORDINATED_SPEC,
    etfs: ETF_UNIVERSE,
    data_snapshot: data.snapshot,
    data_first_observation: data.snapshot.data_first_observation,
    data_last_observation: data.snapshot.data_last_observation,
    models: ["CURRENT", "TREND", "TREND_VOL", "HMM"],
    control_modes: ["MAX_EXPOSURE", "RISK_BUDGET"],
    research_scopes: ["PORTFOLIO", "CAPITAL_EXPOSURE"],
    training_history_policy: "USER_SELECTED_WINDOW_NO_STATISTICAL_MINIMUM",
  };
}
