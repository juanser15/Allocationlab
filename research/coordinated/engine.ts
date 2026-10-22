import assert from "node:assert/strict";
import {
  computeRegime,
  defaultBacktestConfig,
  type PriceRow,
  type EnrichedRegimeScores,
  type BacktestLedgerEntry,
} from "../../artifacts/api-server/src/lib/calculator";
import { runScheduledLedger } from "../workbench/interactive-ledger";
import { summarize } from "../capital/metrics";
import { hash } from "../capital/spec";
import {
  planCoordinated,
  requestFromSpec,
  type CoordinatedSpec,
} from "../../artifacts/api-server/src/lib/workbench/coordinated-calendar";
import type { DatasetV2 } from "../../artifacts/api-server/src/lib/workbench/calendar-v2";
import { fitGaussianHMM, moments, optimize, ResearchError } from "./models";
import { isCapitalStudy } from "../../artifacts/api-server/src/lib/workbench/coordinated-contract";

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
      turnover: gross / (day.beginningNav + day.etfPnl),
      costs: day.transactionCosts,
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
) {
  const started = performance.now(),
    request = requestFromSpec(spec),
    plan = planCoordinated(request, data),
    decisions: any[] = [];
  const study = isCapitalStudy(request),
    etfs = study ? ["SPY"] : request.etfs;
  let completed = 0;
  const progress = (stage: string) => {
    completed++;
    const elapsed = performance.now() - started;
    onProgress({
      status: completed === plan.total_work_units ? "SUCCESS" : "RUNNING",
      stage,
      completed_work_units: completed,
      total_work_units: plan.total_work_units,
      percent_complete: (100 * completed) / plan.total_work_units,
      current_fold: decisions.length,
      total_folds: plan.number_of_folds,
      elapsed_ms: elapsed,
      estimated_remaining_ms:
        completed > 1
          ? ((plan.total_work_units - completed) * elapsed) / completed
          : null,
      eta_confidence: completed > 1 ? "OBSERVED" : "ESTIMATING",
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
  const result = runScheduledLedger(
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
      const fold = plan.folds.find((f) => f.decision_date === signalDate)!;
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
      const regime = classify(
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
      const last = available.at(-1)!;
      const prior = etfs.map(
        (t) => ((ctx!.quantities[t] ?? 0) * last.prices[t]) / ctx!.nav,
      );
      let solution: ReturnType<typeof optimize>;
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
      } else
        solution = optimize(estimates.mean, estimates.covariance, prior, {
          cap,
          maxWeight: request.maximum_etf_weight,
          riskAversion: request.risk_aversion,
          cost: request.transaction_cost_bps / 10000,
          horizon: request.rebalance_frequency === "MONTHLY" ? 1 / 12 : 1 / 4,
          volatility: budget,
        });
      const weights = Object.fromEntries(
        etfs.map((t, i) => [t, solution.weights[i]]),
      );
      decisions.push({
        ...fold,
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
            },
        estimates,
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
    },
    plan.folds.map((f) => f.decision_date),
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
    const passive = runScheduledLedger(
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
  return {
    status: "SUCCESS",
    plan,
    ...financial,
    research_scope: study ? "CAPITAL_EXPOSURE" : "PORTFOLIO",
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
    execution_profile: { elapsed_ms: performance.now() - started },
    ledger,
  };
}
