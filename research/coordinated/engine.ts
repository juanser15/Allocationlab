import assert from "node:assert/strict";
import {
  computeRegime,
  defaultBacktestConfig,
  type PriceRow,
  type EnrichedRegimeScores,
  type BacktestLedgerEntry,
} from "../../artifacts/api-server/src/lib/calculator";
import { runScheduledLedger } from "../workbench/interactive-ledger";
import type { QualityContext, QualityDecision } from "./quality";
import { summarize } from "../capital/metrics";
import { hash } from "../capital/spec";
import {
  planCoordinated,
  requestFromSpec,
  type CoordinatedSpec,
} from "../../artifacts/api-server/src/lib/workbench/coordinated-calendar";
import type { DatasetV2 } from "../../artifacts/api-server/src/lib/workbench/calendar-v2";
import { fitGaussianHMM, moments, optimize, ResearchError } from "./models";
import {
  isCapitalStudy,
  DEFAULT_FORECAST,
} from "../../artifacts/api-server/src/lib/workbench/coordinated-contract";
import { buildAssetForecast } from "./forecasts";
import { anchoredMonth } from "../../artifacts/api-server/src/lib/workbench/interactive-calendar";
import { riskyTemplate, overlayExposure, capitalClockEvidence, EXPOSURE_TOLERANCE } from "./capital-clock";
import { SUPPORT_TOLERANCE, CONSTRAINT_TOLERANCE } from "../../artifacts/api-server/src/lib/workbench/portfolio-numerics";
import type { CoordinatedRequest } from "../../artifacts/api-server/src/lib/workbench/coordinated-contract";

/** The capital overlay is a separate policy, never a repair of solver weights.
 * An intramonth NAV floor conflict cannot be cured by changing frozen support. */
export function assertFrozenOverlayMandate(
  weights: number[], template: ReturnType<typeof riskyTemplate>,
  mandate: NonNullable<CoordinatedRequest["mandate"]> | undefined,
  context: Record<string, unknown>, explicitRiskOff: boolean,
) {
  if (!mandate) return;
  const allCash = weights.every(w => w === 0);
  if (allCash && explicitRiskOff) return;
  const active = weights.filter(w => w > SUPPORT_TOLERANCE);
  const floorResidual = active.length ? Math.max(0, mandate.minimum_weight - Math.min(...active)) : mandate.minimum_weight;
  if (!allCash && active.length >= mandate.minimum_positions && active.length <= mandate.maximum_positions && floorResidual <= CONSTRAINT_TOLERANCE) return;
  const positiveProportions = template.proportions.filter(p => p > 0);
  const requiredExposure = positiveProportions.length
    ? Math.max(...positiveProportions.map(p => mandate.minimum_weight / p)) : null;
  throw new ResearchError("SOLVER_INFEASIBLE", "The capital policy's positive exposure cannot meet the minimum NAV weight with this frozen ETF composition. No positions were changed or re-optimized.", {
    category: "SOLVER_INFEASIBLE", reason: "FROZEN_COMPOSITION_EXPOSURE_CONFLICT",
    failed_stage: "CAPITAL_OVERLAY", ...context,
    actual_exposure: weights.reduce((sum, w) => sum + w, 0),
    minimum_required_exposure_for_frozen_composition: requiredExposure,
    positive_holdings: active.length, minimum_positive_nav_weight: active.length ? Math.min(...active) : null,
    minimum_weight: mandate.minimum_weight, minimum_positions: mandate.minimum_positions,
    maximum_positions: mandate.maximum_positions, support_tolerance: SUPPORT_TOLERANCE,
    constraint_tolerance: CONSTRAINT_TOLERANCE,
    suggestion: "Change the NAV weight floor or capital policy explicitly, then create a new design. A cash decision remains allowed; the system will not substitute cash for a positive-risk signal.",
  });
}

