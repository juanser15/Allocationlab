import assert from "node:assert/strict";
import {
  computeRegime,
  defaultBacktestConfig,
  type PriceRow,
  type EnrichedRegimeScores,
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
    request.etfs.map((ticker) => ({
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
      targetActiveEtfs: request.etfs.length,
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
      const regime = classify(
        request.regime_model,
        training,
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
        training.map((r) => request.etfs.map((t) => r.prices[t])),
        request.covariance_shrinkage,
      );
      const last = available.at(-1)!;
      const prior = request.etfs.map(
        (t) => ((ctx!.quantities[t] ?? 0) * last.prices[t]) / ctx!.nav,
      );
      const solution = optimize(estimates.mean, estimates.covariance, prior, {
        cap,
        maxWeight: request.maximum_etf_weight,
        riskAversion: request.risk_aversion,
        cost: request.transaction_cost_bps / 10000,
        horizon: request.rebalance_frequency === "MONTHLY" ? 1 / 12 : 1 / 4,
        volatility: budget,
      });
      const weights = Object.fromEntries(
        request.etfs.map((t, i) => [t, solution.weights[i]]),
      );
      decisions.push({
        ...fold,
        regime,
        multiplier,
        maximum_exposure: cap,
        risk_budget: budget,
        weights,
        cash: solution.cash,
        estimated_volatility: solution.volatility,
        optimizer: {
          residual: solution.residual,
          iterations: solution.iterations,
          risk_multiplier: solution.risk_multiplier,
        },
        estimates,
        prior_weights: Object.fromEntries(
          request.etfs.map((t, i) => [t, prior[i]]),
        ),
      });
      display = {
        ...display,
        label: request.regime_model,
        composite: (1 - defensive!) * 100,
      };
      progress("Classifying regime and optimizing portfolio");
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
  let high = 100;
  const points = ledger.map((day) => {
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
      Math.abs(
        day.transactionCosts - (gross * request.transaction_cost_bps) / 10000,
      ) < 1e-8,
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
  const metrics = summarize(points, 0),
    financial = { metrics, points, decisions };
  progress("Publishing portfolio results");
  return {
    status: "SUCCESS",
    plan,
    ...financial,
    financial_result_hash: hash(financial),
    warnings: plan.warnings,
    accounting: {
      initial_nav: 100,
      final_nav: points.at(-1)!.index,
      costs_charged: metrics.costs,
      continuous_holdings: true,
      cash_yield: 0,
      cost_basis: "ABSOLUTE_TRADED_NOTIONAL",
      constraint_scope: "DECISION_TARGETS_ALL_SELECTED_ETFS",
      execution: "NEXT_OBSERVED_CLOSE",
    },
    execution_profile: { elapsed_ms: performance.now() - started },
    ledger,
  };
}
