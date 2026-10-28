import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  planInteractive,
  preparedDataset,
  INTERACTIVE_SPEC,
  interactiveCodeVersion,
  anchoredMonth,
  lowerBound,
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
  "capital_signal_frequency",
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
  if (v?.capital_signal_frequency !== undefined && !["DAILY", "REBALANCE_ONLY"].includes(v.capital_signal_frequency))
    throw new CalendarContractError("INVALID_RESEARCH_DESIGN", "Capital signal frequency must be DAILY or REBALANCE_ONLY.", {}, 422);
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
          k !== "capital_signal_frequency" &&
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
      new Set(v.etfs).size !== v.etfs.length ||
      v.etfs.some(
        (t) => typeof t !== "string" || !/^[A-Z0-9.^=-]{1,24}$/.test(t),
      )
    )
      invalid(!Array.isArray(v.etfs) || !v.etfs.length
        ? "Select at least one candidate asset from the active dataset."
        : new Set(v.etfs).size !== v.etfs.length
          ? "The candidate universe contains duplicate symbols. Select each asset only once."
          : "A candidate symbol has an invalid format. Select the asset using the active dataset selector.");
  }
  if (
    v.regime_response === "ADAPTIVE" &&
    v.control_mode === "RISK_BUDGET" &&
    v.defensive_multiplier === 0 &&
    v.capital_signal_frequency !== "DAILY"
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

function regimeLookbackSessions(model: ResearchSubmission["regime_model"]) {
  return model === "TREND_VOL" ? 253 : model === "TREND" ? 200 : model === "CURRENT" ? 10 : 0;
}
function forecastLookbackSessions(request: ResearchSubmission) {
  if (isCapitalStudy(request)) return 0;
  const forecast = request.forecast ?? DEFAULT_FORECAST;
  if (forecast.model === "HISTORICAL_MEAN") return 0;
  const enabled = forecast.signals.filter((s) => s.enabled);
  const signalLookback = enabled.length
    ? Math.max(...enabled.map((s) => s.lookback_sessions + s.skip_sessions + 1))
    : 0;
  if (forecast.model === "MANUAL_SCORE") return signalLookback;
  return signalLookback + forecast.training_sessions + forecast.horizon_sessions + 2;
}
export function deriveExperimentBounds(
  value: unknown,
  data = loadCoordinatedDataset((value as ResearchSubmission)?.dataset_id),
) {
  const request = parseCoordinated(value);
  const rows = data.rows;
  if (!rows.length)
    throw new CalendarContractError("EMPTY_DATASET", "The selected dataset contains no observations.", {}, 422);

  const requiredSymbols = [
    ...new Set(["SPY", ...(isCapitalStudy(request) ? [] : request.etfs)]),
  ];
  let commonStartIndex = 0;
  for (const ticker of requiredSymbols) {
    const index = rows.findIndex(
      (row) => Number.isFinite(row.prices[ticker]) && row.prices[ticker] > 0,
    );
    if (index < 0)
      throw new CalendarContractError(
        "DATASET_SYMBOL_MISSING",
        `The selected dataset does not contain required symbol ${ticker}.`,
        { ticker },
        422,
      );
    commonStartIndex = Math.max(commonStartIndex, index);
  }

  const commonStart = rows[commonStartIndex].date;
  const trainingBoundary = anchoredMonth(commonStart, request.training_window_months);
  const trainingIndex = lowerBound(rows, trainingBoundary);
  const causalSessions = Math.max(
    regimeLookbackSessions(request.regime_model),
    forecastLookbackSessions(request),
  );
  const causalIndex = Math.min(rows.length - 1, commonStartIndex + causalSessions);
  const earliestIndex = Math.max(trainingIndex, causalIndex);
  const earliest = rows[earliestIndex]?.date;
  if (!earliest)
    throw new CalendarContractError(
      "INSUFFICIENT_DATA_FOR_EXPERIMENT",
      "The selected dataset ends before the requested experiment can begin.",
      { common_data_start: commonStart, training_window_months: request.training_window_months, causal_sessions: causalSessions },
      422,
    );

  const last = rows.at(-1)!.date;
  const latestEndExclusive = new Date(Date.parse(last) + 86400000)
    .toISOString()
    .slice(0, 10);

  return {
    ...boundaryV2,
    dataset_id: (data.snapshot as any).dataset_id ?? "internal",
    dataset_start: data.snapshot.data_first_observation,
    dataset_end: data.snapshot.data_last_observation,
    common_required_data_start: commonStart,
    earliest_supported_evaluation_start: earliest,
    latest_supported_evaluation_end_exclusive: latestEndExclusive,
    training_window_months: request.training_window_months,
    regime_lookback_sessions: regimeLookbackSessions(request.regime_model),
    forecast_lookback_sessions: forecastLookbackSessions(request),
    effective_causal_lookback_sessions: causalSessions,
    required_symbols: requiredSymbols,
    rule:
      "DATASET_FIRST_THEN_EXPERIMENT_CONSUMES_HISTORY_V1",
  };
}

export function planCoordinated(
  value: unknown,
  data = loadCoordinatedDataset((value as ResearchSubmission)?.dataset_id),
) {
  const requested = parseCoordinated(value);
  const bounds = deriveExperimentBounds(requested, data);
  const request =
    requested.evaluation_start < bounds.earliest_supported_evaluation_start
      ? {
          ...requested,
          evaluation_start: bounds.earliest_supported_evaluation_start,
        }
      : requested;
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
    requested_evaluation_start: requested.evaluation_start,
    effective_evaluation_start: request.evaluation_start,
    experiment_bounds: bounds,
    total_work_units: (request.capital_signal_frequency === "DAILY"
      ? data.rows.filter(r => r.date >= base.folds[0].decision_date && r.date < request.evaluation_end_exclusive).length
      : base.folds.length) + 2,
    capital_signal_frequency: request.capital_signal_frequency ?? "REBALANCE_ONLY",
    capital_signal_count: request.capital_signal_frequency === "DAILY"
      ? data.rows.filter(r => r.date >= base.folds[0].decision_date && r.date < request.evaluation_end_exclusive).length
      : base.folds.length,
    estimated_jobs: base.folds.length + 2,
    warnings: [
      boundaryV2.pit_classification,
      "One continuous long-only portfolio; zero cash yield; next observed close fills. Constraints apply to decision targets, not intraperiod drift.",
      "Risk budget is an estimated annualized volatility ceiling, not a guaranteed loss limit.",
      "Forecast horizon and return units are recorded per decision. Daily covariance uses linear horizon scaling; no point-in-time vintage certification.",
      ...(requested.evaluation_start !== request.evaluation_start
        ? [
            `The requested start ${requested.evaluation_start} precedes the first statistically usable OOS date. The experiment therefore begins on ${request.evaluation_start}; earlier observations are consumed by training/lookbacks.`,
          ]
        : []),
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
