import { useEffect, useRef, useState } from "react";
import { AssetMultiselect, availableOptions, reconcileSelection } from "./asset-multiselect";
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
import {
  AlphaHandoffCard,
  CashPolicyCard,
  MandateFields,
  PresetField,
  QC_OFF,
  QualityControlCard,
  ZERO_CASH_POLICY,
  STORAGE_NOTE,
  type P0Extras,
} from "./coordinated-p0";

import "./coordinated.css";
import { NoEffectWarning, PolicyEditor, PolicySummary, policySentence, sameCapitalPolicy, type PolicyFields } from "./capital-policy";
import { useBacktestRange } from "./use-backtest-range";

type Draft = CoordinatedRequest & P0Extras;
const initial: Draft = {
  cash_policy: ZERO_CASH_POLICY,
  slippage_bps: 0,
  quality_control: QC_OFF,
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
  capital_signal_frequency: "REBALANCE_ONLY",
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
  request: Draft,
): CapitalStudyRequest & P0Extras {
  const {
    etfs,
    maximum_etf_weight,
    risk_aversion,
    covariance_shrinkage,
    forecast,
    research_scope,
    mandate,
    quality_control,
    ...shared
  } = request;
  return {
    ...shared,
    cash_policy: ZERO_CASH_POLICY,
    slippage_bps: request.slippage_bps,
    research_scope: "CAPITAL_EXPOSURE",
  };
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
  const [token, setToken] = useState("");
  const previewOpen = import.meta.env?.VITE_WORKBENCH_PREVIEW_OPEN === "1";
  const [draftState, setDraftState] = useState<{ value: Draft; notice: { count: number; dataset: string } | null }>({ value: initial, notice: null }),
    [studyDraft, setStudyDraft] = useState<CapitalStudyRequest & P0Extras>(() =>
      capitalStudyDesign(initial),
    ),
    [caps, setCaps] = useState<any>(null),
    [accessError, setAccessError] = useState(""),
    [lastPortfolio, setLastPortfolio] = useState<any>(null);
  const draft = draftState.value;
  const removedNotice = draftState.notice;
  const setDraft = (update: Draft | ((previous: Draft) => Draft)) =>
    setDraftState(previous => ({ ...previous, value: typeof update === "function" ? update(previous.value) : update }));
  const setRemovedNotice = (notice: typeof removedNotice) =>
    setDraftState(previous => ({ ...previous, notice }));
  const portfolioCalendar = useBacktestRange(draft, caps, dates =>
    setDraft(previous => ({ ...previous, ...dates })));
  const studyCalendar = useBacktestRange(studyDraft, caps, dates =>
    setStudyDraft(previous => ({ ...previous, ...dates })));
  const loadGen = useRef(0);
  const load = () => {
    const gen = ++loadGen.current;
    return researchApi("/capabilities")
      .then((next) => {
        if (gen !== loadGen.current) return;
        setAccessError("");
        setCaps(next);
        const available = availableOptions(next?.etfs);
        setDraftState((previous) => {
          const { kept, removed } = reconcileSelection(previous.value.etfs, available);
          return {
            value: { ...previous.value, dataset_id: next.dataset_id, etfs: removed.length ? kept : previous.value.etfs },
            notice: removed.length ? { count: removed.length, dataset: String(next.dataset_id) } : previous.notice,
          };
        });
        setStudyDraft((previous) => ({
          ...previous,
          dataset_id: next.dataset_id,
        }));
      })
      .catch((e) => { if (gen !== loadGen.current) return; setCaps(null); setAccessError(e.message); });
  };
  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => { loadGen.current++; window.removeEventListener("focus", refresh); window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [module, capitalView, portfolioView, signalView, baseline]);
  const change = <K extends keyof Draft>(
    key: K,
    value: Draft[K],
  ) => {
    if (key === "evaluation_start" || key === "evaluation_end_exclusive") portfolioCalendar.edit(key);
    setDraft((d) => ({ ...d, [key]: value }));
  };
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
      cash_policy: policy.cash_policy,
      slippage_bps: policy.slippage_bps,
      capital_signal_frequency: policy.capital_signal_frequency ?? "REBALANCE_ONLY",
    }));
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
            Back to coordinated workspace
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
            {STORAGE_NOTE}
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
                {!previewOpen && (
                  <label>
                    Preview access token
                    <input
                      type="password"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                    />
                  </label>
                )}
                <button
                  onClick={() => {
                    if (!previewOpen && token)
                      sessionStorage.setItem("allocationlab.workbench.preview-token", token);
                    setAccessError("");
                    void load();
                  }}
                >
                  {previewOpen ? "Retry connection" : "Connect"}
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
                  <AlphaHandoffCard context="Signals" />
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
                onClick={() => setCapitalView("Independent study")}
              >
                Independent study · SPY/cash
              </button>
            </nav>
          )}
          {module === "Capital Exposure" && capitalView === "Policy" && (
            <div className="cp-section-body">
              <Card title="Capital rule">
                <PolicyEditor
                  idPrefix="policy"
                  value={draft as PolicyFields}
                  onChange={(k, v) => change(k, v as never)}
                  classifierNote="Shared with Signals: changing the classifier here changes it there."
                />
              </Card>
              <details className="cp-advanced" data-testid="details-policy-advanced">
                <summary>Advanced · Cash return assumption: 0% · slippage {draft.slippage_bps} bps</summary>
                <CashPolicyCard slippage={draft.slippage_bps} onSlippage={(v) => change("slippage_bps", v)} />
              </details>
              <div className="cp-actions cpx-actions">
                <button className="cp-primary" data-testid="button-test-rule-spy" onClick={() => { openStudy(); setCapitalView("Independent study"); }}>
                  Test this rule with SPY →
                </button>
                <button data-testid="button-continue-construction" onClick={() => navigate("Portfolio Construction")}>
                  Continue to Portfolio Construction →
                </button>
              </div>
            </div>
          )}
          {module === "Capital Exposure" &&
            capitalView === "Independent study" && (
              <div className="cp-study-tools">
                <PolicySummary policy={studyDraft} label="Study copy of the capital rule" testId="text-study-policy">
                  {!sameCapitalPolicy(studyDraft, capitalStudyDesign(draft)) && (
                    <small data-testid="text-study-policy-differs">Differs from current capital policy: {policySentence(capitalStudyDesign(draft))}</small>
                  )}
                </PolicySummary>
                <button onClick={openStudy} data-testid="button-copy-policy">Use current capital policy</button>
                <button onClick={() => setCapitalView("Policy")}>Return to capital policy</button>
                <details className="cp-advanced" data-testid="details-study-policy-edit">
                  <summary>Edit study copy only</summary>
                  <PolicyEditor
                    idPrefix="study"
                    value={studyDraft as PolicyFields}
                    onChange={(k, v) => setStudyDraft((d) => ({ ...d, [k]: v }))}
                    classifierNote="Changes here affect this study only."
                  />
                </details>
              </div>
            )}
          {module === "Portfolio Construction" && (
            <div className="cp-section-body">
              <nav
                className="cp-subtabs"
                aria-label="Portfolio Construction sections"
              >
                {["ETF Selection", "Optimization", "Alpha handoff"].map((view) => (
                  <button
                    key={view}
                    aria-pressed={portfolioView === view}
                    onClick={() => setPortfolioView(view)}
                  >
                    {view}
                  </button>
                ))}
              </nav>
              {portfolioView === "Alpha handoff" ? (
                <AlphaHandoffCard context="Portfolio Construction" />
              ) : portfolioView === "ETF Selection" ? (
                <Card title="Eligible investment universe">
                  <p className="am-meta" data-testid="text-asset-source">
                    {caps ? (
                      <>Source <strong>{caps.dataset_source === "YAHOO_FINANCE" ? "Yahoo Finance" : "Internal snapshot"}</strong> · dataset <strong>{caps.dataset_id}</strong>{caps.dataset_version != null && <> · v{caps.dataset_version}</>} · <strong>{availableOptions(caps.etfs).length}</strong> assets with prices · through {caps.data_last_observation}</>
                    ) : accessError ? "Asset universe unavailable — the capabilities request failed. Retry above." : "Loading active dataset…"}
                  </p>
                  {removedNotice && (
                    <p className="cp-note am-warn" role="status">
                      {removedNotice.count} selected asset{removedNotice.count === 1 ? " was" : "s were"} removed because the active dataset ({removedNotice.dataset}) has no prices for {removedNotice.count === 1 ? "it" : "them"}. Saved runs keep their frozen data and remain read-only.{" "}
                      <button type="button" onClick={() => setRemovedNotice(null)}>Dismiss</button>
                    </p>
                  )}
                  <p className="cp-note">
                    These are candidates, not holdings. Every asset in the active
                    dataset may be selected; final holdings and weights are set by
                    the optimizer under the per-asset maximum, the exposure rule
                    and any final-holdings mandate in Optimization.
                  </p>
                  <AssetMultiselect
                    options={availableOptions(caps?.etfs)}
                    value={draft.etfs}
                    onChange={(next) => { change("etfs", next); }}
                    labels={names}
                    loading={!caps && !accessError}
                    error={!caps && accessError ? accessError : ""}
                    unavailableCount={caps ? reconcileSelection(draft.etfs, availableOptions(caps.etfs)).removed.length : 0}
                  />
                  <p className="cp-note">
                    Missing prices block a design; assets are not interpolated
                    or replaced automatically.
                  </p>
                  <button
                    disabled={!caps || reconcileSelection(draft.etfs, availableOptions(caps.etfs)).kept.length === 0}
                    onClick={() => setPortfolioView("Optimization")}
                  >
                    Continue to Optimization →
                  </button>
                </Card>
              ) : (
                <>
                  <p className="cp-note" data-testid="text-optimization-universe">
                    {caps
                      ? `${reconcileSelection(draft.etfs, availableOptions(caps.etfs)).kept.length} eligible assets selected for optimization.`
                      : "Asset availability could not be verified."}{" "}
                    <button type="button" onClick={() => setPortfolioView("ETF Selection")}>
                      Edit selection
                    </button>
                  </p>
                  <Card title="Allocation objective">
                    <h3>Mean–variance with trading costs</h3>
                    <div className="cp-fields">
                      {number(
                        "maximum_etf_weight",
                        "Maximum weight per asset (% of total NAV)",
                        true,
                        0.1,
                        100,
                        0.1,
                      )}
                    </div>
                    <p className="cp-note">
                      Uses the selected asset forecast, shared covariance and
                      carried holdings. Uninvested capital earns 0% under the
                      forced cash policy shown in Capital Exposure.
                    </p>
                    <PresetField
                      label="Risk aversion"
                      value={draft.risk_aversion}
                      onChange={(v) => change("risk_aversion", v)}
                      presets={{ Low: 2, Moderate: 5, High: 10 }}
                      min={0.1}
                      max={100}
                      step={0.1}
                    />
                    <MandateFields
                      value={draft.mandate}
                      maxWeight={draft.maximum_etf_weight}
                      selected={draft.etfs.length}
                      onChange={(v) => change("mandate", v)}
                    />
                  </Card>
                  <QualityControlCard
                    value={draft.quality_control}
                    onChange={(v) => change("quality_control", v)}
                  />
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
                    <PresetField
                      label="Shrinkage toward diagonal covariance (%)"
                      value={draft.covariance_shrinkage}
                      percent
                      onChange={(v) => change("covariance_shrinkage", v)}
                      presets={{ Light: 0.1, Standard: 0.2, Heavy: 0.5 }}
                      min={1}
                      max={100}
                      step={1}
                    />
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
                    <NoEffectWarning policy={draft as PolicyFields} testId="warning-inherited-no-effect" />
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
            calendarRange={portfolioCalendar}
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
              {
                if (key === "evaluation_start" || key === "evaluation_end_exclusive") studyCalendar.edit(key);
                setStudyDraft((d) => ({ ...d, [key]: value }));
              }
            }
            calendarRange={studyCalendar}
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
