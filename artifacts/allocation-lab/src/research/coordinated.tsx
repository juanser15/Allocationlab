import { useEffect, useState } from "react";
import Baseline from "./workbench";
import {
  COORDINATED_SPEC,
  type CoordinatedRequest,
  type CapitalStudyRequest,
  DEFAULT_FORECAST,
  forecastNames,
} from "../../../api-server/src/lib/workbench/coordinated-contract";
import { ForecastDesign, ForecastEvidence } from "./coordinated-forecasts";
import {
  ExecutionWorkspace,
  type CalendarField,
} from "./coordinated-execution";
import { Card, models, names, pct, researchApi } from "./coordinated-ui";
import { DataUniverse } from "./data-universe";

import "./coordinated.css";

const initial: CoordinatedRequest = {
  dataset_id: "",
  forecast: DEFAULT_FORECAST,
  contract_version: COORDINATED_SPEC,
  research_scope: "PORTFOLIO",
  evaluation_start: "",
  evaluation_end_exclusive: "",
  training_window_months: 24,
  window_type: "ROLLING",
  rebalance_frequency: "MONTHLY",
  transaction_cost_bps: 10,
  control_mode: "MAX_EXPOSURE",
  maximum_exposure: 0.6,
  risk_budget: 0.1,
  regime_model: "CURRENT",
  regime_response: "FIXED",
  defensive_multiplier: 0.5,
  etfs: ["SPY", "EFA", "IEF", "GLD"],
  maximum_etf_weight: 0.4,
  risk_aversion: 5,
  covariance_shrinkage: 0.2,
};
export const researchModules = [
  "Data & Universe",
  "Signals",
  "Capital Exposure",
  "Portfolio Construction",
  "Backtesting",
  "Robustness & Stress",
  "Compare & Promote",
];
const descriptions: Record<string, string> = {
  "Data & Universe":
    "Inspect the shared dataset and available investment universe.",
  Signals:
    "Define shared regime inputs and inspect observed signal diagnostics.",
  "Capital Exposure":
    "Configure the capital policy. Independent SPY/cash research is optional.",
  "Portfolio Construction":
    "Select eligible ETFs and configure their allocation objective.",
  Backtesting: "Execute and inspect the complete portfolio strategy.",
  "Robustness & Stress": "Stress research for the portfolio strategy.",
  "Compare & Promote": "Review research evidence before promotion.",
};
export function capitalStudyDesign(
  request: CoordinatedRequest,
): CapitalStudyRequest {
  const {
    etfs,
    maximum_etf_weight,
    risk_aversion,
    covariance_shrinkage,
    forecast,
    research_scope,
    ...shared
  } = request;
  return { ...shared, research_scope: "CAPITAL_EXPOSURE" };
}
export function CoordinatedWorkbench({
  initialModule = "Capital Exposure",
}: {
  initialModule?: string;
}) {
  const [module, setModule] = useState(initialModule),
    [baseline, setBaseline] = useState(false),
    [capitalView, setCapitalView] = useState("Policy"),
    [portfolioView, setPortfolioView] = useState("ETF Selection"),
    [signalView, setSignalView] = useState("Signal Design");
  const [draft, setDraft] = useState(initial),
    [studyDraft, setStudyDraft] = useState<CapitalStudyRequest>(() =>
      capitalStudyDesign(initial),
    ),
    [caps, setCaps] = useState<any>(null),
    [accessError, setAccessError] = useState(""),
    [token, setToken] = useState(""),
    [lastPortfolio, setLastPortfolio] = useState<any>(null);
  const load = () =>
    researchApi("/capabilities")
      .then((next) => {
        setAccessError("");
        setCaps(next);
        setDraft((previous) => ({ ...previous, dataset_id: next.dataset_id }));
        setStudyDraft((previous) => ({
          ...previous,
          dataset_id: next.dataset_id,
        }));
      })
      .catch((e) => { setCaps(null); setAccessError(e.message); });
  useEffect(() => { void load(); const refresh=()=>void load(); window.addEventListener("focus",refresh); return()=>window.removeEventListener("focus",refresh); }, []);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [module, capitalView, portfolioView, signalView, baseline]);
  const change = <K extends keyof CoordinatedRequest>(
    key: K,
    value: CoordinatedRequest[K],
  ) => setDraft((d) => ({ ...d, [key]: value }));
  const navigate = (name: string) => { setModule(name); void load(); };
  function openStudy() {
    const policy = capitalStudyDesign(draft);
    setStudyDraft((previous) => ({
      ...previous,
      control_mode: policy.control_mode,
      maximum_exposure: policy.maximum_exposure,
      risk_budget: policy.risk_budget,
      dataset_id: policy.dataset_id,
      regime_model: policy.regime_model,
      regime_response: policy.regime_response,
      defensive_multiplier: policy.defensive_multiplier,
    }));
    setCapitalView("Independent study");
  }
  const number = (
    key: keyof CoordinatedRequest,
    label: string,
    percent = false,
    min = 0,
    max = 100,
    step = 1,
  ) => (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={
          Number.isNaN(Number(draft[key]))
            ? ""
            : Number(draft[key]) * (percent ? 100 : 1)
        }
        onInput={(e) =>
          change(
            key,
            (e.currentTarget.value === ""
              ? NaN
              : Number(e.currentTarget.value) / (percent ? 100 : 1)) as never,
          )
        }
      />
    </label>
  );
  const select = (
    key: keyof CoordinatedRequest,
    label: string,
    options: Record<string, string>,
  ) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={String(draft[key])}
        onChange={(e) => change(key, e.target.value as never)}
      >
        {Object.entries(options).map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  const policyLabel =
    draft.control_mode === "MAX_EXPOSURE"
      ? `${pct(draft.maximum_exposure)} maximum ETF exposure`
      : `${pct(draft.risk_budget)} annualized volatility budget`;
  if (baseline)
    return (
      <>
        <div className="cp-reference-bar">
          <button onClick={() => setBaseline(false)}>
            ← Coordinated workspace
          </button>
          <span>Original SPY/cash model · unchanged methodology</span>
        </div>
        <Baseline />
      </>
    );
  return (
    <div className="cp-workspace">
      <header className="cp-header">
        <span className="cp-logo">AL</span>
        <strong>Allocation Lab</strong>
        <span className="cp-badge">Research workspace</span>
      </header>
      {caps && <div className="cp-reference-bar"><button onClick={()=>navigate("Data & Universe")} aria-label="Active workspace dataset">DATA · {caps.dataset_source === "YAHOO_FINANCE" ? "Yahoo" : "Internal Snapshot"} · Daily · through {caps.data_last_observation}</button></div>}
      <div className="cp-shell">
        <nav className="cp-nav" aria-label="Research modules">
          <small>RESEARCH SECTIONS</small>
          {researchModules.map((name, i) => (
            <button
              key={name}
              aria-current={module === name ? "page" : undefined}
              onClick={() => navigate(name)}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              {name}
            </button>
          ))}
          <div className="cp-nav-note">
            Configure each layer.
            <br />
            Run the portfolio in Backtesting.
            <br />
            <br />
            Research only · temporary run storage
          </div>
        </nav>
        <main className={`cp-main ${module === "Data & Universe" ? "du-main" : ""}`}>
          <div className="cp-eyebrow">
            {module === "Data & Universe" ? "DATA MANAGEMENT" : module === "Backtesting"
              ? "FULL PORTFOLIO RESEARCH"
              : "STRATEGY CONFIGURATION"}
          </div>
          <h1>{module}</h1>
          <p className="cp-description">{descriptions[module]}</p>
          {accessError && (
            <div className="cp-error" role="alert">
              {accessError}
              <div className="cp-access">
                <label>
                  Preview access token
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </label>
                <button
                  onClick={() => {
                    sessionStorage.setItem(
                      "allocationlab.workbench.preview-token",
                      token,
                    );
                    setAccessError("");
                    void load();
                  }}
                >
                  Connect
                </button>
              </div>
            </div>
          )}
          <div hidden={module !== "Data & Universe"}>
            <DataUniverse onDatasetChange={load} capabilities={caps} />
          </div>
          {module === "Signals" && (
            <div className="cp-section-body">
              <nav className="cp-subtabs" aria-label="Signal sections">
                {["Signal Design", "Signal Health"].map((view) => (
                  <button
                    key={view}
                    aria-pressed={signalView === view}
                    onClick={() => setSignalView(view)}
                  >
                    {view}
                  </button>
                ))}
              </nav>
              {signalView === "Signal Design" ? (
                <>
                  <Card title="Regime classifier">
                    <div className="cp-fields">
                      {select("regime_model", "Regime classifier", models)}
                    </div>
                    <p className="cp-note">
                      {draft.regime_model === "HMM"
                        ? "Gaussian HMM on daily SPY log returns. Two volatility states, fitted only inside the user-selected training window. State labels and filtered probabilities use information available before each decision."
                        : draft.regime_model === "CURRENT"
                          ? "Existing composite regime score. The original exposure policy remains available in Baseline reference."
                          : draft.regime_model === "TREND"
                            ? "SPY relative to its 200-price moving average."
                            : "SPY relative to its 200-price average, combined with 21-return volatility relative to 252-return volatility."}
                    </p>
                    <p className="cp-note">
                      Capital Exposure determines how this regime affects the
                      capital limit.
                    </p>
                    <button onClick={() => navigate("Capital Exposure")}>
                      Configure capital response →
                    </button>
                  </Card>
                  <ForecastDesign
                    value={draft.forecast}
                    onChange={(value) => change("forecast", value)}
                  />
                </>
              ) : (
                <>
                  <ForecastEvidence
                    result={lastPortfolio?.result}
                    spec={lastPortfolio?.spec}
                  />
                  <Card title="Observed signal diagnostics">
                    {lastPortfolio ? (
                      <>
                        <p>
                          Latest selected full-portfolio result · information
                          cutoff{" "}
                          {
                            lastPortfolio.result.decisions.at(-1)
                              .information_cutoff
                          }{" "}
                          ·{" "}
                          {
                            models[
                              lastPortfolio.spec
                                .regime_model as keyof typeof models
                            ]
                          }
                          .
                        </p>
                        {lastPortfolio.spec.regime_model === "HMM" && (
                          <div className="cp-metrics">
                            <div>
                              <small>Higher-volatility probability</small>
                              <strong>
                                {pct(
                                  lastPortfolio.result.decisions.at(-1).regime
                                    .high_risk_probability,
                                )}
                              </strong>
                            </div>
                            <div>
                              <small>Converged initializations</small>
                              <strong>
                                {
                                  lastPortfolio.result.decisions.at(-1).regime
                                    .converged_initializations
                                }{" "}
                                / 3
                              </strong>
                            </div>
                          </div>
                        )}
                        <details>
                          <summary>
                            Model evidence from that saved result
                          </summary>
                          <pre>
                            {JSON.stringify(
                              lastPortfolio.result.decisions.at(-1).regime,
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      </>
                    ) : (
                      <p className="cp-empty">
                        No full-portfolio result selected yet. Open or execute a
                        portfolio backtest in Backtesting to inspect its
                        recorded diagnostics.
                      </p>
                    )}
                    <button onClick={() => navigate("Backtesting")}>
                      Open Backtesting →
                    </button>
                  </Card>
                </>
              )}
            </div>
          )}
          {module === "Capital Exposure" && (
            <nav
              className="cp-subtabs cp-section-body"
              aria-label="Capital Exposure sections"
            >
              <button
                aria-pressed={capitalView === "Policy"}
                onClick={() => setCapitalView("Policy")}
              >
                Capital policy
              </button>
              <button
                aria-pressed={capitalView === "Independent study"}
                onClick={openStudy}
              >
                Independent study · SPY/cash
              </button>
            </nav>
          )}
          {module === "Capital Exposure" && capitalView === "Policy" && (
            <div className="cp-section-body">
              <Card title="Choose a capital control">
                <div className="cp-options">
                  <button
                    className="cp-option"
                    aria-pressed={draft.control_mode === "MAX_EXPOSURE"}
                    onClick={() => change("control_mode", "MAX_EXPOSURE")}
                  >
                    <strong>Maximum exposure</strong>
                    <small>Ceiling on total ETF capital.</small>
                  </button>
                  <button
                    className="cp-option"
                    aria-pressed={draft.control_mode === "RISK_BUDGET"}
                    onClick={() => change("control_mode", "RISK_BUDGET")}
                  >
                    <strong>Risk budget</strong>
                    <small>Ceiling on estimated portfolio volatility.</small>
                  </button>
                </div>
                <div className="cp-fields">
                  {draft.control_mode === "MAX_EXPOSURE"
                    ? number(
                        "maximum_exposure",
                        "Maximum ETF exposure (%)",
                        true,
                      )
                    : number(
                        "risk_budget",
                        "Annualized volatility ceiling (%)",
                        true,
                        0.1,
                        100,
                        0.1,
                      )}
                  <label>
                    Portfolio scope
                    <input readOnly value="All eligible ETFs · long only" />
                  </label>
                </div>
                <p className="cp-note">
                  {draft.control_mode === "MAX_EXPOSURE"
                    ? "Portfolio Construction may invest below this ceiling and hold more cash."
                    : "Estimated from the full ETF covariance matrix. This is not a guaranteed realized-volatility or loss limit."}
                </p>
              </Card>
              <Card title="Response to the regime">
                <div className="cp-fields">
                  {select(
                    "regime_response",
                    "How the regime affects the limit",
                    { FIXED: "Fixed ceiling", ADAPTIVE: "Adaptive ceiling" },
                  )}
                  <label>
                    Shared regime classifier
                    <input readOnly value={models[draft.regime_model]} />
                  </label>
                  {draft.regime_response === "ADAPTIVE" &&
                    number(
                      "defensive_multiplier",
                      "Limit retained in fully defensive conditions (%)",
                      true,
                      draft.control_mode === "RISK_BUDGET" ? 0.1 : 0,
                      100,
                      0.1,
                    )}
                </div>
                <p className="cp-note">
                  {draft.regime_response === "ADAPTIVE"
                    ? "HMM uses the higher-volatility state probability; the other classifiers use their defensive score. The response reduces the ceiling, without choosing individual ETF weights."
                    : "The capital ceiling stays fixed. Classification is recorded for diagnostics."}
                </p>
                <button onClick={() => navigate("Signals")}>
                  Edit regime classifier in Signals →
                </button>
              </Card>
              <Card title="Optional independent research">
                <p>
                  Study the active capital policy on SPY/cash against passive
                  SPY, separately from the ETF portfolio.
                </p>
                <p className="cp-note">
                  The study applies the allowed capital directly to SPY; a
                  volatility budget is converted to a SPY weight. Portfolio ETF
                  selection and optimization are excluded. Dates, results and
                  history belong to this independent study.
                </p>
                <button onClick={openStudy}>
                  Study SPY/cash independently →
                </button>
              </Card>
              <Card title="Portfolio connection">
                <p>
                  The configured policy is passed to Portfolio Construction.
                  Execute the complete portfolio strategy in Backtesting.
                </p>
                <button onClick={() => navigate("Portfolio Construction")}>
                  Continue to Portfolio Construction →
                </button>
              </Card>
            </div>
          )}
          {module === "Capital Exposure" &&
            capitalView === "Independent study" && (
              <div className="cp-study-tools">
                <button onClick={openStudy}>Use current capital policy</button>
                <button onClick={() => setCapitalView("Policy")}>
                  Return to capital policy
                </button>
                <p className="cp-note">
                  This study uses a copy of the capital policy. Its execution
                  settings and saved runs are separate from Backtesting.
                </p>
              </div>
            )}
          {module === "Portfolio Construction" && (
            <div className="cp-section-body">
              <nav
                className="cp-subtabs"
                aria-label="Portfolio Construction sections"
              >
                {["ETF Selection", "Optimization"].map((view) => (
                  <button
                    key={view}
                    aria-pressed={portfolioView === view}
                    onClick={() => setPortfolioView(view)}
                  >
                    {view}
                  </button>
                ))}
              </nav>
              {portfolioView === "ETF Selection" ? (
                <Card title="Eligible investment universe">
                  {caps && draft.etfs.some((t) => !caps.etfs.includes(t)) && (
                    <p className="cp-error">
                      Selected symbols missing from this dataset:{" "}
                      {draft.etfs
                        .filter((t) => !caps.etfs.includes(t))
                        .join(" · ")}
                      . Deselect them explicitly or choose a dataset that
                      contains them.
                    </p>
                  )}
                  <p className="cp-note">
                    Eligibility is configured here. Final portfolio weights are
                    determined jointly by the optimizer.
                  </p>
                  <div className="cp-etfs">
                    {[
                      ...new Set([
                        ...(caps?.etfs ?? Object.keys(names)),
                        ...draft.etfs,
                      ]),
                    ].map((ticker: string) => (
                      <label key={ticker} className="cp-etf">
                        <input
                          type="checkbox"
                          checked={draft.etfs.includes(ticker)}
                          onChange={(e) =>
                            change(
                              "etfs",
                              e.target.checked
                                ? [...draft.etfs, ticker]
                                : draft.etfs.filter((t) => t !== ticker),
                            )
                          }
                        />
                        <strong>{ticker}</strong>
                        <span>{names[ticker]}</span>
                      </label>
                    ))}
                  </div>
                  <p className="cp-note">
                    Missing prices block a design; assets are not interpolated
                    or replaced automatically.
                  </p>
                  <button onClick={() => setPortfolioView("Optimization")}>
                    Continue to Optimization →
                  </button>
                </Card>
              ) : (
                <>
                  <Card title="Allocation objective">
                    <h3>Mean–variance with trading costs</h3>
                    <div className="cp-fields">
                      {number(
                        "risk_aversion",
                        "Risk aversion",
                        false,
                        0.1,
                        100,
                        0.1,
                      )}
                      {number(
                        "maximum_etf_weight",
                        "Maximum weight per ETF (%)",
                        true,
                        0.1,
                        100,
                        0.1,
                      )}
                    </div>
                    <p className="cp-note">
                      Uses the selected asset forecast, shared covariance and
                      carried holdings. Cash earns 0%.
                    </p>
                  </Card>
                  <Card title="Forecast input">
                    <p>
                      {
                        forecastNames[
                          draft.forecast?.model ?? "HISTORICAL_MEAN"
                        ]
                      }
                    </p>
                    <p className="cp-note">
                      {draft.forecast?.model === "HISTORICAL_MEAN" ||
                      !draft.forecast
                        ? "Historical arithmetic mean reference."
                        : `Expected arithmetic returns over ${draft.forecast.horizon_sessions} sessions. Forecast and covariance horizons are aligned; annualized volatility limits retain their own units.`}
                    </p>
                    <button onClick={() => navigate("Signals")}>
                      Edit asset forecasts in Signals →
                    </button>
                  </Card>
                  <Card title="Shared risk estimate">
                    <div className="cp-fields">
                      {number(
                        "covariance_shrinkage",
                        "Shrinkage toward diagonal covariance (%)",
                        true,
                        1,
                        100,
                      )}
                    </div>
                    <p className="cp-note">
                      Fixed diagonal shrinkage of daily sample covariance,
                      annualized at 252 sessions.
                    </p>
                  </Card>
                  <Card title="Inherited capital policy">
                    <p>
                      {policyLabel} ·{" "}
                      {draft.regime_response === "ADAPTIVE"
                        ? "Adaptive"
                        : "Fixed"}
                      .
                    </p>
                    <button onClick={() => navigate("Capital Exposure")}>
                      Edit in Capital Exposure →
                    </button>
                  </Card>
                  <Card title="Execute the complete strategy">
                    <p>
                      These construction settings are used by the portfolio
                      backtest. Dates, execution, progress, results and history
                      belong to Backtesting.
                    </p>
                    <button
                      className="cp-primary"
                      onClick={() => navigate("Backtesting")}
                    >
                      Continue to Backtesting →
                    </button>
                  </Card>
                </>
              )}
            </div>
          )}
          <ExecutionWorkspace
            scope="PORTFOLIO"
            visible={module === "Backtesting"}
            draft={draft}
            onChange={(key: CalendarField, value: any) => change(key, value)}
            caps={caps}
            navigate={navigate}
            onCompleted={(result, spec) => setLastPortfolio({ result, spec })}
          />
          <ExecutionWorkspace
            scope="CAPITAL_EXPOSURE"
            visible={
              module === "Capital Exposure" &&
              capitalView === "Independent study"
            }
            draft={studyDraft}
            onChange={(key: CalendarField, value: any) =>
              setStudyDraft((d) => ({ ...d, [key]: value }))
            }
            caps={caps}
            navigate={navigate}
          />
          {["Robustness & Stress", "Compare & Promote"].includes(module) && (
            <div className="cp-section-body">
              <Card
                title={
                  module === "Robustness & Stress"
                    ? "Stress research"
                    : "Research review"
                }
              >
                <p className="cp-empty">
                  {module === "Robustness & Stress"
                    ? "Stress campaigns are not enabled for the coordinated engine."
                    : "Formal promotion and cross-methodology comparison are not enabled for the coordinated engine."}
                </p>
                <p className="cp-note">
                  Full portfolio runs and their evidence are available in
                  Backtesting. Independent SPY/cash studies remain in Capital
                  Exposure.
                </p>
                <button onClick={() => navigate("Backtesting")}>
                  Open Backtesting →
                </button>
              </Card>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
export default function WorkbenchPage() {
  return <CoordinatedWorkbench />;
}
