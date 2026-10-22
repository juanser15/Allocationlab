import type { ResearchSubmission } from "../../../api-server/src/lib/workbench/coordinated-contract";
import { models, pct } from "./coordinated-ui";

/** Draft inputs only: never present these values as saved-run results. */
export function StrategySummary({ draft, study = false, navigate }: {
  draft: ResearchSubmission;
  study?: boolean;
  navigate: (module: string) => void;
}) {
  const exposure = draft.control_mode === "MAX_EXPOSURE";
  const validExposure = Number.isFinite(draft.maximum_exposure) && draft.maximum_exposure >= 0 && draft.maximum_exposure <= 1;
  return (
    <aside className="cp-summary" aria-label={study ? "Independent study draft" : "Portfolio strategy draft"}>
      <div className="cp-summary-heading">
        <div className="cp-eyebrow">{study ? "INDEPENDENT STUDY" : "STRATEGY SUMMARY"}</div>
        <span className="cp-badge">Draft inputs</span>
      </div>
      <h2>{study ? "SPY + cash only" : "Configured portfolio"}</h2>
      <div className="cp-capital-readout">
        <span>{exposure ? "Maximum exposure" : "Volatility ceiling"}</span>
        <strong>{pct(exposure ? draft.maximum_exposure : draft.risk_budget)}</strong>
        <small>{draft.regime_response === "ADAPTIVE" ? "Adaptive ceiling · may be reduced by the regime" : "Fixed ceiling"}</small>
      </div>
      {!study && exposure && validExposure && (
        <div className="cp-capital-split">
          <div className="cp-capital-bar" aria-hidden="true"><span style={{ width: `${draft.maximum_exposure * 100}%` }} /></div>
          <p>Cash floor at this ceiling <strong>{pct(1 - draft.maximum_exposure)}</strong></p>
        </div>
      )}
      <p className="cp-note cp-policy-meaning">
        {study
          ? "The study applies the allowed exposure directly to SPY. A volatility budget is converted to a SPY weight."
          : exposure
            ? "A ceiling, not a fully invested budget. The optimizer can invest less and hold additional cash. Actual exposure is determined at each rebalance."
            : "A constraint on estimated portfolio volatility, not an invested-capital target or a guarantee of realized risk."}
      </p>
      <dl>
        <dt>Regime</dt><dd>{models[draft.regime_model]}</dd>
        <dt>Eligible assets</dt><dd>{study ? "SPY · Cash" : "etfs" in draft ? draft.etfs.join(" · ") || "None selected" : "—"}</dd>
        <dt>Allocation</dt><dd>{study ? "Direct exposure · no optimizer" : "Mean–variance + trading costs"}</dd>
        <dt>Rebalance / cost</dt><dd>{draft.rebalance_frequency === "MONTHLY" ? "Monthly" : "Quarterly"} · {Number.isFinite(draft.transaction_cost_bps) ? draft.transaction_cost_bps : "—"} bps</dd>
        <dt>Training</dt><dd>{Number.isFinite(draft.training_window_months) ? draft.training_window_months : "—"} months · {draft.window_type === "ROLLING" ? "Rolling" : "Expanding"}</dd>
        <dt>Evaluation</dt><dd>{draft.evaluation_start || "Set start date"} → {draft.evaluation_end_exclusive || "Set end date"}<small className="cp-summary-end">End date exclusive</small></dd>
      </dl>
      <details className="cp-summary-assumptions">
        <summary>Research assumptions</summary>
        <p className="cp-note">Cash yield: 0%. Information stops before each decision; fills occur at the next observed close. {study ? "Separate from portfolio research." : "Forecasts use historical means; alternative asset-alpha models are not enabled."}</p>
      </details>
      {!study && <div className="cp-actions cp-summary-links">
        <button onClick={() => navigate("Capital Exposure")}>Capital policy</button>
        <button onClick={() => navigate("Portfolio Construction")}>Construction</button>
      </div>}
    </aside>
  );
}
