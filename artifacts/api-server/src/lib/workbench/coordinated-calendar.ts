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
  DEFAULT_FORECAST,
  type ForecastConfig,
} from "./coordinated-contract";
import { loadCoordinatedDataset } from "./coordinated-data";
export { loadCoordinatedDataset };
export {
  COORDINATED_SPEC,
  ETF_UNIVERSE,
  type CoordinatedRequest,
  type ResearchSubmission,
};
export const requestFields = [
  "dataset_id",
  "forecast",
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
          k !== "dataset_id" &&
          k !== "forecast" &&
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
  if (
    v.dataset_id !== undefined &&
    (typeof v.dataset_id !== "string" ||
      !/^(REFERENCE|internal|yf_[a-f0-9]{64})$/.test(v.dataset_id))
  )
    invalid("Choose a valid dataset snapshot.");
  if (!isCapitalStudy(v) && v.forecast !== undefined)
    validateForecast(v.forecast, invalid);
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
      v.etfs.some(
        (t) => typeof t !== "string" || !/^[A-Z0-9.^=-]{1,24}$/.test(t),
      )
    )
      invalid(
        "Choose one to eight distinct assets present in the selected dataset.",
      );
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
    : {
        ...v,
        research_scope: "PORTFOLIO",
        etfs: [...v.etfs].sort(),
        ...(v.forecast
          ? {
              forecast: JSON.parse(
                JSON.stringify(v.forecast),
              ) as ForecastConfig,
            }
          : {}),
      };
}
function validateForecast(f: ForecastConfig, invalid: (m: string) => void) {
  if (
    !f ||
    typeof f !== "object" ||
    Array.isArray(f) ||
    Object.keys(f).some(
      (k) =>
        ![
          "model",
          "horizon_sessions",
          "training_sessions",
          "ridge_penalty",
          "manual_base_return",
          "manual_score_return",
          "signals",
        ].includes(k),
    ) ||
    !["HISTORICAL_MEAN", "MANUAL_SCORE", "SIGNAL_RIDGE"].includes(f.model)
  )
    invalid("Choose a supported, explicit forecast model.");
  for (const key of ["horizon_sessions", "training_sessions"] as const)
    if (!Number.isSafeInteger(f[key]) || f[key] <= 0)
      invalid(
        `${key} must be a positive whole number of sessions. No statistical minimum applies.`,
      );
  if (!Number.isFinite(f.ridge_penalty) || f.ridge_penalty <= 0)
    invalid("Ridge penalty must be finite and positive.");
  if (![f.manual_base_return, f.manual_score_return].every(Number.isFinite))
    invalid(
      "Manual forecast assumptions must be finite returns over the selected horizon.",
    );
  if (
    !Array.isArray(f.signals) ||
    !f.signals.length ||
    f.signals.length > 4 ||
    f.signals.some((s) => !s || typeof s !== "object" || Array.isArray(s)) ||
    new Set(f.signals.map((s) => s.id)).size !== f.signals.length
  )
    invalid("Choose distinct defined asset signals.");
  for (const s of f.signals)
    if (
      !s ||
      Object.keys(s).some(
        (k) =>
          ![
            "id",
            "enabled",
            "lookback_sessions",
            "skip_sessions",
            "weight",
          ].includes(k),
      ) ||
      !["MOMENTUM", "RELATIVE_MOMENTUM", "TREND", "REVERSAL"].includes(s.id) ||
      typeof s.enabled !== "boolean" ||
      !Number.isSafeInteger(s.lookback_sessions) ||
      s.lookback_sessions < 1 ||
      !Number.isSafeInteger(s.skip_sessions) ||
      s.skip_sessions < 0 ||
      !Number.isFinite(s.weight)
    )
      invalid(
        "Each signal requires its explicit positive lookback, nonnegative skip, enabled state and finite manual weight.",
      );
  if (f.model !== "HISTORICAL_MEAN" && !f.signals.some((s) => s.enabled))
    invalid("Enable at least one asset signal.");
  if (
    f.model === "MANUAL_SCORE" &&
    !f.signals.some((s) => s.enabled && s.weight !== 0)
  )
    invalid("Manual mapping requires a nonzero signal weight.");
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
export function planCoordinated(
  value: unknown,
  data = loadCoordinatedDataset((value as ResearchSubmission)?.dataset_id),
) {
  const request = parseCoordinated(value);
  const symbols = ["SPY"];
  // No warmup before training is imposed. Fixed-lookback classifiers instead
  // validate their actual feature history through each decision cutoff.
  const calendarData = {
    ...data,
    fixture: { ...data.fixture, warmup_rows: 0, reference_universe: symbols },
  };
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
    calendarData,
  );
  for (const fold of base.folds) {
    const available = data.rows.filter((r) => r.date < fold.decision_date);
    const lookback =
      request.regime_model === "CURRENT"
        ? 10
        : request.regime_model === "TREND"
          ? 200
          : request.regime_model === "TREND_VOL"
            ? 253
            : 0;
    if (
      available.length < lookback ||
      available
        .slice(-lookback || available.length)
        .some((r) =>
          symbols.some(
            (t) => !Number.isFinite(r.prices[t]) || r.prices[t] <= 0,
          ),
        )
    )
      throw new CalendarContractError(
        "REGIME_FEATURE_HISTORY_REQUIRED",
        `The selected ${request.regime_model} classifier requires its defined price inputs through the decision cutoff. Choose a compatible dataset, model or dates.`,
        {
          fold_id: fold.fold_id,
          required_symbols: symbols,
          lookback_prices: lookback,
        },
        422,
      );
  }
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
      "Forecast horizon and return units are recorded per decision. Daily covariance uses linear horizon scaling; no point-in-time vintage certification.",
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
export function normalizeCoordinated(
  value: unknown,
  data = loadCoordinatedDataset((value as ResearchSubmission)?.dataset_id),
) {
  const plan = planCoordinated(value, data),
    root = resolveWorkbenchRepositoryRoot({ moduleUrl: import.meta.url });
  const files = [
    "artifacts/api-server/src/lib/workbench/coordinated-contract.ts",
    "research/coordinated/models.ts",
    "research/coordinated/forecasts.ts",
    "artifacts/api-server/src/lib/workbench/coordinated-data.ts",
    "artifacts/api-server/src/lib/yahoo.ts",
    "research/coordinated/engine.ts",
    "artifacts/api-server/src/lib/workbench/coordinated-calendar.ts",
    "artifacts/api-server/src/lib/workbench/coordinated-service.ts",
    "artifacts/api-server/src/workbench-coordinated-worker.ts",
  ];
  return {
    ...plan.normalized_request,
    dataset_id: (data.snapshot as any).dataset_id ?? "internal",
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
        : (plan.normalized_request.forecast?.model ?? "HISTORICAL_MEAN"),
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
export function coordinatedCapabilities(datasetId?: string) {
  const data = loadCoordinatedDataset(datasetId);
  return {
    ...boundaryV2,
    supported_spec_version: COORDINATED_SPEC,
    etfs:
      (data.snapshot as any).dataset_id &&
      (data.snapshot as any).dataset_id !== "internal"
        ? [...new Set(data.rows.flatMap((r) => Object.keys(r.prices)))].sort()
        : ETF_UNIVERSE,

    forecast_models: ["HISTORICAL_MEAN", "MANUAL_SCORE", "SIGNAL_RIDGE"],
    default_forecast: DEFAULT_FORECAST,
    data_snapshot: data.snapshot,
    data_first_observation: data.snapshot.data_first_observation,
    data_last_observation: data.snapshot.data_last_observation,
    data_source: (data.snapshot as any).source ?? "INTERNAL_CERTIFIED_SNAPSHOT",
    dataset_id: (data.snapshot as any).dataset_id ?? "internal",
    dataset_fetched_at: (data.snapshot as any).fetched_at ?? null,
    models: ["CURRENT", "TREND", "TREND_VOL", "HMM"],
    control_modes: ["MAX_EXPOSURE", "RISK_BUDGET"],
    research_scopes: ["PORTFOLIO", "CAPITAL_EXPOSURE"],
    training_history_policy: "USER_SELECTED_WINDOW_NO_STATISTICAL_MINIMUM",
  };
}
