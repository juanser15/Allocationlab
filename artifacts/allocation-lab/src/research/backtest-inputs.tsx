import { freqLabel, freqOf, reductionPct } from "./capital-policy";
import { sourceLabel } from "./dataset-persistence";
import { cashPolicyLabel } from "./coordinated-p0";
import { models, pct } from "./coordinated-ui";
import { forecastNames } from "../../../api-server/src/lib/workbench/coordinated-contract";
import { portfolioFeasibilityIssue } from "../../../api-server/src/lib/workbench/portfolio-feasibility";

/** Compact, read-only summary of exactly what the portfolio backtest will submit. */
export function BacktestInputs({ draft, caps }: { draft: any; caps: any }) {
  const m = draft.mandate;
  const adaptive = draft.regime_response === "ADAPTIVE";
  const mult = adaptive ? draft.defensive_multiplier : 1;
  const risk = draft.control_mode === "RISK_BUDGET";
  const calm = risk ? draft.risk_budget : draft.maximum_exposure;
  const stress = calm * mult;
  const conflict = portfolioFeasibilityIssue(draft);
  const rowFields: Record<string, string[]> = {
    candidates: ["etfs"], holdings: ["mandate.minimum_positions", "mandate.maximum_positions"],
    "max-weight": ["maximum_etf_weight"], "min-weight": ["mandate.minimum_weight"],
    exposure: ["maximum_exposure"],
  };
  const exposure = risk
    ? `${pct(calm)} volatility ceiling${adaptive ? ` → ${pct(stress)} at full stress (${reductionPct(draft.defensive_multiplier)}% reduction)` : " · fixed"}`
    : `Up to ${pct(calm)} invested · at least ${pct(1 - calm)} cash${adaptive ? ` → full stress: up to ${pct(stress)} invested · at least ${pct(1 - stress)} cash (${reductionPct(draft.defensive_multiplier)}% reduction)` : " · fixed ceiling"}`;
  const rows: [string, string, string][] = [
    ["Candidates", `${draft.etfs?.length ?? 0} selected · candidates, not holdings`, "candidates"],
    ["Final holdings", m ? `${m.minimum_positions} min · ${m.maximum_positions} max when invested${draft.capital_signal_frequency === "DAILY" ? " · fully cash allowed" : ""}` : "No holding-count mandate · may hold zero to all candidates", "holdings"],
    ["Max weight per asset", `${pct(draft.maximum_etf_weight)} of total NAV`, "max-weight"],
    ["Min weight per held asset", m ? `${pct(m.minimum_weight)} of total NAV` : "None · no mandate", "min-weight"],
    ["Exposure rule", exposure, "exposure"],
    ["Model", `${models[draft.regime_model as keyof typeof models] ?? draft.regime_model} · ${forecastNames[(draft.forecast?.model ?? "HISTORICAL_MEAN") as keyof typeof forecastNames]} · mean–variance + costs`, "model"],
    ["Dataset", caps ? `${sourceLabel(caps.dataset_source)}${caps.dataset_version != null ? ` · v${caps.dataset_version}` : ""} · ${draft.dataset_id}` : String(draft.dataset_id || "Not loaded"), "dataset"],
    ["Dates", `${draft.evaluation_start || "not set"} → ${draft.evaluation_end_exclusive || "not set"} (To exclusive)`, "dates"],
    ["Training", `${draft.training_window_months} months · ${draft.window_type === "ROLLING" ? "rolling" : "expanding"}`, "training"],
    ["Rebalance", draft.rebalance_frequency === "MONTHLY" ? "Monthly" : "Quarterly", "rebalance"],
    ["Capital clock", freqLabel(freqOf(draft)), "clock"],
    ["Costs", `${draft.transaction_cost_bps} bps trading · ${draft.slippage_bps ?? 0} bps slippage`, "costs"],
    ["Cash", cashPolicyLabel(draft.cash_policy), "cash"],
  ];
  return (<>
    {conflict && <div className="cp-error" role="alert" data-testid="text-portfolio-conflict">
      <strong>{conflict.message}</strong><p>{conflict.suggestion}</p>
    </div>}
    <dl data-testid="list-backtest-inputs">
      {rows.map(([k, v, id]) => (
        <div key={id} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd data-testid={`text-input-${id}`} data-conflict={conflict?.fields.some(f => rowFields[id]?.includes(f)) || undefined}
            style={conflict?.fields.some(f => rowFields[id]?.includes(f)) ? { borderLeft: "3px solid #b54732", paddingLeft: ".6rem", fontWeight: 600 } : undefined}>{v}</dd>
        </div>
      ))}
    </dl>
  </>);
}
