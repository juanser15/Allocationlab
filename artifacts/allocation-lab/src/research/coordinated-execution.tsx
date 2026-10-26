import { sourceLabel } from "./dataset-persistence";
import { useEffect, useState } from "react";
import {
  forecastNames,
  type ResearchSubmission,
} from "../../../api-server/src/lib/workbench/coordinated-contract";
import { ForecastEvidence } from "./coordinated-forecasts";
import {
  Card,
  MetricCards,
  ResearchChart,
  models,
  pct,
  researchApi,
} from "./coordinated-ui";
export type ResearchScope = "PORTFOLIO" | "CAPITAL_EXPOSURE";
export const runScope = (spec: any): ResearchScope =>
  spec?.research_scope ?? "PORTFOLIO";
export type CalendarField =
  | "evaluation_start"
  | "evaluation_end_exclusive"
  | "training_window_months"
  | "window_type"
  | "rebalance_frequency"
  | "transaction_cost_bps";
type View = "Configure" | "Progress" | "Results" | "History" | "Audit";
interface Props {
  scope: ResearchScope;
  visible: boolean;
  draft: ResearchSubmission;
  onChange: (key: CalendarField, value: any) => void;
  caps: any;
  navigate: (module: string) => void;
  onCompleted?: (result: any, spec: any) => void;
}
export function ExecutionWorkspace({
  scope,
  visible,
  draft,
  onChange,
  caps,
  navigate,
  onCompleted,
}: Props) {
  const study = scope === "CAPITAL_EXPOSURE",
    label = study ? "Independent SPY/cash study" : "Full portfolio backtest";
  const [view, setView] = useState<View>("Configure"),
    [runId, setRunId] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0),
    [run, setRun] = useState<any>(null),
    [runs, setRuns] = useState<any[]>([]),
    [plan, setPlan] = useState<any>(null),
    [bounds, setBounds] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (visible) window.scrollTo({ top: 0 });
  }, [visible, view]);
  useEffect(() => {
    setPlan(null);
  }, [draft]);
  useEffect(() => {
    if (!runId) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const record = await researchApi(`/runs/${runId}`);
        if (stopped) return;
        if (runScope(record.spec) !== scope)
          throw Error("This run belongs to a different research section.");
        setRun(record);
        if (["RUNNING", "PENDING"].includes(record.latest_status))
          timer = setTimeout(poll, 1000);
        else {
          setBusy(false);
          if (record.latest_status === "SUCCESS") {
            setView("Results");
            onCompleted?.(record.latest_successful_result, record.spec);
          }
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
  }, [runId, refresh, scope]);
  const result =
      run?.latest_status === "SUCCESS" ? run.latest_successful_result : null,
    latest = result?.decisions?.at(-1),
    saved = run?.spec;
  const maxEnd = caps?.data_last_observation
    ? new Date(Date.parse(caps.data_last_observation) + 86400000)
        .toISOString()
        .slice(0, 10)
    : undefined;

  async function check() {
    setError("");
    try {
      const p = await researchApi("/plan", { ...draft, research_scope: scope });
      setPlan(p);
      setBounds(p.experiment_bounds ?? bounds);
      if (p.normalized_request.evaluation_start !== draft.evaluation_start || p.normalized_request.evaluation_end_exclusive !== draft.evaluation_end_exclusive) throw new Error("The planner changed the requested dates. Execution is blocked.");
      return p;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }
  function open(id: string) {
    setRun(null);
    setRunId(id);
    setRefresh((n) => n + 1);
    setView("Results");
  }
  async function execute() {
    setBusy(true);
    try {
      const checked = await check();
      if (!checked) {
        setBusy(false);
        return;
      }
      const receipt = await researchApi("/runs", {
        ...draft,
        evaluation_start:
          checked.normalized_request?.evaluation_start ??
          draft.evaluation_start,
        evaluation_end_exclusive:
          checked.normalized_request?.evaluation_end_exclusive ??
          draft.evaluation_end_exclusive,
        research_scope: scope,
      });
      setRun(null);
      setRunId(receipt.run_id);
      setRefresh((n) => n + 1);
      setView("Progress");
      if (!["RUNNING", "PENDING"].includes(receipt.status)) setBusy(false);
    } catch (e) {
      setBusy(false);
      setError((e as Error).message);
    }
  }
  async function history() {
    setView("History");
    try {
      const response = await researchApi("/runs");
      setRuns(response.runs.filter((row: any) => runScope(row.spec) === scope));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section hidden={!visible} aria-label={label} data-research-scope={scope}>
      <div className="cp-execution-context">
        <strong>{label}</strong>
        <p>
          {study
            ? "Optional independent research: apply the capital policy directly to SPY and cash, then compare with passive SPY. Portfolio ETF selection and optimization are excluded."
            : "Execute the complete configured strategy using Capital Exposure and Portfolio Construction. This is the only section that runs the integrated portfolio backtest."}
        </p>
      </div>
      <nav className="cp-tabs" aria-label={`${label} views`}>
        {(
          ["Configure", "Progress", "Results", "History", "Audit"] as const
        ).map((tab) => (
          <button
            key={tab}
            aria-pressed={tab === view}
            onClick={() => (tab === "History" ? void history() : setView(tab))}
          >
            {tab}
          </button>
        ))}
      </nav>
      {error && (
        <div className="cp-error" role="alert">
          {error}
        </div>
      )}
      {run?.latest_status === "FAILED" && (
        <div className="cp-error" role="alert">
          {run.latest_result?.safe_message}
        </div>
      )}
      {view === "Configure" && (
        <div className="cp-columns">
          <Card
            title={
              study
                ? "Independent study calendar"
                : "Portfolio backtest calendar"
            }
          >
            <div className="cp-fields">
              <label>
                First OOS date
                <input
                  type="date"

                  value={draft.evaluation_start}
                  onInput={(e) =>
                    onChange("evaluation_start", e.currentTarget.value)
                  }
                />
              </label>
              <label>
                To · exclusive
                <input
                  type="date"
                  max={maxEnd}
                  value={draft.evaluation_end_exclusive}
                  onInput={(e) =>
                    onChange("evaluation_end_exclusive", e.currentTarget.value)
                  }
                />
              </label>
              <label>
                Training window · months
                <input
                  type="number"
                  min={1}
                  max={1200}
                  value={
                    Number.isNaN(draft.training_window_months)
                      ? ""
                      : draft.training_window_months
                  }
                  onInput={(e) =>
                    onChange(
                      "training_window_months",
                      e.currentTarget.value === ""
                        ? NaN
                        : Number(e.currentTarget.value),
                    )
                  }
                />
              </label>
              <label>
                Window
                <select
                  aria-label="Window"
                  value={draft.window_type}
                  onChange={(e) => onChange("window_type", e.target.value)}
                >
                  <option value="ROLLING">Rolling</option>
                  <option value="EXPANDING">Expanding</option>
                </select>
              </label>
              <label>
                Rebalance
                <select
                  aria-label="Rebalance"
                  value={draft.rebalance_frequency}
                  onChange={(e) =>
                    onChange("rebalance_frequency", e.target.value)
                  }
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="QUARTERLY">Quarterly</option>
                </select>
              </label>
              <label>
                Trading cost · basis points
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step={0.1}
                  value={
                    Number.isNaN(draft.transaction_cost_bps)
                      ? ""
                      : draft.transaction_cost_bps
                  }
                  onInput={(e) =>
                    onChange(
                      "transaction_cost_bps",
                      e.currentTarget.value === ""
                        ? NaN
                        : Number(e.currentTarget.value),
                    )
                  }
                />
              </label>
            </div>
            {caps && (
              <div className="cp-result-context">
                <strong>
                  Active data ·{" "}
                  {sourceLabel(caps.dataset_source)}
                </strong>
                <small>
                  Dataset {caps.data_first_observation} →{" "}
                  {caps.data_last_observation}
                  {bounds?.earliest_supported_evaluation_start
                    ? ` · earliest OOS for this experiment: ${bounds.earliest_supported_evaluation_start}`
                    : ""}
                </small>
              </div>
            )}
            <p className="cp-note">
              The dataset is fixed first. Training windows and causal model
              lookbacks consume earlier observations, so the first OOS date is
              derived automatically. You may choose a later start, but not an
              earlier one. Nothing is imputed or extended.
            </p>
            <div className="cp-actions">
              <button disabled={busy || !caps} onClick={() => void check()}>
                Check {study ? "study" : "backtest"} design
              </button>
              <button
                className="cp-primary"
                disabled={busy || !caps}
                onClick={() => void execute()}
              >
                {busy
                  ? "Run in progress…"
                  : study
                    ? "Run independent exposure study"
                    : "Run full portfolio backtest"}
              </button>
            </div>
            {plan && (
              <p className="cp-valid">
                Design checked · OOS starts {plan.effective_evaluation_start} ·{" "}
                {plan.number_of_folds} decisions · training window{" "}
                {plan.normalized_request.training_window_months} months.
              </p>
            )}
          </Card>
          <aside className="cp-summary">
            <div className="cp-eyebrow">
              {study ? "INDEPENDENT STUDY" : "CONFIGURED PORTFOLIO"}
            </div>
            <h2>{study ? "SPY + cash only" : "Inputs to this backtest"}</h2>
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
                {draft.regime_response === "ADAPTIVE" ? "Adaptive" : "Fixed"}
              </dd>
              <dt>Assets</dt>
              <dd>
                {study
                  ? "SPY · Cash"
                  : "etfs" in draft
                    ? draft.etfs.join(" · ")
                    : ""}
              </dd>
              <dt>Allocation</dt>
              <dd>
                {study
                  ? "Direct exposure policy · no optimizer"
                  : "Mean–variance + trading costs"}
              </dd>
            </dl>
            <p className="cp-note">
              {study
                ? "The study invests the allowed exposure directly in SPY. A risk budget is converted to SPY weight using its estimated volatility."
                : `Forecast: ${"forecast" in draft ? (draft.forecast?.model ?? "HISTORICAL_MEAN") : "HISTORICAL_MEAN"}. Dataset: ${draft.dataset_id ?? "REFERENCE"}. Configure asset signals in Signals.`}
            </p>
            {!study && (
              <div className="cp-actions">
                <button onClick={() => navigate("Capital Exposure")}>
                  Edit capital policy
                </button>
                <button onClick={() => navigate("Portfolio Construction")}>
                  Edit construction
                </button>
              </div>
            )}
          </aside>
        </div>
      )}
      {view === "Progress" && (
        <Card
          title={
            busy
              ? `Running ${study ? "independent exposure study" : "portfolio backtest"}`
              : "Execution status"
          }
        >
          {run?.progress ? (
            <>
              <p aria-live="polite">
                {run.progress.stage} ·{" "}
                {Math.round(run.progress.percent_complete)}%
              </p>
              <progress max={100} value={run.progress.percent_complete} />
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
                : "No execution started in this section."}
            </p>
          )}
        </Card>
      )}
      {view === "Results" &&
        (result ? (
          <>
            <div className="cp-result-context">
              {label} · {saved.evaluation_start} →{" "}
              {saved.evaluation_end_exclusive} ·{" "}
              {models[saved.regime_model as keyof typeof models]}
              <small>
                Results use the saved configuration; changes to draft settings
                do not recalculate them.
              </small>
            </div>
            <MetricCards metrics={result.metrics} />
            {study && result.benchmark && (
              <Card title="Capital exposure policy versus passive SPY">
                <div className="cp-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Strategy</th>
                        <th>Net CAGR</th>
                        <th>Volatility</th>
                        <th>Max drawdown</th>
                        <th>Net Sharpe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["SPY/cash policy", result.metrics],
                        ["Passive SPY", result.benchmark.metrics],
                      ].map(([name, metrics]) => (
                        <tr key={name}>
                          <td>{name}</td>
                          <td>{pct(metrics.cagr)}</td>
                          <td>{pct(metrics.volatility)}</td>
                          <td>{pct(metrics.max_drawdown)}</td>
                          <td>{metrics.net_sharpe?.toFixed(2) ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="cp-note">
                  Both start in cash and fill at the same first next-close date,
                  with the same trading cost. Passive SPY buys once and holds.
                </p>
              </Card>
            )}
            <Card
              title={
                study
                  ? "SPY/cash study · initial value 100"
                  : "Portfolio value · initial value 100"
              }
            >
              <ResearchChart
                points={result.points}
                benchmark={study ? result.benchmark?.points : undefined}
              />
            </Card>
            <div className="cp-two">
              <Card title="Drawdown">
                <ResearchChart points={result.points} field="drawdown" />
              </Card>
              <Card
                title={study ? "Actual SPY exposure" : "Actual ETF exposure"}
              >
                <ResearchChart points={result.points} field="exposure" />
              </Card>
            </div>
            <Card title="Latest decision targets">
              <p className="cp-note">
                Decision {latest.decision_date} · information through{" "}
                {latest.information_cutoff} · estimated volatility{" "}
                {pct(latest.estimated_volatility)}.
              </p>
              <div className="cp-weights">
                {[...Object.entries(latest.weights), ["Cash", latest.cash]].map(
                  ([ticker, weight]) => (
                    <div key={String(ticker)}>
                      <span>{String(ticker)}</span>
                      <strong>{pct(Number(weight))}</strong>
                      <meter min={0} max={1} value={Number(weight)} />
                    </div>
                  ),
                )}
              </div>
            </Card>
            {!study && <ForecastEvidence result={result} spec={saved} />}
            <p className="cp-note">
              Actual costs: {result.metrics.costs.toFixed(4)} index units.
              Positions carry between rebalances; market movement can cause
              drift from target constraints.
            </p>
          </>
        ) : (
          <Card
            title={study ? "Independent study results" : "Portfolio results"}
          >
            <p className="cp-empty">
              No successful result selected in this section. Configure a run or
              open one from this section’s History.
            </p>
          </Card>
        ))}
      {view === "History" && (
        <Card
          title={
            study ? "Independent exposure studies" : "Full portfolio backtests"
          }
        >
          {runs.length ? (
            <div className="cp-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Regime</th>
                    {!study && <th>Forecast</th>}
                    <th>Dataset</th>
                    <th>Control</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {runs.map((row) => (
                    <tr key={row.run_id}>
                      <td>
                        {row.spec.evaluation_start} →{" "}
                        {row.spec.evaluation_end_exclusive}
                      </td>
                      <td>
                        {models[row.spec.regime_model as keyof typeof models]}
                      </td>
                      {!study && (
                        <td>
                          {
                            forecastNames[
                              (row.spec.forecast?.model ??
                                "HISTORICAL_MEAN") as keyof typeof forecastNames
                            ]
                          }
                        </td>
                      )}
                      <td>
                        {sourceLabel(row.spec.dataset_source)} · v{row.spec.dataset_version}
                      </td>
                      <td>
                        {row.spec.control_mode === "MAX_EXPOSURE"
                          ? "Exposure"
                          : "Risk budget"}
                      </td>
                      <td>{row.status}</td>
                      <td>
                        <button onClick={() => open(row.run_id)}>Open</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="cp-empty">No runs stored for this section.</p>
          )}
          <p className="cp-note">
            Temporary research storage. Independent studies and portfolio
            backtests have separate histories.
          </p>
        </Card>
      )}
      {view === "Audit" && (
        <Card title={`${label} evidence`}>
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
                <summary>Decision evidence</summary>
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
                    const receipt = await researchApi(
                      `/runs/${run.run_id}/rerun`,
                      {},
                    );
                    setRun(null);
                    setRunId(receipt.run_id);
                    setRefresh((n) => n + 1);
                    setBusy(true);
                    setView("Progress");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Explicitly rerun this saved {study ? "study" : "backtest"}
              </button>
            </>
          ) : (
            <p className="cp-empty">
              Select a run from this section to inspect its evidence.
            </p>
          )}
        </Card>
      )}
    </section>
  );
}
