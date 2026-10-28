import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertCircle, CheckCircle2, ChevronRight, Clock3, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  WorkbenchApiClient,
  WorkbenchApiError,
  WORKBENCH_PIT_CLASSIFICATION,
  WORKBENCH_RESEARCH_BOUNDARY,
  WORKBENCH_SESSION_TOKEN_KEY,
  WORKBENCH_STORAGE_CLASSIFICATION,
  validatePhaseB2Capabilities,
  type ResearchIndexPoint,
  type ResearchRunResult,
  type WorkbenchCapabilities,
  type WorkbenchRunDetail,
} from "@/lib/workbench-api";
import {
  ADVANCED_DETAILS_DEFAULT_OPEN,
  STATUS_LABELS,
  attemptFinancialHash,
  buildResearchRunSubmission,
  capabilityFixedValue,
  currentResult,
  formatResearchNumber,
  formatTimestamp,
  isTerminalStatus,
  primaryResultSummary,
  researchIndexPoints,
  safeUiError,
  shortIdentifier,
  shouldPollRun,
  successfulResult,
  walkForwardRows,
  WORKBENCH_POLL_INTERVAL_MS,
} from "@/lib/workbench-state";
import "./workbench.css";

type CostBps = 0 | 5;

function PreviewAccess({ onAccepted }: { onAccepted: (token: string) => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const candidate = token.trim();
    if (!candidate) return;
    setChecking(true);
    setError(null);
    try {
      await new WorkbenchApiClient(candidate).getCapabilities();
      window.sessionStorage.setItem(WORKBENCH_SESSION_TOKEN_KEY, candidate);
      onAccepted(candidate);
    } catch (caught) {
      const safe = safeUiError(caught);
      setError(`${safe.message} ${safe.nextAction}`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <main className="workbench-access-shell">
      <section className="workbench-access-panel" aria-labelledby="preview-access-title">
        <div className="workbench-mark">AL</div>
        <p className="workbench-eyebrow">Allocation Lab owner preview</p>
        <h1 id="preview-access-title">Market Exposure Research Workbench</h1>
        <p>Enter the owner preview token to access the executable research service.</p>
        <form onSubmit={submit} className="workbench-access-form">
          <label htmlFor="workbench-preview-token">Preview token</label>
          <Input
            id="workbench-preview-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            aria-describedby={error ? "preview-access-error" : undefined}
          />
          {error && <p id="preview-access-error" className="workbench-error-text" role="alert">{error}</p>}
          <Button type="submit" size="lg" disabled={!token.trim() || checking}>
            {checking ? "Checking access…" : "OPEN WORKBENCH"}
          </Button>
        </form>
        <p className="workbench-fine-print">The token stays in this browser tab only and is sent as a bearer credential to Workbench API requests.</p>
      </section>
    </main>
  );
}
function BoundaryHeader({ onSignOut }: { onSignOut: () => void }) {
  return (
    <header className="workbench-header">
      <div>
        <p className="workbench-eyebrow">Allocation Lab · Owner research preview</p>
        <h1>Market Exposure Research Workbench</h1>
        <p className="workbench-lede">Run the certified SPY market-exposure research campaign and compare the effect of explicit transaction-cost assumptions.</p>
      </div>
      <Button variant="outline" size="sm" onClick={onSignOut}>END PREVIEW SESSION</Button>
      <div className="workbench-boundaries" aria-label="Research boundaries">
        <Badge variant="outline">RESEARCH ONLY</Badge>
        <Badge variant="outline">TEMPORARY STORAGE</Badge>
        <Badge variant="outline">DATA VINTAGE NOT INDEPENDENTLY VERIFIED</Badge>
        <details>
          <summary>What these labels mean</summary>
          <p>This service runs historical research only. Its filesystem history may disappear when the preview restarts. Training and out-of-sample cutoffs are enforced, while historical vendor data vintages have not been independently verified.</p>
          <code>{WORKBENCH_RESEARCH_BOUNDARY}</code>
          <code>{WORKBENCH_STORAGE_CLASSIFICATION}</code>
          <code>{WORKBENCH_PIT_CLASSIFICATION}</code>
        </details>
      </div>
    </header>
  );
}

const stages = ["Configure", "Run / Status", "Results", "Compare"];

function StepIndicator({ active }: { active: number }) {
  return (
    <nav className="workbench-steps" aria-label="Workbench stages">
      {stages.map((stage, index) => (
        <div className={index <= active ? "is-active" : ""} key={stage}>
          <span>{index + 1}</span><strong>{stage}</strong>{index < stages.length - 1 && <ChevronRight aria-hidden="true" />}
        </div>
      ))}
    </nav>
  );
}

function ConfigurePanel({
  capabilities,
  selectedCost,
  onCostChange,
  onRun,
  busy,
  executionEnabled,
  hasRun,
}: {
  capabilities: WorkbenchCapabilities;
  selectedCost: CostBps;
  onCostChange: (cost: CostBps) => void;
  onRun: (cost: CostBps) => void;
  busy: boolean;
  executionEnabled: boolean;
  hasRun: boolean;
}) {
  const snapshot = capabilities.data_coverage.snapshot_id;
  const fixed = [
    ["Research", "Market exposure"],
    ["Universe", String(capabilityFixedValue(capabilities, "universe"))],
    ["Execution", "Historical empirical research"],
    ["Validation", "Traditional walk-forward"],
    ["Research window", `${capabilities.data_coverage.configured_research_start} to ${capabilities.data_coverage.configured_research_end_exclusive} (end exclusive)`],
    ["Rebalance", String(capabilityFixedValue(capabilities, "rebalance_frequency"))],
    ["Data snapshot", shortIdentifier(snapshot, 22)],
  ];
  const other = selectedCost === 0 ? 5 : 0;
  return (
    <section className="workbench-panel" id="configure" aria-labelledby="configure-title">
      <div className="workbench-section-heading"><span>01</span><div><p>CONFIGURE</p><h2 id="configure-title">What are you about to run?</h2></div></div>
      <dl className="workbench-context-grid">
        {fixed.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <fieldset className="workbench-cost-fieldset">
        <legend>Estimated transaction cost</legend>
        <div className="workbench-cost-options">
          {([0, 5] as const).map((cost) => (
            <label className={selectedCost === cost ? "is-selected" : ""} key={cost}>
              <input type="radio" name="transaction-cost" value={cost} checked={selectedCost === cost} onChange={() => onCostChange(cost)} />
              <span><strong>{cost} bps</strong><small>{cost === 0 ? "Gross research result before simulated trading costs" : "Five basis points per actual traded notional"}</small></span>
            </label>
          ))}
        </div>
        <p className="workbench-field-help">At 5 bps, the certified engine subtracts five basis points per actual traded notional. This is a research assumption, not a broker fee.</p>
      </fieldset>
      <div className="workbench-actions">
        <Button size="lg" onClick={() => onRun(selectedCost)} disabled={!executionEnabled || busy}>
          {busy ? "SUBMITTING…" : "RUN RESEARCH"}
        </Button>
        {hasRun && <Button variant="outline" onClick={() => onRun(other)} disabled={!executionEnabled || busy}>RUN OTHER COST SCENARIO</Button>}
      </div>
    </section>
  );
}

function ErrorNotice({ error }: { error: unknown }) {
  const safe = safeUiError(error);
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden="true" />
      <AlertTitle>{safe.title}</AlertTitle>
      <AlertDescription><p>{safe.message}</p><p>{safe.nextAction}</p><code>{safe.code}</code></AlertDescription>
    </Alert>
  );
}

function StatusPanel({
  detail,
  cost,
  timedOut,
  onRefresh,
  onRerun,
  rerunning,
}: {
  detail?: WorkbenchRunDetail;
  cost: CostBps;
  timedOut: boolean;
  onRefresh: () => void;
  onRerun: () => void;
  rerunning: boolean;
}) {
  const status = detail?.latest_status;
  const blocker = detail?.blockers.find((item) => item && typeof item === "object") as { code?: string; owner_recovery?: string } | undefined;
  const capacity = blocker?.code === "BLOCKED_EXECUTION_CAPACITY";
  return (
    <section className="workbench-panel" id="run-status" aria-labelledby="status-title" aria-live="polite">
      <div className="workbench-section-heading"><span>02</span><div><p>RUN / STATUS</p><h2 id="status-title">Actual execution status</h2></div></div>
      {!detail ? <div className="workbench-empty"><Clock3 /><p>No experiment has been submitted in this session.</p></div> : <>
        <div className={`workbench-status workbench-status-${status?.toLowerCase()}`}>
          {(status === "PENDING" || status === "RUNNING") && <span className="workbench-activity" aria-hidden="true" />}
          {status === "SUCCESS" && <CheckCircle2 aria-hidden="true" />}
          {(status === "FAILED" || status === "BLOCKED") && <AlertCircle aria-hidden="true" />}
          <div><strong>{status ? STATUS_LABELS[status] : "Status unavailable"}</strong><small>{status}</small></div>
        </div>
        <dl className="workbench-status-context">
          <div><dt>Cost assumption</dt><dd>{cost} bps</dd></div>
          <div><dt>Current stage</dt><dd>{detail.latest_attempt?.stage ?? "Not available"}</dd></div>
        </dl>
        {capacity && <Alert><AlertCircle /><AlertTitle>Research worker is occupied</AlertTitle><AlertDescription>Another empirical run is currently using the available research worker. This page will not retry automatically.</AlertDescription></Alert>}
        {blocker?.owner_recovery && <Alert variant="destructive"><AlertTitle>Owner recovery required</AlertTitle><AlertDescription>{blocker.owner_recovery}</AlertDescription></Alert>}
        {detail.latest_status === "FAILED" && <Alert variant="destructive"><AlertTitle>The latest attempt failed</AlertTitle><AlertDescription>{currentResult(detail)?.error_message ?? detail.latest_attempt?.error_message ?? "The service preserved safe failure evidence."}</AlertDescription></Alert>}
        {timedOut && <Alert><Clock3 /><AlertTitle>Status polling paused</AlertTitle><AlertDescription>The bounded five-minute UI polling window ended. The server may still be running; refresh status manually.</AlertDescription></Alert>}
        <div className="workbench-actions">
          {(timedOut || capacity || detail.latest_status === "FAILED" || detail.latest_status === "BLOCKED") && <Button variant="outline" onClick={onRefresh}><RefreshCw /> REFRESH STATUS</Button>}
          {detail.attempt_history.length > 0 && <Button variant="outline" onClick={onRerun} disabled={rerunning || detail.latest_status === "RUNNING" || detail.latest_status === "PENDING"}>RERUN SAME CONFIGURATION</Button>}
        </div>
        <p className="workbench-field-help">A rerun creates a new immutable execution attempt under the same experiment identity. It does not overwrite earlier evidence.</p>
        <details className="workbench-audit" open={ADVANCED_DETAILS_DEFAULT_OPEN}>
          <summary>Advanced audit details</summary>
          <dl><div><dt>run_id</dt><dd><code>{detail.run_id}</code></dd></div><div><dt>execution_attempt_id</dt><dd><code>{detail.latest_attempt?.execution_attempt_id ?? "NOT_SUPPORTED"}</code></dd></div></dl>
        </details>
      </>}
    </section>
  );
}

function ResearchIndexChart({ points, label = "Research index" }: { points: ResearchIndexPoint[]; label?: string }) {
  if (points.length === 0) return <div className="workbench-chart-empty">The API did not return an available research-index series for this result.</div>;
  return (
    <div className="workbench-chart" role="img" aria-label="Out-of-sample research index through time">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 12, right: 18, bottom: 12, left: 2 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#d9e2ea" />
          <XAxis dataKey="date" minTickGap={44} tick={{ fontSize: 12, fill: "#526271" }} tickFormatter={(value) => String(value).slice(0, 7)} />
          <YAxis width={48} tick={{ fontSize: 12, fill: "#526271" }} domain={["auto", "auto"]} />
          <ChartTooltip formatter={(value) => [typeof value === "number" ? value.toFixed(6) : value, label]} labelFormatter={(value) => `Date: ${value}`} />
          <Line type="linear" dataKey="index" name={label} stroke="#0f766e" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function AttemptHistory({ detail }: { detail: WorkbenchRunDetail }) {
  const latestSuccessfulId = typeof detail.latest_successful_result === "string" ? null : detail.latest_successful_result.execution_attempt_id;
  return (
    <div className="workbench-subsection">
      <h3>Immutable attempt history</h3>
      <div className="workbench-table-scroll">
        <Table>
          <TableHeader><TableRow><TableHead>Attempt</TableHead><TableHead>Status</TableHead><TableHead>Requested</TableHead><TableHead>Started</TableHead><TableHead>Completed</TableHead><TableHead>Evidence</TableHead></TableRow></TableHeader>
          <TableBody>{detail.attempt_history.map((attempt, index) => (
            <TableRow key={attempt.execution_attempt_id}>
              <TableCell>#{index + 1} {attempt.source === "RERUN" ? "Rerun" : "Initial"}</TableCell>
              <TableCell>{STATUS_LABELS[attempt.status]}<br /><code>{attempt.status}</code>{attempt.execution_attempt_id === latestSuccessfulId && <Badge variant="outline">Latest successful</Badge>}</TableCell>
              <TableCell>{formatTimestamp(attempt.requested_at)}</TableCell><TableCell>{formatTimestamp(attempt.started_at)}</TableCell><TableCell>{formatTimestamp(attempt.completed_at)}</TableCell>
              <TableCell><details className="workbench-inline-audit"><summary>Audit</summary><code>{attempt.execution_attempt_id}</code><span>Financial hash</span><code>{attemptFinancialHash(attempt, detail)}</code>{attempt.error_message && <span>{attempt.error_message}</span>}{attempt.blocker != null && <code>{JSON.stringify(attempt.blocker)}</code>}</details></TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </div>
    </div>
  );
}

function ResultsPanel({ detail }: { detail?: WorkbenchRunDetail }) {
  const result = successfulResult(detail);
  const summary = primaryResultSummary(result);
  const points = researchIndexPoints(result);
  const rows = walkForwardRows(result);
  return (
    <section className="workbench-panel workbench-results" id="results" aria-labelledby="results-title">
      <div className="workbench-section-heading"><span>03</span><div><p>RESULTS</p><h2 id="results-title">Recalculated research result</h2></div></div>
      {!detail ? <div className="workbench-empty"><p>Run the supported experiment to inspect actual engine results.</p></div> : !summary || !result ? <div className="workbench-empty"><p>No successful result is available for this experiment yet.</p></div> : <>
        {detail.latest_status !== "SUCCESS" && <Alert variant="destructive"><AlertTitle>Latest attempt: {detail.latest_status}</AlertTitle><AlertDescription>An earlier successful result remains visible below. The newer failed or blocked attempt remains separately recorded.</AlertDescription></Alert>}
        <div className="workbench-result-summary">
          <div><span>Out-of-Sample Observations</span><strong>{summary.observations}</strong></div>
          <div><span>Final Research Index</span><strong>{formatResearchNumber(summary.finalResearchIndex, 6)}</strong></div>
          <div><span>Realized Simulated Cost</span><strong>{formatResearchNumber(summary.realizedSimulatedCost, 8)}</strong></div>
          <div><span>Transaction Cost Assumption</span><strong>{summary.transactionCostBps} bps</strong></div>
          <div><span>Research Status</span><strong>{STATUS_LABELS[summary.status]}</strong></div>
        </div>
        <div className="workbench-subsection"><h3>Out-of-sample research index through time</h3><ResearchIndexChart points={points} /></div>
        <div className="workbench-cost-note"><strong>Cost interpretation</strong><p>Transaction costs reduce the research index according to actual traded notional in the certified engine.</p><dl><div><dt>Cost assumption</dt><dd>{summary.transactionCostBps} bps</dd></div><div><dt>Realized simulated cost</dt><dd>{formatResearchNumber(summary.realizedSimulatedCost, 8)}</dd></div></dl></div>
        <div className="workbench-subsection"><h3>Walk-Forward Evidence</h3><p>The model is selected using historical training and validation windows and evaluated on subsequent out-of-sample observations. Historical data vintages have not been independently verified.</p><div className="workbench-table-scroll"><Table><TableHeader><TableRow><TableHead>Fold</TableHead><TableHead>Training interval</TableHead><TableHead>OOS interval</TableHead><TableHead>Selected candidate</TableHead><TableHead>Fit key</TableHead><TableHead>Observations</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.fold}><TableCell>{row.fold}</TableCell><TableCell>{row.trainingInterval}</TableCell><TableCell>{row.oosInterval}</TableCell><TableCell><code>{shortIdentifier(row.candidate, 14)}</code></TableCell><TableCell><code>{row.fitKeys.length ? shortIdentifier(row.fitKeys.join(", "), 14) : "NOT_SUPPORTED"}</code></TableCell><TableCell>{row.observationCount}</TableCell></TableRow>)}</TableBody></Table></div></div>
        <AttemptHistory detail={detail} />
        <details className="workbench-audit" open={ADVANCED_DETAILS_DEFAULT_OPEN}><summary>Advanced audit details</summary><div className="workbench-audit-grid"><div><span>run_id</span><code>{result.run_id}</code></div><div><span>execution_attempt_id</span><code>{result.execution_attempt_id}</code></div><div><span>financial-result hash</span><code>{result.financial_result_hash}</code></div><div><span>engine version</span><code>{String(result.provenance.engine_version ?? "NOT_SUPPORTED")}</code></div><div><span>certified backend commit</span><code>{String(result.provenance.certified_engine_commit ?? "NOT_SUPPORTED")}</code></div><div><span>adapter version</span><code>{String(result.provenance.adapter_version ?? "NOT_SUPPORTED")}</code></div></div>{result.warnings.length > 0 && <><h4>Warnings</h4><ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></>}</details>
      </>}
    </section>
  );
}

type ComparisonPayload = {
  comparison: Awaited<ReturnType<WorkbenchApiClient["compareRuns"]>>;
  left: WorkbenchRunDetail;
  right: WorkbenchRunDetail;
};

function OverlayChart({ payload }: { payload: ComparisonPayload }) {
  const leftPoints = researchIndexPoints(successfulResult(payload.left));
  const rightPoints = researchIndexPoints(successfulResult(payload.right));
  const rows = new Map<string, { date: string; A?: number; B?: number }>();
  for (const point of leftPoints) rows.set(point.date, { date: point.date, A: point.index });
  for (const point of rightPoints) rows.set(point.date, { ...(rows.get(point.date) ?? { date: point.date }), B: point.index });
  const data = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (data.length === 0) return <div className="workbench-chart-empty">Both successful run results must expose time series for an overlay.</div>;
  return <div className="workbench-chart" role="img" aria-label="Research-index comparison for experiments A and B"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 12, right: 18, bottom: 12, left: 2 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#d9e2ea" /><XAxis dataKey="date" minTickGap={44} tick={{ fontSize: 12 }} tickFormatter={(value) => String(value).slice(0, 7)} /><YAxis width={48} domain={["auto", "auto"]} tick={{ fontSize: 12 }} /><ChartTooltip formatter={(value, name) => [typeof value === "number" ? value.toFixed(6) : value, `Experiment ${name}`]} /><Line type="linear" dataKey="A" stroke="#173b57" strokeWidth={2} dot={false} isAnimationActive={false} /><Line type="linear" dataKey="B" stroke="#0f766e" strokeWidth={2} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>;
}

function ComparePanel({
  selected,
  payload,
  onCompare,
  comparing,
}: {
  selected: WorkbenchRunDetail[];
  payload?: ComparisonPayload;
  onCompare: () => void;
  comparing: boolean;
}) {
  const leftCost = selected[0]?.spec.transaction_cost_bps;
  const rightCost = selected[1]?.spec.transaction_cost_bps;
  return (
    <section className="workbench-panel" id="compare" aria-labelledby="compare-title">
      <div className="workbench-section-heading"><span>04</span><div><p>COMPARE</p><h2 id="compare-title">Compare Research Runs</h2></div></div>
      <div className="workbench-compare-selection"><div><span>Experiment A</span><strong>{leftCost === undefined ? "Select a successful run" : `${leftCost} bps`}</strong></div><div><span>Experiment B</span><strong>{rightCost === undefined ? "Select a second successful run" : `${rightCost} bps`}</strong></div></div>
      <Button onClick={onCompare} disabled={selected.length !== 2 || comparing}>{comparing ? "READING COMPARISON…" : "COMPARE SELECTED RUNS"}</Button>
      {payload && <div className="workbench-comparison"><OverlayChart payload={payload} /><div className="workbench-table-scroll"><Table><TableHeader><TableRow><TableHead>Reported difference</TableHead><TableHead>Value (B − A)</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>Exact configuration differences</TableCell><TableCell>{payload.comparison.spec_differences.map((item) => item.path).join(", ") || "None"}</TableCell></TableRow><TableRow><TableCell>Transaction-cost assumption</TableCell><TableCell>{formatResearchNumber(payload.comparison.transaction_cost_difference_bps)} bps</TableCell></TableRow><TableRow><TableCell>OOS observations</TableCell><TableCell>{payload.comparison.oos_observation_difference}</TableCell></TableRow><TableRow><TableCell>Final research index</TableCell><TableCell>{formatResearchNumber(payload.comparison.final_research_index_difference, 8)}</TableCell></TableRow><TableRow><TableCell>Realized simulated cost</TableCell><TableCell>{formatResearchNumber(payload.comparison.realized_cost_difference, 8)}</TableCell></TableRow></TableBody></Table></div><p className="workbench-neutral-note">This comparison reports mechanical differences only. It does not rank, recommend, or declare a winner.</p><details className="workbench-audit" open={ADVANCED_DETAILS_DEFAULT_OPEN}><summary>Advanced comparison audit details</summary><dl><div><dt>A financial-result hash</dt><dd><code>{payload.comparison.left.financial_result_hash}</code></dd></div><div><dt>B financial-result hash</dt><dd><code>{payload.comparison.right.financial_result_hash}</code></dd></div><div><dt>Calculation</dt><dd><code>{payload.comparison.calculation}</code></dd></div></dl>{payload.comparison.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details></div>}
    </section>
  );
}

function RunHistory({
  runs,
  selectedIds,
  onOpen,
  onToggleCompare,
}: {
  runs: WorkbenchRunDetail[];
  selectedIds: string[];
  onOpen: (run: WorkbenchRunDetail) => void;
  onToggleCompare: (run: WorkbenchRunDetail) => void;
}) {
  return <section className="workbench-panel workbench-history" aria-labelledby="history-title"><div className="workbench-section-heading is-secondary"><span>05</span><div><p>RUN HISTORY</p><h2 id="history-title">Temporary Run History</h2></div></div><p>This history may disappear when the preview service restarts.</p>{runs.length === 0 ? <div className="workbench-empty"><p>No temporary runs are available.</p></div> : <div className="workbench-table-scroll"><Table><TableHeader><TableRow><TableHead>Cost</TableHead><TableHead>Status</TableHead><TableHead>Final index</TableHead><TableHead>Realized cost</TableHead><TableHead>Latest attempt</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{runs.map((run) => { const result = successfulResult(run); const summary = primaryResultSummary(result); const selected = selectedIds.includes(run.run_id); return <TableRow key={run.run_id}><TableCell>{run.spec.transaction_cost_bps} bps</TableCell><TableCell>{run.latest_status ? STATUS_LABELS[run.latest_status] : "Not available"}</TableCell><TableCell>{summary ? formatResearchNumber(summary.finalResearchIndex, 6) : "NOT_SUPPORTED"}</TableCell><TableCell>{summary ? formatResearchNumber(summary.realizedSimulatedCost, 8) : "NOT_SUPPORTED"}</TableCell><TableCell>{formatTimestamp(run.latest_attempt?.requested_at ?? null)}</TableCell><TableCell><div className="workbench-table-actions"><Button variant="outline" size="sm" onClick={() => onOpen(run)}>OPEN</Button><Button variant={selected ? "secondary" : "outline"} size="sm" disabled={!summary} onClick={() => onToggleCompare(run)}>{selected ? "SELECTED" : "COMPARE"}</Button></div></TableCell></TableRow>; })}</TableBody></Table></div>}</section>;
}

function WorkbenchAuthenticated({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const client = useMemo(() => new WorkbenchApiClient(token), [token]);
  const queryClient = useQueryClient();
  const [selectedCost, setSelectedCost] = useState<CostBps>(0);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [pollingStartedAt, setPollingStartedAt] = useState<number | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const statusRef = useRef<HTMLDivElement>(null);

  const capabilitiesQuery = useQuery({ queryKey: ["workbench", "capabilities", token], queryFn: () => client.getCapabilities() });
  const contractProblems = useMemo(() => capabilitiesQuery.data ? validatePhaseB2Capabilities(capabilitiesQuery.data) : [], [capabilitiesQuery.data]);
  const contractReady = !!capabilitiesQuery.data && contractProblems.length === 0;

  const runQuery = useQuery({
    queryKey: ["workbench", "run", activeRunId, token],
    queryFn: () => client.getRun(activeRunId!),
    enabled: !!activeRunId && contractReady,
    refetchInterval: (query) => shouldPollRun(query.state.data, pollingStartedAt) ? WORKBENCH_POLL_INTERVAL_MS : false,
  });

  const historyQuery = useQuery({
    queryKey: ["workbench", "history", token],
    enabled: contractReady,
    queryFn: async () => {
      const listed = await client.listRuns();
      return Promise.all(listed.runs.slice(0, 12).map((run) => client.getRun(run.run_id)));
    },
  });

  useEffect(() => {
    if (runQuery.data && isTerminalStatus(runQuery.data.latest_status)) void historyQuery.refetch();
  }, [runQuery.data?.latest_status]);

  const acceptReceipt = (receipt: { run_id: string }) => {
    setActiveRunId(receipt.run_id);
    setPollingStartedAt(Date.now());
    void queryClient.invalidateQueries({ queryKey: ["workbench", "run", receipt.run_id] });
    window.setTimeout(() => statusRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  const submitMutation = useMutation({ mutationFn: (cost: CostBps) => client.submitRun(buildResearchRunSubmission(cost)), onSuccess: acceptReceipt });
  const rerunMutation = useMutation({ mutationFn: () => client.rerun(activeRunId!), onSuccess: acceptReceipt });
  const selectedRuns = (historyQuery.data ?? []).filter((run) => compareIds.includes(run.run_id)).sort((a, b) => compareIds.indexOf(a.run_id) - compareIds.indexOf(b.run_id));
  const compareMutation = useMutation({ mutationFn: async (): Promise<ComparisonPayload> => {
    const [left, right] = selectedRuns;
    if (!left || !right) throw new WorkbenchApiError(409, "COMPARE_REQUIRES_SUCCESS", "Select exactly two successful runs.");
    const comparison = await client.compareRuns(left.run_id, right.run_id);
    return { comparison, left, right };
  } });

  const toggleCompare = (run: WorkbenchRunDetail) => setCompareIds((current) => current.includes(run.run_id) ? current.filter((id) => id !== run.run_id) : current.length < 2 ? [...current, run.run_id] : [current[1], run.run_id]);
  const openRun = (run: WorkbenchRunDetail) => { setActiveRunId(run.run_id); setSelectedCost(run.spec.transaction_cost_bps); setPollingStartedAt(isTerminalStatus(run.latest_status) ? null : Date.now()); window.setTimeout(() => statusRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); };
  const activeDetail = runQuery.data ?? (historyQuery.data ?? []).find((run) => run.run_id === activeRunId);
  const timedOut = !!activeDetail && !isTerminalStatus(activeDetail.latest_status) && !shouldPollRun(activeDetail, pollingStartedAt);
  const executionBusy = submitMutation.isPending || rerunMutation.isPending || activeDetail?.latest_status === "PENDING" || activeDetail?.latest_status === "RUNNING";
  const activeStage = compareMutation.data ? 3 : successfulResult(activeDetail) ? 2 : activeDetail ? 1 : 0;
  const authError = [capabilitiesQuery.error, runQuery.error, historyQuery.error, submitMutation.error, rerunMutation.error, compareMutation.error].find(Boolean);

  useEffect(() => {
    if (authError instanceof WorkbenchApiError && authError.status === 401) onSignOut();
  }, [authError, onSignOut]);

  if (capabilitiesQuery.isPending) return <main className="workbench-loading"><span className="workbench-activity" /><p>Loading certified research capabilities…</p></main>;
  if (capabilitiesQuery.error) return <main className="workbench-shell"><BoundaryHeader onSignOut={onSignOut} /><ErrorNotice error={capabilitiesQuery.error} /></main>;

  return (
    <main className="workbench-shell">
      <BoundaryHeader onSignOut={onSignOut} />
      <StepIndicator active={activeStage} />
      {contractProblems.length > 0 && <Alert variant="destructive"><AlertCircle /><AlertTitle>Capability contract mismatch</AlertTitle><AlertDescription><code>CAPABILITY_CONTRACT_MISMATCH</code><p>Execution is disabled because these capabilities differ: {contractProblems.join(", ")}.</p></AlertDescription></Alert>}
      {authError && !(authError instanceof WorkbenchApiError && authError.status === 401) && <ErrorNotice error={authError} />}
      <div className="workbench-stage-grid"><ConfigurePanel capabilities={capabilitiesQuery.data!} selectedCost={selectedCost} onCostChange={setSelectedCost} onRun={(cost) => submitMutation.mutate(cost)} busy={executionBusy} executionEnabled={contractReady} hasRun={!!activeRunId} /><div ref={statusRef}><StatusPanel detail={activeDetail} cost={activeDetail?.spec.transaction_cost_bps ?? selectedCost} timedOut={timedOut} onRefresh={() => { setPollingStartedAt(Date.now()); void runQuery.refetch(); }} onRerun={() => rerunMutation.mutate()} rerunning={rerunMutation.isPending} /></div></div>
      <ResultsPanel detail={activeDetail} />
      <ComparePanel selected={selectedRuns} payload={compareMutation.data} onCompare={() => compareMutation.mutate()} comparing={compareMutation.isPending} />
      <RunHistory runs={historyQuery.data ?? []} selectedIds={compareIds} onOpen={openRun} onToggleCompare={toggleCompare} />
      <section className="workbench-unavailable"><h2>Not available in this version</h2><p>Other universes, editable dates, benchmarks, nested walk-forward, allocation modes, signals, optimizers, broker connectivity, orders, and capital authorization are outside this Workbench.</p><details><summary>Backend blocker details</summary><ul>{capabilitiesQuery.data!.blocked_modes.map((blocked) => <li key={blocked.mode}><strong>{blocked.mode}</strong> — <code>{blocked.blocker_code}</code>: {blocked.human_explanation}</li>)}</ul></details></section>
    </main>
  );
}

export default function WorkbenchPage() {
  const [token, setToken] = useState<string | null>(() => typeof window === "undefined" ? null : window.sessionStorage.getItem(WORKBENCH_SESSION_TOKEN_KEY));
  const signOut = () => { window.sessionStorage.removeItem(WORKBENCH_SESSION_TOKEN_KEY); setToken(null); };
  return token ? <WorkbenchAuthenticated token={token} onSignOut={signOut} /> : <PreviewAccess onAccepted={setToken} />;
}