function ledgerPoints(ledger: BacktestLedgerEntry[], costBps: number) {
  let high = 100;
  return ledger.map((day) => {
    const gross = day.trades.reduce((s, t) => s + Math.abs(t.notional), 0);
    assert.ok(
      Math.abs(
        day.beginningNav +
          day.etfPnl +
          day.cashPnl -
          day.transactionCosts -
           day.slippage -
          day.endingNav,
      ) < 1e-8,
    );
    assert.ok(
      Math.abs(day.transactionCosts - (gross * costBps) / 10000) < 1e-8,
    );
    high = Math.max(high, day.endingNav);
    return {
      date: day.date,
      index: day.endingNav,
      drawdown: day.endingNav / high - 1,
      net_return: day.netPnl / day.beginningNav,
      exposure: 1 - day.endingCash / day.endingNav,
      cash_allocation: day.endingCash / day.endingNav,
      turnover: gross / (day.beginningNav + day.etfPnl + day.cashPnl),
      costs: day.transactionCosts + day.slippage,
      weights: Object.fromEntries(
        day.endingPositions.map((p) => [
          p.ticker,
          p.marketValue / day.endingNav,
        ]),
      ),
    };
  });
}

export function classify(
  model: string,
  history: PriceRow[],
  referenceUniverse: string[],
) {
  const prices = history.map((r) => r.prices.SPY),
    returns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
  if (model === "HMM") return fitGaussianHMM(returns);
  if (model === "CURRENT") {
    const regime = computeRegime(history.slice(-252), referenceUniverse);
    return {
      model: "CURRENT_REGIME_SCORE",
      high_risk_probability: null,
      defensive_score: 1 - regime.composite / 100,
      label: regime.label,
      regime,
    };
  }
  const sma = prices.slice(-200).reduce((a, b) => a + b, 0) / 200,
    below = prices.at(-1)! < sma;
  const vol = (r: number[]) => {
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    return Math.sqrt(
      (r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1)) * 252,
    );
  };
  const short = vol(returns.slice(-21)),
    long = vol(returns.slice(-252)),
    elevated = short > long;
  const defensive =
    model === "TREND" ? Number(below) : (Number(below) + Number(elevated)) / 2;
  return {
    model,
    high_risk_probability: null,
    defensive_score: defensive,
    label:
      defensive === 0 ? "Supportive" : defensive === 1 ? "Defensive" : "Mixed",
    sma_200: sma,
    volatility_21: short,
    volatility_252: long,
  };
}
export function runCoordinated(
  spec: CoordinatedSpec,
  data: DatasetV2,
  onProgress: (p: any) => void = () => {},
  ledgerRunner: typeof runScheduledLedger = runScheduledLedger,
  observeQuality?: (context: QualityContext) => QualityDecision,
  dependencies: { classifyCapital?: typeof classify } = {},
) {
  const started = performance.now(),
    request = requestFromSpec(spec),
    plan = planCoordinated(request, data),
    decisions: any[] = [];
  const study = isCapitalStudy(request),
    etfs = study ? ["SPY"] : request.etfs;
  // Lower-level requestFromSpec intentionally strips institutional fields.
  // Take the frozen mandate from the run spec so it reaches portfolio construction.
  const mandate = study ? undefined : (spec as CoordinatedSpec & Pick<CoordinatedRequest, "mandate">).mandate;
  const daily = request.capital_signal_frequency === "DAILY";
  const signalDates = daily
    ? data.rows.filter(r => r.date >= plan.folds[0].decision_date && r.date < request.evaluation_end_exclusive).map(r => r.date)
    : plan.folds.map(f => f.decision_date);
  const workUnits = plan.total_work_units;
  const capitalSignals: any[] = [];
  let template = study ? riskyTemplate([1]) : riskyTemplate(etfs.map(() => 0));
  let previousExposure: number | null = null;
  let templateDate: string | null = null;
  let completed = 0;
  const progress = (stage: string) => {
    completed++;
    const elapsed = performance.now() - started;
    onProgress({
      status: completed === workUnits ? "SUCCESS" : "RUNNING",
      stage,
      completed_work_units: completed,
      total_work_units: workUnits,
      percent_complete: (100 * completed) / workUnits,
      current_fold: decisions.length,
      total_folds: plan.number_of_folds,
      elapsed_ms: elapsed,
      estimated_remaining_ms:
        completed > 1
          ? ((workUnits - completed) * elapsed) / completed
          : null,
      eta_confidence: completed > 1 ? "OBSERVED" : "ESTIMATING",
      ...(daily ? {
        completed_signals: capitalSignals.length,
        total_signals: signalDates.length,
        current_signal_date: capitalSignals.at(-1)?.decision_date ?? null,
      } : {}),
    });
  };
  progress("Preparing shared data");
  let display: EnrichedRegimeScores = {
    trend: 0,
    breadth: 0,
    volatility: 0,
    liquidity: 0,
    composite: 0,
    label: "Unclassified",
    components: [],
    confidence: 0,
    drivers: "See coordinated decision evidence",
  };
  const result = ledgerRunner(
    data.rows.filter((r) => r.date < request.evaluation_end_exclusive),
    etfs.map((ticker) => ({
      ticker,
      name: ticker,
      sector: "Selected ETF",
      enabled: true,
      priorWeight: 0,
    })),
    {
      cashMin: 0,
      cashMax: 1,
      maxEtfWeight: 1,
      minEtfWeight: 0,
      minInclusionThreshold: 0,
      targetActiveEtfs: etfs.length,
      diversificationEnabled: false,
    },
    {
      ...defaultBacktestConfig(),
      warmupDays: 0,
      startDate: request.evaluation_start,
      executionTiming: "next_close",
      transactionCostBps: request.transaction_cost_bps,
      slippageBps: 0,
      maxTurnoverPerRebalance: 1,
      cashYieldAnnual: 0,
    },
    null,
    undefined,
    (signalDate, available, ctx) => {
      const scheduledFold = plan.folds.find((f) => f.decision_date === signalDate);
      const fold = daily ? {
        ...(scheduledFold ?? plan.folds[0]),
        decision_date: signalDate,
        information_cutoff: available.at(-1)!.date,
        training_start: request.window_type === "ROLLING"
          ? anchoredMonth(signalDate, -request.training_window_months)
          : plan.folds[0].training_start,
        training_end_exclusive: signalDate,
      } : scheduledFold!;
      assert.ok(
        ctx &&
          available.at(-1)!.date === fold.information_cutoff &&
          ctx.asOf === fold.information_cutoff &&
          available.every((r) => r.date < signalDate),
      );
      const training = available.filter((r) => r.date >= fold.training_start);
      // Learned estimates use exactly the user's training window. Fixed-lookback
      // indicators use their own causal feature history, independently of fit length.
      const regimeHistory =
        request.regime_model === "HMM" ? training : available.slice(-253);
      const regime = (daily ? dependencies.classifyCapital ?? classify : classify)(
        request.regime_model,
        regimeHistory,
        data.fixture.reference_universe,
      );
      const defensive =
        "defensive_score" in regime
          ? regime.defensive_score
          : regime.high_risk_probability;
      const multiplier =
        request.regime_response === "FIXED"
          ? 1
          : 1 - (1 - request.defensive_multiplier) * defensive!;
      const cap =
        request.control_mode === "MAX_EXPOSURE"
          ? request.maximum_exposure * multiplier
          : 1;
      const budget =
        request.control_mode === "RISK_BUDGET"
          ? request.risk_budget * multiplier
          : null;
      const estimates = moments(
        training.map((r) => etfs.map((t) => r.prices[t])),
        study ? 1 : request.covariance_shrinkage,
      );
      let optimizerCalled = false;
      const recordCapitalSignal = (exposure: number, forceTrade: boolean) => {
        const changed = previousExposure === null || Math.abs(exposure - previousExposure) > EXPOSURE_TOLERANCE;
        const tradeRequested = forceTrade || changed;
        capitalSignals.push({
          decision_date: signalDate, information_cutoff: fold.information_cutoff,
          training_start: fold.training_start, training_observations: training.length,
          execution_date: data.rows.find(r => r.date > signalDate && r.date < request.evaluation_end_exclusive)?.date ?? null,
          optimizer_refreshed: !study && !!scheduledFold && (mandate ? optimizerCalled : true),
          rebalance_date: !!scheduledFold,
          source_optimizer_date: templateDate,
          exposure, frozen_risky_proportions: Object.fromEntries(etfs.map((t, i) => [t, template.proportions[i]])),
          trade_requested: tradeRequested, regime,
          regime_information_start: regimeHistory[0].date,
        });
        previousExposure = exposure;
        display = { ...display, label: request.regime_model, composite: (1 - defensive!) * 100 };
        return tradeRequested;
      };
      if (daily && !scheduledFold) {
        const overlay = overlayExposure(template, estimates.covariance, cap, budget);
        assertFrozenOverlayMandate(overlay.weights, template, mandate, {
          fold_id: plan.folds.find(f => f.decision_date === templateDate)?.fold_id,
          decision_date: signalDate, information_cutoff: fold.information_cutoff,
          source_optimizer_date: templateDate, effective_cap: cap, effective_risk_budget: budget,
        }, cap === 0 || budget === 0 || (template.maximum_exposure === 0 && request.control_mode === "MAX_EXPOSURE" && request.maximum_exposure === 0));
        const tradeRequested = recordCapitalSignal(overlay.exposure, false);
        progress("Refreshing daily capital signal · ETF optimizer not run");
        return tradeRequested ? Object.fromEntries(etfs.map((t, i) => [t, overlay.weights[i]])) : null;
      }
      const last = available.at(-1)!;
      const prior = etfs.map(
        (t) => ((ctx!.quantities[t] ?? 0) * last.prices[t]) / ctx!.nav,
      );
      let solution: ReturnType<typeof optimize>;
      const forecast = study
        ? null
        : buildAssetForecast(
            request.forecast ?? DEFAULT_FORECAST,
            observeQuality ? training : available,
            etfs,
            estimates.mean,
            request.rebalance_frequency === "MONTHLY" ? 1 / 12 : 1 / 4,
          );
      const quality = !study && observeQuality ? observeQuality({ request, fold, training, assets: etfs, forecast }) : undefined;
      if (study) {
        const spyVolatility = Math.sqrt(estimates.covariance[0][0]);
        if (!Number.isFinite(spyVolatility) || spyVolatility <= 0)
          throw new ResearchError(
            "OPTIMIZATION_INVALID_RISK",
            "SPY volatility is undefined in the selected study window.",
          );
        const exposure =
          budget === null ? cap : Math.min(1, budget / spyVolatility);
        solution = {
          weights: [exposure],
          cash: 1 - exposure,
          exposure,
          volatility: exposure * spyVolatility,
          residual: 0,
          iterations: 0,
          risk_multiplier: 0,
        };
      } else {
        const optimizerCap = daily ? (request.control_mode === "MAX_EXPOSURE" ? request.maximum_exposure : 1) : cap;
        const optimizerRiskBudget = daily && budget !== null ? request.risk_budget : budget;
        if (optimizerCap === 0 || optimizerRiskBudget === 0) {
          // Explicit capital risk-off, not an optimizer fallback or underflow test.
          solution = { weights: etfs.map(() => 0), cash: 1, exposure: 0, volatility: 0,
            residual: 0, iterations: 0, risk_multiplier: 0 };
        } else try {
        optimizerCalled = true;
        solution = optimize(
          forecast!.annual_mean,
          estimates.covariance,
          prior,
          {
            cap: optimizerCap,
            maxWeight: request.maximum_etf_weight,
            riskAversion: request.risk_aversion,
            cost: request.transaction_cost_bps / 10000,
            horizon: forecast!.horizon_years,
            volatility: optimizerRiskBudget,
            ...(mandate ? { mandate } : {}),
          },
        );
        } catch (error) {
          if (error instanceof ResearchError) throw new ResearchError(error.code, error.message, {
            ...error.details, failed_stage: "PORTFOLIO_OPTIMIZATION", fold_id: fold.fold_id,
            decision_date: signalDate, information_cutoff: fold.information_cutoff,
          });
          throw error;
        }
      }
      let preOverlayWeights: number[] | null = null;
      if (daily) {
        if (!study) {
          preOverlayWeights = [...solution.weights];
          template = riskyTemplate(solution.weights);
        }
        templateDate = signalDate;
        const overlay = overlayExposure(template, estimates.covariance, cap, budget);
        assertFrozenOverlayMandate(overlay.weights, template, mandate, {
          fold_id: fold.fold_id, decision_date: signalDate, information_cutoff: fold.information_cutoff,
          source_optimizer_date: templateDate, effective_cap: cap, effective_risk_budget: budget,
        }, cap === 0 || budget === 0 || (template.maximum_exposure === 0 && request.control_mode === "MAX_EXPOSURE" && request.maximum_exposure === 0));
        solution = { ...solution, weights: overlay.weights, exposure: overlay.exposure, cash: 1 - overlay.exposure, volatility: overlay.volatility };
        recordCapitalSignal(overlay.exposure, true);
      }
      const weights = Object.fromEntries(
        etfs.map((t, i) => [t, solution.weights[i]]),
      );
      decisions.push({
        ...fold,
        ...(daily ? { capital_overlay: {
          pre_overlay_optimizer_weights: preOverlayWeights,
          baseline_maximum_exposure: template.maximum_exposure,
          frozen_risky_proportions: Object.fromEntries(etfs.map((t, i) => [t, template.proportions[i]])),
          optimizer_cap: request.control_mode === "MAX_EXPOSURE" ? request.maximum_exposure : 1,
          optimizer_risk_budget: budget === null ? null : request.risk_budget,
        } } : {}),
        ...(quality ? { quality } : {}),
        regime_information_start: regimeHistory[0].date,
        regime_observations: regimeHistory.length,
        regime,
        multiplier,
        maximum_exposure: cap,
        risk_budget: budget,
        weights,
        cash: solution.cash,
        estimated_volatility: solution.volatility,
        decision_method: study
          ? "CAPITAL_POLICY_SPY_CASH"
          : "PORTFOLIO_OPTIMIZATION",
        optimizer: study
          ? null
          : {
              residual: solution.residual,
              iterations: solution.iterations,
              risk_multiplier: solution.risk_multiplier,
              ...(mandate ? {
                audit: solution.audit ?? { status: "ALL_CASH_CAPITAL_POLICY", selected_support: [], support_size: 0 },
                selected_support_tickers: etfs.filter((_t, i) => (preOverlayWeights ?? solution.weights)[i] > SUPPORT_TOLERANCE),
                optimized_nav_weights: Object.fromEntries(etfs.map((t, i) => [t, (preOverlayWeights ?? solution.weights)[i]])),
                effective_nav_weights: weights,
                effective_constraint_residuals: {
                  exposure_ceiling: Math.max(0, solution.exposure - cap),
                  maximum_weight: Math.max(0, ...solution.weights.map(w => w - request.maximum_etf_weight)),
                  minimum_weight: solution.weights.every(w => w === 0) ? 0 : Math.max(0, ...solution.weights.filter(w => w > SUPPORT_TOLERANCE).map(w => mandate.minimum_weight - w)),
                  minimum_holdings: solution.weights.every(w => w === 0) ? 0 : Math.max(0, mandate.minimum_positions - solution.weights.filter(w => w > SUPPORT_TOLERANCE).length),
                  maximum_holdings: Math.max(0, solution.weights.filter(w => w > SUPPORT_TOLERANCE).length - mandate.maximum_positions),
                  volatility_ceiling: budget === null ? 0 : Math.max(0, solution.volatility - budget),
                },
                frozen_mandate: mandate,
                exposure_policy: "CEILING_WITH_CASH_RESIDUAL",
                capital_overlay_separate: daily,
              } : {}),
            },
        estimates,
        forecast,
        prior_weights: Object.fromEntries(etfs.map((t, i) => [t, prior[i]])),
      });
      display = {
        ...display,
        label: request.regime_model,
        composite: (1 - defensive!) * 100,
      };
      progress(
        study
          ? "Applying SPY/cash capital policy"
          : "Classifying regime and optimizing portfolio",
      );
      return weights;
    },
    {
      initialNav: 100,
      initialCash: 100,
      initialHoldings: {},
      dailyCashYield: 0,
      allowShortPositions: false,
      d5GrossTradeCosts: true,
      ...(daily ? { separateCapitalClock: true } : {}),
    },
    signalDates,
    () => display,
  );
  if (!result.hasSufficientData)
    throw new ResearchError(
      "EXECUTION_ACCOUNTING_FAILURE",
      "The continuous ledger could not produce a valid portfolio.",
      { reason: result.insufficientReason },
    );
  const ledger = result.dailyLedger.filter(
    (d) =>
      d.date >= request.evaluation_start &&
      d.date < request.evaluation_end_exclusive,
  );
  const points = ledgerPoints(ledger, request.transaction_cost_bps);
  const metrics = summarize(points, 0),
    financial = { metrics, points, decisions };
  let benchmark: any = undefined;
  if (study) {
    const passive = ledgerRunner(
      data.rows.filter((r) => r.date < request.evaluation_end_exclusive),
      [
        {
          ticker: "SPY",
          name: "SPY",
          sector: "Passive benchmark",
          enabled: true,
          priorWeight: 0,
        },
      ],
      {
        cashMin: 0,
        cashMax: 1,
        maxEtfWeight: 1,
        minEtfWeight: 0,
        minInclusionThreshold: 0,
        targetActiveEtfs: 1,
        diversificationEnabled: false,
      },
      {
        ...defaultBacktestConfig(),
        warmupDays: 0,
        startDate: request.evaluation_start,
        executionTiming: "next_close",
        transactionCostBps: request.transaction_cost_bps,
        slippageBps: 0,
        maxTurnoverPerRebalance: 1,
        cashYieldAnnual: 0,
      },
      null,
      undefined,
      () => ({ SPY: 1 }),
      {
        initialNav: 100,
        initialCash: 100,
        initialHoldings: {},
        dailyCashYield: 0,
        allowShortPositions: false,
        d5GrossTradeCosts: true,
      },
      [plan.folds[0].decision_date],
      () => display,
    );
    if (!passive.hasSufficientData)
      throw new ResearchError(
        "EXECUTION_ACCOUNTING_FAILURE",
        "Passive SPY benchmark could not be calculated.",
        { reason: passive.insufficientReason },
      );
    const passiveLedger = passive.dailyLedger.filter(
        (d) =>
          d.date >= request.evaluation_start &&
          d.date < request.evaluation_end_exclusive,
      ),
      passivePoints = ledgerPoints(passiveLedger, request.transaction_cost_bps);
    assert.deepEqual(
      passivePoints.map((p) => p.date),
      points.map((p) => p.date),
    );
    benchmark = {
      label: "Passive SPY",
      methodology: "BUY_ONCE_SAME_FIRST_NEXT_CLOSE_AND_COSTS",
      metrics: summarize(passivePoints, 0),
      points: passivePoints,
      ledger: passiveLedger,
    };
  }
  progress(
    study
      ? "Publishing exposure study and SPY benchmark"
      : "Publishing portfolio results",
  );
  const pairs: {
    predicted: number;
    realized: number;
    ticker: string;
    decision_date: string;
    label_end: string;
  }[] = [];
  for (const decision of decisions) {
    const horizon = decision.forecast?.horizon_sessions;
    if (!horizon) continue;
    const execution =
        data.rows.findIndex((r) => r.date === decision.decision_date) + 1,
      end = execution + horizon;
    if (
      !data.rows[end] ||
      data.rows[end].date >= request.evaluation_end_exclusive
    )
      continue;
    for (const prediction of decision.forecast.predictions)
      pairs.push({
        predicted: prediction.expected_return,
        realized:
          data.rows[end].prices[prediction.ticker] /
            data.rows[execution].prices[prediction.ticker] -
          1,
        ticker: prediction.ticker,
        decision_date: decision.decision_date,
        label_end: data.rows[end].date,
      });
  }
  const avg = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const pMean = avg(pairs.map((p) => p.predicted)),
    rMean = avg(pairs.map((p) => p.realized));
  const covariance = pairs.reduce(
      (s, p) => s + (p.predicted - pMean) * (p.realized - rMean),
      0,
    ),
    denominator = Math.sqrt(
      pairs.reduce((s, p) => s + (p.predicted - pMean) ** 2, 0) *
        pairs.reduce((s, p) => s + (p.realized - rMean) ** 2, 0),
    );
  const forecastDiagnostics = {
    pairs: pairs.length,
    correlation: denominator > 0 ? covariance / denominator : null,
    mean_absolute_error: pairs.length
      ? avg(pairs.map((p) => Math.abs(p.predicted - p.realized)))
      : null,
    definition: "POOLED_MATURED_ASSET_DECISION_PAIRS_WITHIN_EVALUATION_ONLY",
    inference: "DESCRIPTIVE_ONLY_OVERLAPPING_OUTCOMES_NOT_INDEPENDENT",
    observations: pairs,
  };
  return {
    status: "SUCCESS",
    plan,
    ...financial,
    research_scope: study ? "CAPITAL_EXPOSURE" : "PORTFOLIO",
    ...(!study ? { forecast_diagnostics: forecastDiagnostics } : {}),
    ...(benchmark ? { benchmark } : {}),
    financial_result_hash: hash(
      benchmark ? { ...financial, benchmark } : financial,
    ),
    warnings: plan.warnings,
    accounting: {
      initial_nav: 100,
      final_nav: points.at(-1)!.index,
      costs_charged: metrics.costs,
      continuous_holdings: true,
      cash_yield: 0,
      cost_basis: "ABSOLUTE_TRADED_NOTIONAL",
      constraint_scope: study
        ? "DECISION_TARGETS_SPY_CASH"
        : "DECISION_TARGETS_ALL_SELECTED_ETFS",
      execution: "NEXT_OBSERVED_CLOSE",
    },
    capital_clock: capitalClockEvidence(
      daily ? "DAILY" : "REBALANCE_ONLY",
      daily ? capitalSignals : decisions.map(d => ({
        decision_date: d.decision_date, information_cutoff: d.information_cutoff,
        training_start: d.training_start, execution_date: data.rows.find(r => r.date > d.decision_date && r.date < request.evaluation_end_exclusive)?.date ?? null,
        optimizer_refreshed: !study && d.optimizer?.audit?.status !== "ALL_CASH_CAPITAL_POLICY", rebalance_date: true, exposure: 1 - d.cash, trade_requested: true,
        frozen_risky_proportions: null,
      })),
      ledger,
    ),
    execution_profile: { elapsed_ms: performance.now() - started },
    ledger,
  };
}
