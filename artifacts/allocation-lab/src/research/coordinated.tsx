import { useEffect, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Baseline from "./workbench";
import type { CoordinatedRequest } from "../../../api-server/src/lib/workbench/coordinated-contract";
import "./coordinated.css";

const models = {
  CURRENT: "Current regime score",
  TREND: "Trend · 200-day average",
  TREND_VOL: "Trend + volatility",
  HMM: "HMM · two volatility states",
};
const names: Record<string, string> = {
  SPY: "US equities",
  EFA: "Developed markets",
  EEM: "Emerging markets",
  IEF: "7–10 year Treasuries",
  TLT: "20+ year Treasuries",
  GLD: "Gold",
  DBC: "Commodities",
  VNQ: "US real estate",
};
const initial: CoordinatedRequest = {
  contract_version: "allocationlab-coordinated-1.0.0",
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
const pct = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v)
    ? `${(v * 100).toFixed(1)}%`
    : "—";
const modules = [
  "Data & Universe",
  "Signals",
  "Capital Exposure",
  "Portfolio Construction",
  "Robustness & Stress",
  "Compare & Promote",
];
async function api(path: string, body?: unknown) {
  const token = sessionStorage.getItem("allocationlab.workbench.preview-token");
  const response = await fetch("/api/workbench/coordinated" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      value.error?.message ??
        value.message ??
        "The request could not be completed.",
    );
  return value;
}
function Card({
  title,
  step,
  children,
}: {
  title: string;
  step?: string;
  children: ReactNode;
}) {
  return (
    <section className="cp-card">
      <h2>
        {step && <span className="cp-step">{step}</span>}
        {title}
      </h2>
      {children}
    </section>
  );
}
function Chart({
  points,
  field,
}: {
  points: any[];
  field: "index" | "drawdown" | "exposure";
}) {
  return (
    <div
      className="cp-chart"
      role="img"
      aria-label={
        field === "index"
          ? "Portfolio value, starting at 100"
          : field === "drawdown"
            ? "Portfolio drawdown"
            : "Total ETF exposure"
      }
    >
      <ResponsiveContainer width="100%" height={250}>
        {field === "index" ? (
          <LineChart data={points}>
            <CartesianGrid vertical={false} stroke="#e5eaee" />
            <XAxis dataKey="date" minTickGap={65} />
            <YAxis domain={["auto", "auto"]} />
            <Tooltip formatter={(v: any) => Number(v).toFixed(2)} />
            <Line
              type="linear"
              dataKey={field}
              name="Portfolio index"
              dot={false}
              stroke="#265e72"
              strokeWidth={2}
            />
          </LineChart>
        ) : (
          <AreaChart data={points}>
            <CartesianGrid vertical={false} stroke="#e5eaee" />
            <XAxis dataKey="date" minTickGap={65} />
            <YAxis tickFormatter={pct} />
            <Tooltip formatter={(v: any) => pct(Number(v))} />
            <Area
              type="linear"
              dataKey={field}
              stroke="#265e72"
              fill="#dcebf0"
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
export default function CoordinatedWorkbench() {
  const [baseline, setBaseline] = useState(false),
    [module, setModule] = useState("Capital Exposure"),
    [tab, setTab] = useState("Setup"),
    [portfolioTab, setPortfolioTab] = useState("ETF Selection"),
    [signalTab, setSignalTab] = useState("Signal Design");
  const [draft, setDraft] = useState(initial),
    [caps, setCaps] = useState<any>(null),
    [plan, setPlan] = useState<any>(null),
    [run, setRun] = useState<any>(null),
    [runId, setRunId] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0),
    [runs, setRuns] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState("");
  const change = <K extends keyof CoordinatedRequest>(
    key: K,
    value: CoordinatedRequest[K],
  ) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setPlan(null);
  };
  const load = () =>
    api("/capabilities")
      .then(setCaps)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [module, tab, portfolioTab, signalTab, baseline]);
  useEffect(() => {
    if (!runId) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await api(`/runs/${runId}`);
        if (stopped) return;
        setRun(r);
        if (["RUNNING", "PENDING"].includes(r.latest_status))
          timer = setTimeout(poll, 1000);
        else {
          setBusy(false);
          if (r.latest_status === "SUCCESS") setTab("Results");
        }
      } catch (e) {
        if (!stopped) {
          setError((e as Error).message);
          setBusy(false);
        }
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [runId, refresh]);
  const result =
    run?.latest_status === "SUCCESS" ? run.latest_successful_result : null;
  const resultSpec = run?.spec;
  const latest = result?.decisions?.at(-1);
  const number = (
    key: keyof CoordinatedRequest,
    label: string,
    {
      percent = false,
      min = 0,
      max,
      step = 1,
    }: { percent?: boolean; min?: number; max?: number; step?: number } = {},
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
  async function validate() {
    setError("");
    try {
      const p = await api("/plan", draft);
      setPlan(p);
      return p;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const p = await validate();
      if (!p) {
        setBusy(false);
        return;
      }
      const r = await api("/runs", draft);
      setRun(null);
      setRunId(null);
      setTab("Progress");
      setRunId(r.run_id);
      setRefresh((n) => n + 1);
      if (!["RUNNING", "PENDING"].includes(r.status)) setBusy(false);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function history() {
    setTab("Runs");
    try {
      setRuns((await api("/runs")).runs);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const navigate = (name: string) => {
    setModule(name);
    setTab("Setup");
    setError("");
  };
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
  const modelFields = (
    <>
      <div className="cp-fields">
        {select("regime_model", "Regime classifier", models)}
        {select("regime_response", "How the regime affects the limit", {
          FIXED: "Fixed limit · classify for diagnostics",
          ADAPTIVE: "Adaptive · reduce limit in defensive conditions",
        })}
      </div>
      <p className="cp-note">
        {draft.regime_model === "HMM"
          ? "Gaussian HMM on daily SPY log returns. Two states ordered by training volatility; three deterministic initializations. Refit at each rebalance; probabilities use only data available before the decision."
          : draft.regime_model === "CURRENT"
            ? "The existing composite regime score is reused as a signal. The original candidate-selection and exposure policy remain available in Baseline reference."
            : draft.regime_model === "TREND"
              ? "SPY below its 200-day average is defensive; above is supportive."
              : "Defensive score combines SPY below its 200-day average and 21-day volatility above 252-day volatility, with equal weight."}
      </p>
      {draft.regime_response === "ADAPTIVE" && (
        <>
          <div className="cp-fields">
            {number(
              "defensive_multiplier",
              "Limit retained in fully defensive conditions (%)",
              {
                percent: true,
                max: 100,
                min: draft.control_mode === "RISK_BUDGET" ? 1 : 0,
              },
            )}
          </div>
          <p className="cp-note">
            The limit varies between {pct(draft.defensive_multiplier)} and 100%
            of your ceiling. HMM uses the probability of the higher-volatility
            state; the other classifiers use their defensive score.
          </p>
        </>
      )}
    </>
  );
  return (
    <div className="cp-workspace">
      <header className="cp-header">
        <span className="cp-logo">AL</span>
        <strong>Allocation Lab</strong>
        <span className="cp-badge">Research workspace</span>
        <button className="cp-reference" onClick={() => setBaseline(true)}>
          Baseline reference ↗
        </button>
      </header>
      <div className="cp-shell">
        <nav className="cp-nav" aria-label="Research modules">
          <small>STRATEGY WORKFLOW</small>
          {modules.map((m, i) => (
            <button
              key={m}
              aria-current={m === module ? "page" : undefined}
              onClick={() => navigate(m)}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              {m}
            </button>
          ))}
          <div className="cp-nav-note">
            One portfolio.
            <br />
            Connected decisions.
            <br />
            <br />
            Research only · temporary storage
          </div>
        </nav>
        <main className="cp-main">
          <div className="cp-eyebrow">COORDINATED STRATEGY</div>
          <h1>{module}</h1>
          <p className="cp-description">
            {module === "Capital Exposure"
              ? "Set how much capital or risk the portfolio may use."
              : module === "Portfolio Construction"
                ? "Choose eligible ETFs, then allocate within the shared capital limits."
                : module === "Signals"
                  ? "Shared regime information and asset forecasts for the same decision date."
                  : "Shared research context and evidence."}
          </p>
          <div className="cp-flow">
            <button onClick={() => navigate("Signals")}>Signals</button>
            <span>→</span>
            <button onClick={() => navigate("Capital Exposure")}>
              Capital limits
            </button>
            <span>→</span>
            <button onClick={() => navigate("Portfolio Construction")}>
              ETF weights + cash
            </button>
            <span>→</span>
            <button onClick={() => setTab("Results")}>One backtest</button>
          </div>
          <div className="cp-tabs" aria-label="Research views">
            {["Setup", "Progress", "Results", "Runs", "Audit"].map((t) => (
              <button
                key={t}
                aria-pressed={tab === t}
                onClick={() => (t === "Runs" ? void history() : setTab(t))}
              >
                {t}
              </button>
            ))}
          </div>
          {error && (
            <div className="cp-error" role="alert">
              {error}
              {!caps && (
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
                      setError("");
                      void load();
                    }}
                  >
                    Connect
                  </button>
                </div>
              )}
            </div>
          )}
          {run?.latest_status === "FAILED" && (
            <div className="cp-error" role="alert">
              {run.latest_result?.safe_message} No fallback or substituted
              result was used.
            </div>
          )}
          {tab === "Setup" && (
            <div className="cp-columns">
              <div>
                {module === "Capital Exposure" && (
                  <>
                    <Card title="Choose a control" step="01">
                      <div className="cp-options">
                        <button
                          className="cp-option"
                          aria-pressed={draft.control_mode === "MAX_EXPOSURE"}
                          onClick={() => change("control_mode", "MAX_EXPOSURE")}
                        >
                          <strong>Maximum exposure</strong>
                          <small>Cap total capital invested in ETFs.</small>
                        </button>
                        <button
                          className="cp-option"
                          aria-pressed={draft.control_mode === "RISK_BUDGET"}
                          onClick={() => change("control_mode", "RISK_BUDGET")}
                        >
                          <strong>Risk budget</strong>
                          <small>
                            Cap estimated annualized portfolio volatility.
                          </small>
                        </button>
                      </div>
                      <div className="cp-fields">
                        {draft.control_mode === "MAX_EXPOSURE"
                          ? number(
                              "maximum_exposure",
                              "Maximum ETF exposure (%)",
                              { percent: true, max: 100 },
                            )
                          : number(
                              "risk_budget",
                              "Annualized volatility ceiling (%)",
                              { percent: true, min: 0.1, max: 100, step: 0.1 },
                            )}
                        <label>
                          Applies to
                          <input
                            readOnly
                            value="All selected ETFs · long only"
                          />
                        </label>
                      </div>
                      <p className="cp-note">
                        {draft.control_mode === "MAX_EXPOSURE"
                          ? "A ceiling, not a target. Construction can invest less and hold more cash."
                          : "Estimated from the complete ETF covariance matrix. This is not a loss limit or a guarantee of realized volatility. No leverage."}
                      </p>
                    </Card>
                    <Card title="Connect the market regime" step="02">
                      {modelFields}
                    </Card>
                  </>
                )}
                {module === "Signals" && (
                  <>
                    <div className="cp-subtabs">
                      {["Signal Design", "Signal Health"].map((t) => (
                        <button
                          aria-pressed={signalTab === t}
                          onClick={() => setSignalTab(t)}
                          key={t}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    {signalTab === "Signal Design" ? (
                      <>
                        <Card title="Shared regime classifier">
                          {modelFields}
                        </Card>
                        <Card title="Asset forecasts">
                          <p>
                            Historical arithmetic returns, annualized at 252
                            sessions, estimated inside each training window. The
                            optimizer uses the same cutoff, universe and
                            covariance model as Capital Exposure.
                          </p>
                          <p className="cp-note">
                            Forecasts are estimates, not performance
                            predictions. Alternative asset-signal models are not
                            enabled in this version.
                          </p>
                        </Card>
                      </>
                    ) : (
                      <Card title="Observed model diagnostics">
                        {latest ? (
                          <>
                            <p>
                              Cutoff: {latest.information_cutoff} ·{" "}
                              {
                                models[
                                  resultSpec.regime_model as keyof typeof models
                                ]
                              }
                            </p>
                            {resultSpec.regime_model === "HMM" ? (
                              <div className="cp-metrics">
                                <div>
                                  <small>Higher-volatility probability</small>
                                  <strong>
                                    {pct(latest.regime.high_risk_probability)}
                                  </strong>
                                </div>
                                <div>
                                  <small>Converged initializations</small>
                                  <strong>
                                    {latest.regime.converged_initializations} /
                                    3
                                  </strong>
                                </div>
                              </div>
                            ) : (
                              <p className="cp-note">
                                Defensive score:{" "}
                                {pct(latest.regime.defensive_score)} ·{" "}
                                {latest.regime.label}
                              </p>
                            )}
                            <details>
                              <summary>
                                Model parameters and diagnostics
                              </summary>
                              <pre>
                                {JSON.stringify(latest.regime, null, 2)}
                              </pre>
                            </details>
                          </>
                        ) : (
                          <p className="cp-empty">
                            Complete a coordinated run to inspect actual model
                            diagnostics.
                          </p>
                        )}
                      </Card>
                    )}
                  </>
                )}
                {module === "Portfolio Construction" && (
                  <>
                    <div className="cp-subtabs">
                      {["ETF Selection", "Optimization"].map((t) => (
                        <button
                          aria-pressed={portfolioTab === t}
                          onClick={() => setPortfolioTab(t)}
                          key={t}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    {portfolioTab === "ETF Selection" ? (
                      <Card title="Eligible investment universe">
                        <p className="cp-note">
                          Selection defines eligibility. Final weights depend on
                          the portfolio as a whole; an eligible ETF can receive
                          zero weight.
                        </p>
                        <div className="cp-etfs">
                          {(caps?.etfs ?? Object.keys(names)).map(
                            (t: string) => (
                              <label key={t} className="cp-etf">
                                <input
                                  type="checkbox"
                                  checked={draft.etfs.includes(t)}
                                  onChange={(e) =>
                                    change(
                                      "etfs",
                                      e.target.checked
                                        ? [...draft.etfs, t]
                                        : draft.etfs.filter((x) => x !== t),
                                    )
                                  }
                                />
                                <strong>{t}</strong>
                                <span>{names[t]}</span>
                              </label>
                            ),
                          )}
                        </div>
                        <p className="cp-note">
                          Missing prices block the design. No interpolation or
                          automatic replacement.
                        </p>
                        <button onClick={() => setPortfolioTab("Optimization")}>
                          Continue to Optimization →
                        </button>
                      </Card>
                    ) : (
                      <>
                        <Card title="Portfolio objective">
                          <h3>Mean–variance with trading costs</h3>
                          <p className="cp-note">
                            Balances estimated return, variance and absolute
                            changes from the existing holdings. Cash earns 0% in
                            this research model.
                          </p>
                          <div className="cp-fields">
                            {number("risk_aversion", "Risk aversion", {
                              min: 0.1,
                              max: 100,
                              step: 0.1,
                            })}
                            {number(
                              "maximum_etf_weight",
                              "Maximum weight per ETF (%)",
                              { percent: true, min: 0.1, max: 100, step: 1 },
                            )}
                          </div>
                        </Card>
                        <Card title="Shared risk estimate">
                          <div className="cp-fields">
                            {number(
                              "covariance_shrinkage",
                              "Shrinkage toward diagonal covariance (%)",
                              { percent: true, min: 1, max: 100 },
                            )}
                            <label>
                              Estimator
                              <input
                                readOnly
                                value="Daily sample covariance · annualized"
                              />
                            </label>
                          </div>
                          <p className="cp-note">
                            A fixed, explicit shrinkage parameter reduces
                            off-diagonal covariance estimates. Capital Exposure
                            and the optimizer use this same matrix.
                          </p>
                        </Card>
                        <Card title="Inherited capital constraint">
                          <p>
                            {draft.control_mode === "MAX_EXPOSURE"
                              ? `Total ETF weights ≤ ${pct(draft.maximum_exposure)}`
                              : `Estimated volatility ≤ ${pct(draft.risk_budget)}`}{" "}
                            ·{" "}
                            {draft.regime_response === "ADAPTIVE"
                              ? "Regime-adjusted"
                              : "Fixed"}
                          </p>
                          <p className="cp-note">
                            Checked at each decision target. Market movement can
                            change realized exposure and volatility before the
                            next rebalance.
                          </p>
                          <button onClick={() => navigate("Capital Exposure")}>
                            Edit capital policy →
                          </button>
                        </Card>
                      </>
                    )}
                  </>
                )}
                {module === "Data & Universe" && (
                  <Card title="Shared dataset">
                    <p>
                      {caps
                        ? `${caps.data_first_observation} → ${caps.data_last_observation}`
                        : "Loading dataset…"}
                    </p>
                    <p className="cp-note">
                      Existing adjusted-close snapshot. Historical data vintage
                      is not point-in-time certified.
                    </p>
                    <p>
                      Eligible ETFs: {draft.etfs.join(", ") || "None selected"}.
                    </p>
                    <button onClick={() => navigate("Portfolio Construction")}>
                      Edit ETF Selection →
                    </button>
                  </Card>
                )}
                {["Robustness & Stress", "Compare & Promote"].includes(
                  module,
                ) && (
                  <Card title="Research evidence">
                    <p className="cp-empty">
                      {module === "Robustness & Stress"
                        ? "Stress campaigns are not enabled for the new coordinated engine. Each run retains its configuration and diagnostics for review."
                        : "Coordinated runs are retained in Runs. Formal promotion and cross-methodology comparison are not enabled; the original comparison tools remain in Baseline reference."}
                    </p>
                    <button onClick={() => void history()}>Open Runs</button>
                  </Card>
                )}
                {!["Robustness & Stress", "Compare & Promote"].includes(
                  module,
                ) && (
                  <Card title="Shared backtest" step="03">
                    <div className="cp-fields">
                      <label>
                        From
                        <input
                          type="date"
                          value={draft.evaluation_start}
                          onInput={(e) =>
                            change("evaluation_start", e.currentTarget.value)
                          }
                        />
                      </label>
                      <label>
                        To · exclusive
                        <input
                          type="date"
                          value={draft.evaluation_end_exclusive}
                          onInput={(e) =>
                            change(
                              "evaluation_end_exclusive",
                              e.currentTarget.value,
                            )
                          }
                        />
                      </label>
                      {number(
                        "training_window_months",
                        "Training window · months",
                        { min: 13, max: 1200 },
                      )}
                      {select("window_type", "Window", {
                        ROLLING: "Rolling",
                        EXPANDING: "Expanding",
                      })}
                      {select("rebalance_frequency", "Rebalance", {
                        MONTHLY: "Monthly",
                        QUARTERLY: "Quarterly",
                      })}
                      {number(
                        "transaction_cost_bps",
                        "Trading cost · basis points",
                        { max: 1000, step: 0.1 },
                      )}
                    </div>
                    <p className="cp-note">
                      One continuous portfolio. Calendar anchors use the next
                      trading day; orders fill at the following observed close.
                      Models use information strictly before the decision. At
                      least 253 training prices required.
                    </p>
                    <div className="cp-actions">
                      <button
                        disabled={busy || !caps}
                        onClick={() => void validate()}
                      >
                        Check design
                      </button>
                      <button
                        className="cp-primary"
                        disabled={busy || !caps}
                        onClick={() => void submit()}
                      >
                        {busy
                          ? "Run in progress…"
                          : "Run coordinated backtest →"}
                      </button>
                    </div>
                    {plan && (
                      <p className="cp-valid">
                        Design checked · {plan.number_of_folds} decisions ·
                        first information cutoff{" "}
                        {plan.folds[0].information_cutoff}
                      </p>
                    )}
                  </Card>
                )}
              </div>
              <aside className="cp-summary">
                <div className="cp-eyebrow">CONNECTED STRATEGY</div>
                <h2>One decision chain</h2>
                <dl>
                  <dt>Regime</dt>
                  <dd>{models[draft.regime_model]}</dd>
                  <dt>Capital policy</dt>
                  <dd>
                    {draft.control_mode === "MAX_EXPOSURE"
                      ? `${pct(draft.maximum_exposure)} maximum exposure`
                      : `${pct(draft.risk_budget)} volatility budget`}
                  </dd>
                  <dt>Response</dt>
                  <dd>
                    {draft.regime_response === "FIXED"
                      ? "Fixed ceiling"
                      : "Adaptive ceiling"}
                  </dd>
                  <dt>Eligible ETFs</dt>
                  <dd>{draft.etfs.join(" · ") || "Choose ETFs"}</dd>
                  <dt>Construction</dt>
                  <dd>Mean–variance + trading costs</dd>
                  <dt>Accounting</dt>
                  <dd>One portfolio · one cash account</dd>
                </dl>
                <p className="cp-note">
                  These are draft settings. Running a design creates a separate,
                  versioned result.
                </p>
              </aside>
            </div>
          )}
          {tab === "Progress" && (
            <Card
              title={
                busy ? "Running the connected strategy" : "Execution status"
              }
            >
              {run?.progress ? (
                <>
                  <p aria-live="polite">
                    {run.progress.stage} ·{" "}
                    {Math.round(run.progress.percent_complete)}%
                  </p>
                  <progress max="100" value={run.progress.percent_complete} />
                  <p className="cp-note">
                    {run.progress.completed_work_units} /{" "}
                    {run.progress.total_work_units} tasks ·{" "}
                    {run.progress.estimated_remaining_ms === null
                      ? "Estimating remaining time"
                      : `Approximately ${Math.ceil(run.progress.estimated_remaining_ms / 1000)} seconds remaining`}
                  </p>
                </>
              ) : (
                <p className="cp-empty">
                  {runId
                    ? "Waiting for worker status…"
                    : "Configure and run a design to see progress."}
                </p>
              )}
            </Card>
          )}
          {tab === "Results" &&
            (result ? (
              <>
                <div className="cp-result-context">
                  Saved result · {resultSpec.evaluation_start} →{" "}
                  {resultSpec.evaluation_end_exclusive} ·{" "}
                  {models[resultSpec.regime_model as keyof typeof models]} ·{" "}
                  {resultSpec.control_mode === "MAX_EXPOSURE"
                    ? "Maximum exposure"
                    : "Risk budget"}
                  <small>
                    Results belong to the saved configuration, including when
                    draft settings have changed.
                  </small>
                </div>
                <div className="cp-metrics">
                  {[
                    ["Net CAGR", pct(result.metrics.cagr)],
                    ["Realized volatility", pct(result.metrics.volatility)],
                    ["Maximum drawdown", pct(result.metrics.max_drawdown)],
                    [
                      "Net Sharpe",
                      result.metrics.net_sharpe?.toFixed(2) ?? "—",
                    ],
                  ].map(([label, v]) => (
                    <div key={label}>
                      <small>{label}</small>
                      <strong>{v}</strong>
                    </div>
                  ))}
                </div>
                <Card title="Portfolio value · initial value 100">
                  <Chart points={result.points} field="index" />
                </Card>
                <div className="cp-two">
                  <Card title="Drawdown">
                    <Chart points={result.points} field="drawdown" />
                  </Card>
                  <Card title="Actual ETF exposure">
                    <Chart points={result.points} field="exposure" />
                  </Card>
                </div>
                <Card title="Latest decision targets">
                  <p className="cp-note">
                    Decision {latest.decision_date} · information through{" "}
                    {latest.information_cutoff}. Estimated volatility{" "}
                    {pct(latest.estimated_volatility)}
                    {latest.risk_budget !== null
                      ? ` / ceiling ${pct(latest.risk_budget)}`
                      : ` · exposure ceiling ${pct(latest.maximum_exposure)}`}
                    .
                  </p>
                  <div className="cp-weights">
                    {[
                      ...Object.entries(latest.weights),
                      ["Cash", latest.cash],
                    ].map(([t, w]) => (
                      <div key={String(t)}>
                        <span>{String(t)}</span>
                        <strong>{pct(Number(w))}</strong>
                        <meter min="0" max="1" value={Number(w)} />
                      </div>
                    ))}
                  </div>
                </Card>
                <p className="cp-note">
                  Costs charged: {result.metrics.costs.toFixed(4)} index units.
                  Zero cash yield. Target constraints do not prevent market
                  drift between rebalances.
                </p>
              </>
            ) : (
              <Card title="Portfolio results">
                <p className="cp-empty">
                  No successful coordinated result selected. Configure a run or
                  open a completed run from Runs.
                </p>
              </Card>
            ))}
          {tab === "Runs" && (
            <Card title="Temporary research history">
              {runs.length ? (
                <div className="cp-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th>Model</th>
                        <th>Control</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((r) => (
                        <tr key={r.run_id}>
                          <td>
                            {r.spec.evaluation_start} →{" "}
                            {r.spec.evaluation_end_exclusive}
                          </td>
                          <td>
                            {models[r.spec.regime_model as keyof typeof models]}
                          </td>
                          <td>
                            {r.spec.control_mode === "MAX_EXPOSURE"
                              ? "Exposure"
                              : "Risk budget"}
                          </td>
                          <td>{r.status}</td>
                          <td>
                            <button
                              onClick={() => {
                                setRun(null);
                                setRunId(r.run_id);
                                setRefresh((n) => n + 1);
                                setTab("Results");
                              }}
                            >
                              Open
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="cp-empty">No coordinated runs stored.</p>
              )}
              <p className="cp-note">
                History is temporary. Baseline runs remain in Baseline
                reference.
              </p>
            </Card>
          )}
          {tab === "Audit" && (
            <Card title="Calculation evidence">
              {run ? (
                <>
                  <p>
                    {run.latest_status} · {run.run_id}
                  </p>
                  <details>
                    <summary>Saved configuration and provenance</summary>
                    <pre>
                      {JSON.stringify(
                        { spec: run.spec, provenance: result?.provenance },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                  <details>
                    <summary>
                      Decision-by-decision model and constraint evidence
                    </summary>
                    <pre>
                      {JSON.stringify(
                        result?.decisions ?? run.latest_result,
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                  <details>
                    <summary>Immutable attempts</summary>
                    <pre>{JSON.stringify(run.attempt_history, null, 2)}</pre>
                  </details>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      try {
                        setError("");
                        const r = await api(`/runs/${run.run_id}/rerun`, {});
                        setRunId(null);
                        setRun(null);
                        setBusy(true);
                        setTab("Progress");
                        setRunId(r.run_id);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Explicitly rerun this saved design
                  </button>
                </>
              ) : (
                <p className="cp-empty">
                  Select a run to inspect its actual evidence.
                </p>
              )}
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}
