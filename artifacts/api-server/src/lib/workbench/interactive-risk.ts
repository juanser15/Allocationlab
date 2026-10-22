/** Exact wrapper from certified B3C attribution; unchanged analytics definitions. */
import { conditionalMetrics, regression, DEFAULT_REGRESSION, mean, type Pair } from "../allocation-core/risk-analytics/analytics";
import { capitalEfficiency, ratio } from "../allocation-core/risk-analytics/diagnostics";
import type { ControlDay } from "./exposure-controls";
const { summarize } = require("../../../../../research/capital/metrics") as {summarize(rows: Observation[], reference: number): any};
interface Observation {date:string;net_return:number;turnover:number;costs:number;exposure:number}
export function interactiveRiskMetrics(
  observations: Observation[],
  days: ControlDay[],
  history: Array<{ date: string; adjusted_close: number }>,
  rf: number,
) {
  const p: Pair[] = observations.map((o, i) => ({
    date: o.date,
    portfolio: o.net_return,
    market: days[i].market_return,
    rf: days[i].cash_return,
  }));
  const performance = summarize(observations, rf);
  const cutoff = days.at(-1)!.date;
  const marketRisk = conditionalMetrics(p, history, cutoff);
  const capm = regression(p, "CAPM", cutoff, DEFAULT_REGRESSION);
  return {
    observations: performance.observations,
    cagr: performance.cagr,
    annualized_volatility: performance.volatility,
    max_drawdown: performance.max_drawdown,
    net_sharpe: performance.net_sharpe,
    final_research_index: performance.final_index,
    average_risky_exposure: performance.exposure,
    average_cash_allocation: mean(observations.map((o) => 1 - o.exposure)),
    gross_turnover: performance.turnover,
    realized_simulated_cost: performance.costs,
    full_sample_beta: marketRisk.full_beta,
    upside_beta: marketRisk.upside_beta,
    downside_beta: marketRisk.downside_beta,
    drawdown_beta: marketRisk.drawdown_beta,
    tail_beta: marketRisk.tail_beta,
    upside_capture: marketRisk.upside_capture,
    downside_capture: marketRisk.downside_capture,
    risk_methodology_version: marketRisk.methodology_version,
    risk_configuration_hash: marketRisk.configuration_hash,
    performance_methodology:
      "Certified capital summarize: 252 / OOS observations annualization and sample-variance net Sharpe; independent-sleeve returns compounded.",
    capm_alpha_diagnostic: {
      ...capm,
      standard_error_daily: capm.standard_errors?.[0] ?? "NOT_SUPPORTED",
      standard_error_annualized: capm.standard_errors
        ? capm.standard_errors[0] * 252
        : "NOT_SUPPORTED",
      annualization:
        "Daily intercept and its standard error multiplied by 252; t-statistic unchanged.",
      claim: "DIAGNOSTIC_ONLY_NO_AUTOMATIC_ALPHA_CLAIM",
    },
    capital_efficiency: {
      ...capitalEfficiency(
        performance.cagr,
        performance.volatility,
        marketRisk.full_beta.value !== null && marketRisk.full_beta.value > 0
          ? marketRisk.full_beta.value
          : NaN,
      ),
      cagr_per_average_spy_exposure: ratio(
        performance.cagr,
        performance.exposure,
      ),
      beta_denominator: "REALIZED_FULL_SAMPLE_BETA_NOT_EXPECTED_BETA",
      explanation:
        "Lower average exposure may release capital for other independent strategies. This does not by itself establish market-timing skill.",
    },
  };
}
