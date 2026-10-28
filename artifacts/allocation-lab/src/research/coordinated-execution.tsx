import { NoEffectWarning, PolicySummary, freqLabel, freqOf, policySentence } from "./capital-policy";
import { BacktestInputs } from "./backtest-inputs";
import { portfolioFeasibilityIssue } from "../../../api-server/src/lib/workbench/portfolio-feasibility";
import { ExecutionProgress } from "./execution-progress";
import { sourceLabel } from "./dataset-persistence";
import type { useBacktestRange } from "./use-backtest-range";
import { useEffect, useState } from "react";
import {
  forecastNames,
  type ResearchSubmission,
} from "../../../api-server/src/lib/workbench/coordinated-contract";
import { ForecastEvidence } from "./coordinated-forecasts";
import {
  FrozenEvidence,
  GateFailureEvidence,
  QualityGateEvidence,
  qcLabel,
  ReviewPanel,
  StorageBadge,
  cashPolicyLabel,
} from "./coordinated-p0";
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
  | "transaction_cost_bps"
  | "slippage_bps";
type View = "Configure" | "Progress" | "Results" | "History" | "Audit";
interface Props {
  calendarRange: ReturnType<typeof useBacktestRange>;
  scope: ResearchScope;
  visible: boolean;
  draft: ResearchSubmission & { cash_policy?: any; slippage_bps?: number; quality_control?: any };
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
  calendarRange,
}: Props) {
  const study = scope === "CAPITAL_EXPOSURE",
    label = study ? "Independent SPY/cash study" : "Full portfolio backtest";
  const [view, setView] = useState<View>("Configure"),
    [runId, setRunId] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0),
    [run, setRun] = useState<any>(null),
    [runs, setRuns] = useState<any[]>([]),
    [historyLoading, setHistoryLoading] = useState(false),
    [historyError, setHistoryError] = useState(""),
    [plan, setPlan] = useState<any>(null),
    [bounds, setBounds] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (visible) window.scrollTo({ top: 0 });
  }, [visible, view]);
  useEffect(() => {
    setPlan(null);
    setError("");
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
  async function check() {
    setError("");
    if (!study) {
      const issue = portfolioFeasibilityIssue(draft as any);
      if (issue) {
        setError(`${issue.message} ${issue.suggestion}`);
        return null;
      }
    }
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
    setView("Progress");
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
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await researchApi("/runs");
      setRuns(response.runs.filter((row: any) => runScope(row.spec) === scope));
    } catch (e) {
      setHistoryError((e as Error).message);
      setError((e as Error).message);
    } finally {
      setHistoryLoading(false);
    }
  }
  const frictions = (
<div className="cp-fields">
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
              <label>
                Slippage · basis points
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step={0.1}
                  value={
                    Number.isNaN(Number(draft.slippage_bps ?? 0))
                      ? ""
                      : (draft.slippage_bps ?? 0)
                  }
                  onInput={(e) =>
                    onChange(
                      "slippage_bps",
                      e.currentTarget.value === ""
                        ? NaN
                        : Number(e.currentTarget.value),
                    )
                  }
                />
              </label>
            </div>
  );
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
      {!study && run?.latest_status === "FAILED" && (view === "Results" || view === "Progress" || view === "Audit") && (
        <GateFailureEvidence failure={run.latest_result} />
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
                From · first OOS date
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
                  value={draft.evaluation_end_exclusive}
                  onInput={(e) =>
                    onChange("evaluation_end_exclusive", e.currentTarget.value)
                  }
                />
              </label>
            </div>
            <p className="cp-note">
              From is the first out-of-sample decision date, after the required training history and causal warmup.
              To is exclusive: choose the following calendar day to include the dataset’s final observation.
              Both dates remain editable and are preserved when you navigate.
            </p>
            <button type="button" disabled={calendarRange.busy || !caps} onClick={calendarRange.reset}>
              {calendarRange.busy ? "Finding executable range…" : "Use full executable range"}
            </button>
            {calendarRange.error && <p className="cp-error" role="alert">Full range unavailable: {calendarRange.error} Dates have not been substituted.</p>}
            {calendarRange.bounds && <p className="cp-note">
              Full range: {calendarRange.bounds.earliest_supported_evaluation_start} → {calendarRange.bounds.latest_supported_evaluation_end_exclusive} (exclusive).
              {" "}Last dataset observation: {caps?.data_last_observation}. Reapply the full range after changing training or warmup settings if desired.
              {" "}Data gaps, cash coverage and investment constraints are validated separately before execution.
            </p>}
            <details className="cp-advanced" data-testid={study ? "details-study-advanced" : undefined}>
              <summary>
                {study
                  ? `Advanced · ${draft.training_window_months} mo ${draft.window_type === "ROLLING" ? "rolling" : "expanding"} · ${draft.rebalance_frequency === "MONTHLY" ? "monthly" : "quarterly"} · cost ${draft.transaction_cost_bps} bps · slippage ${draft.slippage_bps ?? 0} bps`
                  : `Advanced estimation window · ${draft.training_window_months} months · ${draft.window_type === "ROLLING" ? "rolling" : "expanding"}`}
              </summary>
              <div className="cp-fields">
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
              </div>
            {study ? frictions : null}
            </details>
            {!study && frictions}
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
            {!study && <p className="cp-note">
              The dataset is fixed first. Training windows and causal model
              lookbacks consume earlier observations, so the first OOS date is
              derived automatically. You may choose a later start, but not an
              earlier one. Nothing is imputed or extended.
            </p>}
            <div className="cp-actions">
              <button
                className="cp-primary"
                disabled={busy || calendarRange.busy || !caps}
                onClick={() => void execute()}
              >
                {busy
                  ? "Run in progress…"
                  : study
                    ? "Run independent exposure study"
                    : "Run full portfolio backtest"}
              </button>
            </div>
            <p className="cp-note">
              Running validates the design first; conflicts stop the run and are
              shown with the settings to change.{!study && " Final weights must meet the holdings mandate at each rebalance. If the optimizer's solution does not meet it, the run stops with a specific reason; weights are never adjusted silently."}
            </p>
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
            {study ? (
            <dl>
              <dt>Regime</dt>
              <dd>{models[draft.regime_model]}</dd>
              <dt>Capital policy</dt>
              <dd data-testid={study ? "text-study-config-policy" : undefined}>
                {study ? policySentence(draft) : draft.control_mode === "MAX_EXPOSURE"
                  ? `${pct(draft.maximum_exposure)} maximum exposure`
                  : `${pct(draft.risk_budget)} volatility budget`}
              </dd>
              <dt>Cash</dt>
              <dd>{cashPolicyLabel(draft.cash_policy)}</dd>
              <dt>Slippage</dt>
              <dd>{draft.slippage_bps ?? 0} bps</dd>
              {!study && (
                <>
                  <dt>Quality control</dt>
                  <dd data-testid="text-qc-summary">{qcLabel(draft.quality_control)}</dd>
                </>
              )}
              <dt>Capital clock</dt>
              <dd data-testid={study ? "text-study-config-frequency" : "text-portfolio-config-frequency"}>{freqLabel(freqOf(draft))}</dd>
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
            ) : (
              <BacktestInputs draft={draft} caps={caps} />
            )}
            <NoEffectWarning policy={draft as any} testId={study ? "warning-study-config-no-effect" : "warning-portfolio-config-no-effect"} />
            {study && <p className="cp-note">
              The study invests the allowed exposure directly in SPY. A risk budget is converted to SPY weight using its estimated volatility.
            </p>}
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
          <ExecutionProgress record={run} runId={runId} />
        </Card>
      )}
      {view === "Results" &&
        (result ? (
          <>
            <div className="cp-result-context">
              {label} · {saved.evaluation_start} →{" "}
              {saved.evaluation_end_exclusive} ·{" "}
              {models[saved.regime_model as keyof typeof models]}
              <StorageBadge record={run} />
              <small>
                Results use the saved configuration; changes to draft settings
                do not recalculate them.
              </small>
            </div>
            {study && <PolicySummary policy={saved} label="Rule executed in this saved run" testId="text-study-executed-policy" />}
            <CapitalClockSummary clock={result.capital_clock} spec={saved} />
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
                title={`${study ? "Actual SPY exposure" : "Actual ETF exposure"} · realized after fills${saved?.capital_signal_frequency === "DAILY" ? " · daily capital clock" : ""}`}
              >
                <ResearchChart points={result.points} field="exposure" />
              </Card>
            </div>
            {saved?.capital_signal_frequency === "DAILY" || result.capital_clock?.frequency === "DAILY" ? (
              <LatestDailyTarget clock={result.capital_clock} study={study} />
            ) : (
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
            )}
            <FrozenEvidence result={result} spec={saved} />
            {!study && <QualityGateEvidence evidence={result.quality_gate_evidence} spec={saved} />}
            {!study && <ForecastEvidence result={result} spec={saved} />}
            <ReviewPanel run={run} />
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
          {historyLoading ? (
            <p className="cp-note" role="status" data-testid="text-history-loading">Loading saved runs…</p>
          ) : historyError ? (
            <p className="cp-note" role="alert">Saved runs could not be loaded. Select History to try again.</p>
          ) : runs.length ? (
            <div className="cp-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Regime</th>
                    {!study && <th>Forecast</th>}
                    <th>Dataset</th>
                    <th>Control</th>
                    {!study && <th>Quality control</th>}
                    <th>Status</th>
                    <th>Storage</th>
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
                        {study ? policySentence(row.spec) : row.spec.control_mode === "MAX_EXPOSURE"
                          ? "Exposure"
                          : "Risk budget"}
                      </td>
                      {!study && (
                        <td>
                          {row.latest_successful_result?.quality_gate_evidence?.status ??
                            qcLabel(row.spec.quality_control)}
                        </td>
                      )}
                      <td>{row.review_state ?? row.status}</td>
                      <td>
                        <StorageBadge record={row} compact />
                      </td>
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
            History is read-only and never changes the draft. Runs without
            persistent storage status are original temporary results and
            remain unverified. Independent studies and portfolio backtests
            have separate histories.
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
              <StorageBadge record={run} />
              {result && <CapitalClockAudit clock={result.capital_clock} />}
              {result && <FrozenEvidence result={result} spec={run.spec} />}
              <ReviewPanel run={run} />
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

const NR = "Not recorded";
const num = (v: unknown, digits = 4) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : NR);
/** Frozen clock label: prefers recorded clock, then saved spec. Never the current draft. */
function CapitalClockSummary({ clock, spec }: { clock: any; spec: any }) {
  const frequency = clock?.frequency ?? spec?.capital_signal_frequency;
  return (
    <Card title="Capital clock · saved run">
      <dl className="cp-engines cpx-clock">
        <dt>Capital signal frequency</dt>
        <dd data-testid="text-result-capital-frequency">{freqLabel(frequency)}{!clock?.frequency && !spec?.capital_signal_frequency ? " · not recorded, historical default" : ""}</dd>
        <dt>Intramonth exposure changes</dt>
        <dd data-testid="text-result-intramonth-changes">{typeof clock?.intramonth_exposure_changes === "number" ? clock.intramonth_exposure_changes : NR}</dd>
        <dt>Capital overlay costs</dt>
        <dd data-testid="text-result-overlay-costs">{num(clock?.capital_overlay_costs)}{clock ? ` (transaction ${num(clock.capital_overlay_transaction_costs)} · slippage ${num(clock.capital_overlay_slippage)})` : ""}</dd>
        <dt>Joint scheduled-trade costs</dt>
        <dd data-testid="text-result-joint-costs">{num(clock?.joint_rebalance_costs)}</dd>
      </dl>
      <p className="cp-note">
        Costs are ledger units on initial value 100, not basis points. Overlay costs cover only pure intramonth capital trades; trades on scheduled rebalance dates are reported as joint costs.
        {clock?.cost_attribution ? ` ${clock.cost_attribution}` : ""}
      </p>
    </Card>
  );
}
function CapitalClockAudit({ clock }: { clock: any }) {
  if (!clock) return <p className="cp-note" data-testid="text-audit-capital-clock">Capital clock: {NR} for this result.</p>;
  const signals: any[] = Array.isArray(clock.signals) ? clock.signals : [];
  return (
    <details data-testid="details-audit-capital-clock">
      <summary>Capital clock · {freqLabel(clock.frequency)} · {signals.length} signals</summary>
      {clock.execution_convention && <p className="cp-note" data-testid="text-audit-execution-convention">{clock.execution_convention}</p>}
      <div className="cp-scroll">
        <table data-testid="table-capital-signals">
          <thead><tr><th>Signal day</th><th>Data through</th><th>Training</th><th>Executes</th><th>Optimizer</th><th>Exposure</th><th>Trade</th><th>Frozen risky mix</th></tr></thead>
          <tbody>
            {signals.map((s, i) => (
              <tr key={`${s.decision_date}-${i}`} data-testid={`row-capital-signal-${i}`}>
                <td>{s.decision_date}</td>
                <td>{s.information_cutoff}</td>
                <td>{s.training_start ?? "—"} · {s.training_observations ?? "—"} obs</td>
                <td>{s.execution_date ?? "No fill"}</td>
                <td>{s.optimizer_refreshed ? "Refreshed" : "Frozen"}</td>
                <td>{pct(s.exposure)}</td>
                <td>{s.trade_requested ? "Yes" : "No"}</td>
                <td>{Object.entries(s.frozen_risky_proportions ?? {}).map(([k, v]) => `${k} ${pct(Number(v))}`).join(" · ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details><summary>Raw capital clock</summary><pre>{JSON.stringify(clock, null, 2)}</pre></details>
    </details>
  );
}

/** Daily clock: latest capital signal target = exposure x frozen risky proportions. Not the last optimizer weights. */
function LatestDailyTarget({ clock, study }: { clock: any; study: boolean }) {
  const s = Array.isArray(clock?.signals) ? clock.signals.at(-1) : null;
  if (!s)
    return (
      <Card title="Latest daily capital target">
        <p className="cp-empty" data-testid="text-latest-signal-missing">Daily capital signals not recorded for this result.</p>
      </Card>
    );
  const exposure = Number(s.exposure);
  const rows: [string, number][] = [
    ...Object.entries(s.frozen_risky_proportions ?? {}).map(([k, v]) => [k, exposure * Number(v)] as [string, number]),
    ["Cash", 1 - exposure],
  ];
  return (
    <Card title="Latest daily capital target">
      <p className="cp-note" data-testid="text-latest-signal-context">
        Signal day {s.decision_date} · information through {s.information_cutoff} ·{" "}
        {s.execution_date ? `fills at close ${s.execution_date}` : "no fill inside the evaluation window"} · target exposure {pct(exposure)}.
      </p>
      <div className="cp-weights" data-testid="list-latest-signal-targets">
        {rows.map(([ticker, weight]) => (
          <div key={ticker} data-testid={`text-latest-target-${ticker}`}>
            <span>{ticker}</span>
            <strong>{pct(weight)}</strong>
            <meter min={0} max={1} value={weight} />
          </div>
        ))}
      </div>
      <p className="cp-note">
        Target = signal exposure x risky proportions frozen at the last optimizer date{study ? " (SPY only)" : ""}. These are targets; the Actual exposure chart above shows realized exposure after fills and drift.
      </p>
    </Card>
  );
}
