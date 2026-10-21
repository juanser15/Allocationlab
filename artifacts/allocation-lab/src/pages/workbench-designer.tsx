import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  WORKBENCH_SESSION_TOKEN_KEY,
  WorkbenchApiError,
  type ResearchIndexPoint,
} from "@/lib/workbench-api";
import {
  formatResearchNumber as number,
  formatTimestamp,
  STATUS_LABELS,
  WORKBENCH_UI_POLL_TIMEOUT_MS,
} from "@/lib/workbench-state";
import {
  DESIGN_FIELDS,
  DesignerApiError,
  WorkbenchV2Client,
  capabilityProblemsV2,
  type CapabilitiesV2,
  type ComparisonV2,
  type DetailV2,
  type FoldV2,
  type PlanV2,
  type ReceiptV2,
  type ResultV2,
  type SubmissionV2,
} from "@/lib/workbench-v2-api";
import {
  FIELD_LABELS,
  canRunPlan,
  derivedTiming,
  emptyDesign,
  executionMatchesPlan,
  foldGeometry,
  latestSuccess,
  planMatchesRequest,
  readDesign,
  temporallyComparable,
  type DesignForm,
  type ExpectedPlanV2,
} from "@/lib/workbench-designer-state";
import "./workbench.css";
import "./workbench-designer.css";

const terminal = (s: string | null | undefined) =>
  ["SUCCESS", "FAILED", "BLOCKED"].includes(s ?? "");
const points = (r?: ResultV2): ResearchIndexPoint[] =>
  r && typeof r.time_series !== "string" ? r.time_series.points : [];
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const monthLabel = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;

function Access({ accept }: { accept: (token: string) => void }) {
  const [token, setToken] = useState("");
  const mutation = useMutation({
    mutationFn: async () => {
      await new WorkbenchV2Client(token.trim()).getCapabilities();
      sessionStorage.setItem(WORKBENCH_SESSION_TOKEN_KEY, token.trim());
      accept(token.trim());
    },
  });
  return (
    <main className="workbench-access-shell">
      <section className="workbench-access-panel">
        <div className="workbench-mark">AL</div>
        <p className="workbench-eyebrow">Allocation Lab · Owner preview</p>
        <h1>Walk-Forward Research Designer</h1>
        <p>
          Enter your preview token to design and run historical market-exposure
          research.
        </p>
        <form
          className="workbench-access-form"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <label htmlFor="preview-token">Preview token</label>
          <Input
            id="preview-token"
            type="password"
            value={token}
            autoComplete="off"
            onChange={(e) => setToken(e.target.value)}
          />
          <Button size="lg" disabled={!token.trim() || mutation.isPending}>
            {mutation.isPending ? "CHECKING ACCESS…" : "OPEN WORKBENCH"}
          </Button>
        </form>
        {mutation.error && <ErrorNotice error={mutation.error} />}
        <p className="workbench-fine-print">
          Preview access only. The token stays in this browser tab's session
          storage.
        </p>
      </section>
    </main>
  );
}
function Header({ signOut }: { signOut: () => void }) {
  return (
    <header className="workbench-header">
      <div>
        <p className="workbench-eyebrow">Allocation Lab · Empirical research</p>
        <h1>Walk-Forward Research Designer</h1>
        <p className="workbench-lede">
          What research design do you want to test? Define the evaluation
          period, review the exact folds, then run the SPY market-exposure
          model.
        </p>
      </div>
      <Button variant="outline" onClick={signOut}>
        END PREVIEW SESSION
      </Button>
      <div className="workbench-boundaries">
        <span className="wd-badge">RESEARCH ONLY</span>
        <span className="wd-badge">TEMPORARY STORAGE</span>
        <span className="wd-badge">
          DATA VINTAGE NOT INDEPENDENTLY VERIFIED
        </span>
        <details>
          <summary>Research limitations</summary>
          <p>
            Information cutoffs are enforced. Historical vendor data vintages
            have not been independently verified. Each fold uses an independent
            sleeve; the compounded research index does not represent a
            carried-holdings account. History may disappear when the preview
            restarts.
          </p>
          <code>RESEARCH_ONLY</code>
          <code>TEMPORARY_RESEARCH_STORAGE</code>
          <code>PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED</code>
        </details>
      </div>
    </header>
  );
}
const recovery: Record<string, string> = {
  INSUFFICIENT_TRAINING_HISTORY:
    "Choose dates with enough preceding training history or explicitly revise the training window. Nothing has been extended automatically.",
  INSUFFICIENT_MODEL_WARMUP_HISTORY:
    "Choose a design with complete information-universe history before training. Warmup is separate from training; no dates have been moved.",
  INCOMPLETE_EVALUATION_FOLDS:
    "Choose an end-exclusive boundary that completes every selected rebalance period.",
  INVALID_QUARTER_BOUNDARY:
    "Use calendar-quarter starts. The designer will not snap dates automatically.",
  EVALUATION_BEYOND_DATA_RANGE:
    "Choose an end-exclusive boundary within the available dataset.",
  BLOCKED_EXECUTION_CAPACITY:
    "Another empirical run is using the research worker. Refresh status after it completes. No automatic retry will occur.",
  PLAN_EXECUTION_MISMATCH:
    "Execution evidence differs from the reviewed plan. Results are withheld; ask the owner to inspect the preserved attempt.",
};
function ErrorNotice({ error }: { error: unknown }) {
  const e =
    error instanceof WorkbenchApiError
      ? error
      : new WorkbenchApiError(
          500,
          "WORKBENCH_REQUEST_FAILED",
          "The request could not be completed.",
        );
  const issues =
    error instanceof DesignerApiError &&
    error.issues &&
    typeof error.issues === "object"
      ? (error.issues as Record<string, unknown>)
      : {};
  const safeKeys = [
    "fold_id",
    "requested_training_window_months",
    "training_start",
    "available_observations",
    "model_fit_requirement_observations",
    "selection_requirement_observations",
    "warmup_requirement_observations",
    "available_warmup_observations",
    "training_observations",
    "data_first_observation",
    "supported_evaluation_end_max",
    "estimated_jobs",
    "maximum_jobs",
  ];
  const detail = safeKeys.filter(
    (k) =>
      typeof issues[k] === "number" ||
      (typeof issues[k] === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(String(issues[k]))),
  );
  return (
    <div className="wd-error" role="alert">
      <strong>
        {e.status === 401
          ? "Preview access denied"
          : "Research request blocked"}
      </strong>
      <p>{e.message}</p>
      <p>
        {recovery[e.code] ??
          (e.status === 401
            ? "Enter the owner preview token again."
            : e.status === 429
              ? "Refresh status. Do not submit repeatedly; there is no automatic retry."
              : "Review the requested design and the dataset rules, then try again. No input was changed automatically.")}
      </p>
      <code>{e.code}</code>
      {detail.length > 0 && (
        <dl className="wd-facts">
          {detail.map((k) => (
            <div key={k}>
              <dt>{k.replaceAll("_", " ")}</dt>
              <dd>{String(issues[k])}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
function Section({
  id,
  step,
  title,
  children,
}: {
  id: string;
  step: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      className="workbench-panel"
      id={id}
      aria-labelledby={`${id}-title`}
    >
      <div className="workbench-section-heading">
        <span>{step}</span>
        <div>
          <p>{id.replaceAll("-", " ").toUpperCase()}</p>
          <h2 id={`${id}-title`}>{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}
function Facts({ entries }: { entries: Array<[string, ReactNode]> }) {
  return (
    <dl className="wd-facts">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
function DatasetRules({ c }: { c: CapabilitiesV2 }) {
  return (
    <div className="wd-data-rules">
      <h3>Available empirical data</h3>
      <Facts
        entries={[
          ["First observation", c.data_first_observation],
          ["Last observation", c.data_last_observation],
          [
            "Earliest evaluation boundary (conditional)",
            c.supported_evaluation_start_min,
          ],
          [
            "Latest evaluation boundary (exclusive)",
            c.supported_evaluation_end_max,
          ],
          ["Window types", c.supported_window_types.map(label).join(", ")],
          [
            "Rebalance frequencies",
            c.supported_rebalance_frequencies.map(label).join(", "),
          ],
        ]}
      />
      <p>{c.evaluation_start_min_rule}</p>
      <p>
        {c.date_rules.month_start_required
          ? "Use month-start boundaries. "
          : ""}
        {c.date_rules.quarterly_start === "CALENDAR_QUARTER_START"
          ? "Quarterly designs use calendar-quarter starts. "
          : ""}
        Only complete folds are accepted. Dates are never moved automatically.
      </p>
      <p>
        Training: positive integer months, up to{" "}
        {c.training_window_rules.maximum_months}; at least{" "}
        {c.training_window_rules.minimum_training_observations} training
        observations. The current model fit is{" "}
        {c.training_window_rules.model_fit.toLowerCase()}. Candidate-score
        eligibility is checked by the engine.
      </p>
      <p>
        Model warmup:{" "}
        {c.training_window_rules.model_warmup_observations_before_training}{" "}
        complete observations before training, separate from your training
        window.
      </p>
      <p>
        Both costs are required finite values ≥{" "}
        {c.transaction_cost_rules.minimum} bps, without rounding. They have
        separate economic meanings.
      </p>
      <p>
        One research worker · up to {c.resource_limits.max_jobs} estimated jobs
        · {c.resource_limits.timeout_ms / 1000}s execution bound.
      </p>
    </div>
  );
}
const help: Record<keyof DesignForm, string> = {
  evaluation_start:
    "First period evaluated after training. Training history comes before this date.",
  evaluation_end_exclusive: "Exclusive boundary: this date is not evaluated.",
  window_type:
    "Rolling keeps a constant training length. Expanding keeps its initial start while history grows.",
  training_window_months:
    "Historical information before each decision date; initial history for expanding designs.",
  rebalance_frequency:
    "Each rebalance starts a new OOS fold and recalibrates/reselects the model.",
  transaction_cost_bps:
    "Cost applied to the selected strategy during out-of-sample evaluation.",
  selection_cost_bps:
    "Cost assumption used when ranking candidates during training.",
};
function DesignInputs({
  form,
  c,
  change,
}: {
  form: DesignForm;
  c: CapabilitiesV2;
  change: (key: keyof DesignForm, value: string) => void;
}) {
  return (
    <div className="wd-form-grid">
      {DESIGN_FIELDS.map((key) => {
        const options =
          key === "window_type"
            ? c.supported_window_types
            : key === "rebalance_frequency"
              ? c.supported_rebalance_frequencies
              : undefined;
        const isDate = key.startsWith("evaluation_");
        return (
          <div
            className={`wd-field ${key === "rebalance_frequency" ? "wd-wide" : ""}`}
            key={key}
          >
            <label htmlFor={key}>
              {FIELD_LABELS[key]}
              {key.endsWith("_bps")
                ? " (bps)"
                : key === "training_window_months"
                  ? " (months)"
                  : key === "evaluation_end_exclusive"
                    ? " (exclusive)"
                    : ""}
            </label>
            {options ? (
              <select
                id={key}
                value={form[key]}
                onChange={(e) => change(key, e.target.value)}
                aria-describedby={`${key}-help`}
                required
              >
                <option value="">
                  Choose{" "}
                  {key === "window_type" ? "a window type" : "a frequency"}
                </option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {label(o)}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={key}
                type={isDate ? "date" : "number"}
                value={form[key]}
                onChange={(e) => change(key, e.target.value)}
                required
                {...(isDate
                  ? {
                      min: c.supported_evaluation_start_min,
                      max: c.supported_evaluation_end_max,
                    }
                  : key === "training_window_months"
                    ? {
                        min: 1,
                        max: c.training_window_rules.maximum_months,
                        step: 1,
                      }
                    : { min: c.transaction_cost_rules.minimum, step: "any" })}
                aria-describedby={`${key}-help`}
              />
            )}
            <p id={`${key}-help`}>{help[key]}</p>
          </div>
        );
      })}
    </div>
  );
}
export function FoldMap({ folds }: { folds: FoldV2[] }) {
  const geometry = foldGeometry(folds);
  const first = Date.parse(folds[0].training_start),
    last = Date.parse(folds.at(-1)!.oos_end_exclusive);
  const axisX = (d: string) =>
    115 + ((Date.parse(d) - first) / (last - first)) * 980;
  const candidates = [
    ...new Set(
      folds.flatMap((f) => [
        f.training_start,
        f.oos_start,
        f.oos_end_exclusive,
      ]),
    ),
  ].sort();
  const axisDates = candidates
    .filter(
      (d, i) =>
        i === 0 ||
        i === candidates.length - 1 ||
        (axisX(d) - axisX(candidates[0]) > 150 &&
          axisX(candidates.at(-1)!) - axisX(d) > 150),
    )
    .filter(
      (d, i, a) =>
        i === 0 || i === a.length - 1 || axisX(d) - axisX(a[i - 1]) > 150,
    );
  return (
    <div className="wd-fold-map">
      <div className="wd-legend">
        <span>
          <i className="wd-training-key" /> Training
        </span>
        <span>
          <i className="wd-oos-key" /> Out-of-sample
        </span>
        <span>│ Decision / rebalance date</span>
      </div>
      <p className="wd-muted">
        Exact backend intervals; blocks use a common time scale. Scroll to
        inspect every fold.
      </p>
      <div
        className="wd-map-scroll"
        tabIndex={0}
        aria-label="Scrollable exact walk-forward fold map"
      >
        <svg
          viewBox={`0 0 1135 ${folds.length * 55 + 80}`}
          width="1135"
          height={folds.length * 55 + 80}
          role="img"
          aria-label="Training and out-of-sample intervals by fold"
        >
          <line x1="115" x2="1095" y1="32" y2="32" stroke="#9aaebc" />
          {axisDates.map((d, i, a) => {
            return (
              <g key={d}>
                <line
                  x1={115 + ((Date.parse(d) - first) / (last - first)) * 980}
                  x2={115 + ((Date.parse(d) - first) / (last - first)) * 980}
                  y1="27"
                  y2="37"
                  stroke="#6a8294"
                />
                <text
                  x={115 + ((Date.parse(d) - first) / (last - first)) * 980}
                  y="20"
                  textAnchor={
                    i === 0 ? "start" : i === a.length - 1 ? "end" : "middle"
                  }
                  fill="#41576a"
                  fontSize="13"
                >
                  {d}
                </text>
              </g>
            );
          })}
          {geometry.map(
            (
              { fold: f, trainingX, trainingWidth, oosX, oosWidth, decisionX },
              i,
            ) => (
              <g key={f.fold_id} data-fold={f.fold_id}>
                <text x="16" y={i * 55 + 67} fill="#183c55" fontSize="14">
                  Fold {f.fold_id}
                </text>
                <rect
                  data-kind="training"
                  data-start={f.training_start}
                  data-end={f.training_end_exclusive}
                  x={trainingX}
                  y={i * 55 + 49}
                  width={trainingWidth}
                  height="28"
                  fill="#dae5ee"
                  stroke="#617e94"
                >
                  <title>
                    Training [{f.training_start}, {f.training_end_exclusive})
                  </title>
                </rect>
                {trainingWidth > 90 && (
                  <text
                    x={trainingX + 12}
                    y={i * 55 + 68}
                    fill="#274a64"
                    fontSize="12"
                  >
                    TRAINING
                  </text>
                )}
                <rect
                  data-kind="oos"
                  data-start={f.oos_start}
                  data-end={f.oos_end_exclusive}
                  x={oosX}
                  y={i * 55 + 49}
                  width={oosWidth}
                  height="28"
                  fill="#147d78"
                >
                  <title>
                    OOS [{f.oos_start}, {f.oos_end_exclusive})
                  </title>
                </rect>
                {oosWidth > 30 && (
                  <text
                    x={oosX + oosWidth / 2}
                    y={i * 55 + 68}
                    textAnchor="middle"
                    fill="#fff"
                    fontSize="12"
                  >
                    OOS
                  </text>
                )}
                <line
                  x1={decisionX}
                  x2={decisionX}
                  y1={i * 55 + 42}
                  y2={i * 55 + 84}
                  stroke="#112f44"
                  strokeWidth="2"
                >
                  <title>
                    Decision {f.decision_date}; information cutoff{" "}
                    {f.information_cutoff}
                  </title>
                </line>
              </g>
            ),
          )}
        </svg>
      </div>
    </div>
  );
}
function FoldTable({ folds }: { folds: FoldV2[] }) {
  return (
    <div className="wd-table-scroll" tabIndex={0}>
      <table>
        <caption>Exact fold plan · interval ends are exclusive</caption>
        <thead>
          <tr>
            {[
              "Fold",
              "Training start",
              "Training end exclusive",
              "Information cutoff",
              "Decision date",
              "OOS start",
              "OOS end exclusive",
              "Training observations",
              "Warmup observations*",
              "OOS observations",
            ].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {folds.map((f) => (
            <tr key={f.fold_id}>
              {[
                f.fold_id,
                f.training_start,
                f.training_end_exclusive,
                f.information_cutoff,
                f.decision_date,
                f.oos_start,
                f.oos_end_exclusive,
                f.training_observations,
                f.warmup_observations,
                f.oos_observations,
              ].map((v, i) => (
                <td key={i}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function DesignSummary({
  spec,
  count,
}: {
  spec: SubmissionV2;
  count?: number;
}) {
  return (
    <Facts
      entries={[
        [
          "OOS evaluation (end exclusive)",
          `${spec.evaluation_start} → ${spec.evaluation_end_exclusive}`,
        ],
        ["Walk-forward type", label(spec.window_type)],
        ["Training window", monthLabel(spec.training_window_months)],
        ["Rebalance", label(spec.rebalance_frequency)],
        ["OOS cost", `${spec.transaction_cost_bps} bps`],
        ["Model-selection cost", `${spec.selection_cost_bps} bps`],
        ...(count === undefined
          ? []
          : [["Fold count", count] as [string, ReactNode]]),
      ]}
    />
  );
}
function IndexChart({
  a,
  b,
  folds,
}: {
  a: ResearchIndexPoint[];
  b?: ResearchIndexPoint[];
  folds?: FoldV2[];
}) {
  if (!a.length || (b && !b.length))
    return (
      <p className="workbench-empty">
        The API did not return an index series for this result.
      </p>
    );
  const chart = new Map(
    a.map((p) => [
      p.date,
      { date: p.date, A: p.index, B: undefined as number | undefined },
    ]),
  );
  b?.forEach((p) => {
    const row = chart.get(p.date) ?? {
      date: p.date,
      A: undefined as unknown as number,
      B: undefined,
    };
    chart.set(p.date, { ...row, B: p.index });
  });
  return (
    <div
      className="workbench-chart"
      role="img"
      aria-label={
        b
          ? "Overlay of actual OOS index series A and B"
          : "Actual OOS research index through time"
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={[...chart.values()].sort((x, y) =>
            x.date.localeCompare(y.date),
          )}
          margin={{ top: 18, right: 18, bottom: 10, left: 0 }}
        >
          <CartesianGrid vertical={false} stroke="#e1e7ec" />
          <XAxis
            dataKey="date"
            minTickGap={45}
            tick={{ fontSize: 12 }}
            tickFormatter={(d) => String(d).slice(0, 7)}
          />
          <YAxis domain={["auto", "auto"]} width={52} tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(v, n) => [String(v), n]}
            labelFormatter={(d) => `Date: ${d}`}
          />
          {folds
            ?.filter((f) => a.some((p) => p.date === f.decision_date))
            .map((f) => (
              <ReferenceLine
                key={f.fold_id}
                x={f.decision_date}
                stroke="#c1ccd5"
                strokeDasharray="3 3"
              />
            ))}
          <Line
            dataKey="A"
            name={b ? "A" : "Research index"}
            type="linear"
            stroke="#173b57"
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
            strokeWidth={2}
          />
          {b && (
            <Line
              dataKey="B"
              name="B"
              type="linear"
              stroke="#147d78"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
              strokeWidth={2}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
function Audit({
  children,
  title = "Advanced audit details",
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <details className="workbench-audit">
      <summary>{title}</summary>
      {children}
    </details>
  );
}
function Attempts({ detail }: { detail: DetailV2 }) {
  return (
    <div className="wd-attempts">
      <h3>Immutable attempt history</h3>
      <div className="wd-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Attempt</th>
              <th>Status</th>
              <th>Requested</th>
              <th>Completed</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {detail.attempt_history.map((a, i) => (
              <tr key={a.execution_attempt_id}>
                <td>
                  #{i + 1} {a.source === "RERUN" ? "Rerun" : "Initial"}
                </td>
                <td>
                  {STATUS_LABELS[a.status]} <small>{a.status}</small>
                  {latestSuccess(detail)?.execution_attempt_id ===
                    a.execution_attempt_id && <small>Latest successful</small>}
                  {a.error_message && <p>{a.error_message}</p>}
                </td>
                <td>{formatTimestamp(a.requested_at)}</td>
                <td>{formatTimestamp(a.completed_at)}</td>
                <td>
                  <Audit title="Attempt audit">
                    <code>{a.execution_attempt_id}</code>
                    {[detail.latest_result, detail.latest_successful_result]
                      .filter(
                        (r): r is ResultV2 =>
                          typeof r !== "string" &&
                          r.execution_attempt_id === a.execution_attempt_id,
                      )
                      .slice(0, 1)
                      .map((r) => (
                        <code key={r.financial_result_hash}>
                          {r.financial_result_hash}
                        </code>
                      ))}
                  </Audit>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function ResultPanel({
  detail,
  mismatch,
  verified,
  newerAttemptPending,
}: {
  detail?: DetailV2;
  mismatch: boolean;
  verified: boolean;
  newerAttemptPending: boolean;
}) {
  const r = latestSuccess(detail);
  if (mismatch)
    return (
      <Section id="results" step="05" title="Results withheld">
        <ErrorNotice
          error={
            new DesignerApiError(
              409,
              "PLAN_EXECUTION_MISMATCH",
              "The execution does not match the reviewed fold plan.",
            )
          }
        />
        {detail && <Attempts detail={detail} />}
      </Section>
    );
  const m = r && typeof r.metrics !== "string" ? r.metrics : undefined;
  const c = r && typeof r.costs !== "string" ? r.costs : undefined;
  const validation =
    r && typeof r.validation_diagnostics !== "string"
      ? r.validation_diagnostics
      : undefined;
  const metricNames: Array<[string, string, boolean]> = [
    ["cagr", "CAGR", true],
    ["net_sharpe", "Net Sharpe", false],
    ["max_drawdown", "Max Drawdown", true],
    ["annualized_volatility", "Annualized Volatility", true],
    ["gross_turnover", "Turnover (engine units)", false],
    ["mean_beginning_risky_exposure", "Mean Risky Exposure", true],
  ];
  return (
    <Section id="results" step="05" title="Research results">
      {!r || !m || !c ? (
        <p className="workbench-empty">
          Preview and run a design to inspect recalculated results.
        </p>
      ) : (
        <>
          {(detail!.latest_status !== "SUCCESS" || newerAttemptPending) && (
            <div className="wd-notice">
              Latest attempt:{" "}
              {newerAttemptPending
                ? "New attempt submitted; refreshing status"
                : detail!.latest_status}
              . The separately labelled earlier successful result is shown
              below; it does not replace the latest attempt.
            </div>
          )}
          <p className="wd-plan-verified">
            {verified
              ? "Reviewed and executed fold plans match."
              : "Exact execution fold plan returned by the engine."}
          </p>
          <DesignSummary spec={detail!.spec} count={r.evaluation?.fold_count} />
          <div className="workbench-result-summary wd-metrics">
            <div>
              <span>OOS Observations</span>
              <strong>{m.observations}</strong>
            </div>
            <div>
              <span>Final Research Index</span>
              <strong title={String(m.final_research_index)}>
                {number(m.final_research_index, 8)}
              </strong>
            </div>
            <div>
              <span>Realized Simulated Cost</span>
              <strong title={String(c.realized_transaction_cost)}>
                {number(c.realized_transaction_cost, 8)}
              </strong>
            </div>
            {metricNames
              .filter(([k]) => m[k] !== undefined)
              .map(([k, name, pct]) => (
                <div key={k}>
                  <span>{name}</span>
                  <strong>
                    {typeof m[k] === "number"
                      ? pct
                        ? new Intl.NumberFormat("en", {
                            style: "percent",
                            maximumFractionDigits: 3,
                          }).format(m[k] as number)
                        : number(m[k] as number, 6)
                      : "Not available from engine"}
                  </strong>
                </div>
              ))}
          </div>
          <h3 className="wd-chart-title">OOS research index through time</h3>
          <IndexChart a={points(r)} folds={validation?.exact_fold_plan} />
          <p className="wd-muted">
            Actual returned daily values; no smoothing or missing-period
            interpolation. Transaction costs apply to actual traded notional
            under the certified engine convention.
          </p>
          <h3 className="wd-chart-title">Fold-by-fold result inspection</h3>
          {validation?.exact_fold_plan.map((f) => {
            const job = validation.selected_jobs.find(
              (j) => j.outer_fold === f.fold_id,
            );
            return (
              <details className="wd-fold-result" key={f.fold_id}>
                <summary>
                  Fold {f.fold_id} · {f.oos_start} → {f.oos_end_exclusive}{" "}
                  (exclusive)
                </summary>
                <Facts
                  entries={[
                    [
                      "Training interval",
                      `${f.training_start} → ${f.training_end_exclusive} (exclusive)`,
                    ],
                    ["Information cutoff", f.information_cutoff],
                    ["Decision date", f.decision_date],
                    [
                      "OOS interval",
                      `${f.oos_start} → ${f.oos_end_exclusive} (exclusive)`,
                    ],
                    [
                      "Selected candidate",
                      job?.candidate_id ?? "NOT_SUPPORTED",
                    ],
                    ["OOS calendar observations", f.oos_observations],
                  ]}
                />
                <Audit>
                  <p>Fit keys</p>
                  {job?.fit_keys.map((k) => (
                    <code key={k}>{k}</code>
                  ))}
                  <p>Job hash</p>
                  <code>{job?.job_hash ?? "NOT_SUPPORTED"}</code>
                  <p>Result hash</p>
                  <code>{job?.result_hash ?? "NOT_SUPPORTED"}</code>
                </Audit>
              </details>
            );
          })}
          <p className="wd-muted">
            Fold calendar observations and engine OOS return observations are
            distinct; no return count is inferred from calendar rows.
          </p>
          <Audit>
            <Facts
              entries={[
                ["run_id", r.run_id],
                ["execution_attempt_id", r.execution_attempt_id],
                ["Financial-result hash", r.financial_result_hash],
              ]}
            />
            <pre>
              {JSON.stringify(
                { provenance: r.provenance, artifacts: r.result_artifacts },
                null,
                2,
              )}
            </pre>
          </Audit>
          <div className="wd-warnings">
            <h3>Result warnings</h3>
            {r.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
            {r.blockers.map((b, i) => (
              <p key={i}>{JSON.stringify(b)}</p>
            ))}
          </div>
        </>
      )}
      {detail && <Attempts detail={detail} />}
    </Section>
  );
}
type ComparisonPayload = {
  comparison: ComparisonV2;
  left: DetailV2;
  right: DetailV2;
};
function Comparison({
  selected,
  payload,
  compare,
  busy,
}: {
  selected: DetailV2[];
  payload?: ComparisonPayload;
  compare: () => void;
  busy: boolean;
}) {
  return (
    <Section id="compare" step="06" title="Compare research designs">
      <p>
        Select exactly two successful designs in temporary history. Comparison
        reads immutable results without recalculating research.
      </p>
      <div className="wd-comparison-labels">
        {[0, 1].map((i) => (
          <div key={i}>
            <strong>{i === 0 ? "A" : "B"}</strong>
            {selected[i] ? (
              <DesignSummary
                spec={selected[i].spec}
                count={latestSuccess(selected[i])?.evaluation?.fold_count}
              />
            ) : (
              <p>Select a successful run.</p>
            )}
          </div>
        ))}
      </div>
      <Button onClick={compare} disabled={selected.length !== 2 || busy}>
        {busy ? "READING COMPARISON…" : "COMPARE SELECTED RUNS"}
      </Button>
      {payload && (
        <div className="wd-comparison-result">
          <h3>Compared designs</h3>
          <p>
            A: {payload.left.spec.evaluation_start} →{" "}
            {payload.left.spec.evaluation_end_exclusive} ·{" "}
            {label(payload.left.spec.window_type)}. B:{" "}
            {payload.right.spec.evaluation_start} →{" "}
            {payload.right.spec.evaluation_end_exclusive} ·{" "}
            {label(payload.right.spec.window_type)}.
          </p>
          {temporallyComparable(payload.left, payload.right) ? (
            <IndexChart
              a={points(latestSuccess(payload.left))}
              b={points(latestSuccess(payload.right))}
            />
          ) : (
            <p className="wd-notice">
              Evaluation windows differ. Overlay is withheld because the
              research indices cover different periods.
            </p>
          )}
          <div className="wd-table-scroll">
            <table>
              <caption>Financial design differences</caption>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>A</th>
                  <th>B</th>
                </tr>
              </thead>
              <tbody>
                {payload.comparison.financial_input_differences.map((d) => (
                  <tr key={d.path}>
                    <td>
                      {FIELD_LABELS[d.path.slice(1) as keyof DesignForm] ??
                        d.path}
                    </td>
                    <td>{String(d.left)}</td>
                    <td>{String(d.right)}</td>
                  </tr>
                ))}
                <tr>
                  <td>Fold count</td>
                  <td>
                    {latestSuccess(payload.left)?.evaluation?.fold_count ??
                      "NOT_SUPPORTED"}
                  </td>
                  <td>
                    {latestSuccess(payload.right)?.evaluation?.fold_count ??
                      "NOT_SUPPORTED"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="wd-table-scroll">
            <table>
              <caption>Engine-reported result differences (B − A)</caption>
              <thead>
                <tr>
                  <th>Output</th>
                  <th>Difference</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "OOS observations",
                    payload.comparison.oos_observation_difference,
                  ],
                  [
                    "Final research index",
                    payload.comparison.final_research_index_difference,
                  ],
                  [
                    "Realized simulated cost",
                    payload.comparison.realized_cost_difference,
                  ],
                  [
                    "OOS cost assumption (bps)",
                    payload.comparison.transaction_cost_difference_bps,
                  ],
                ].map(([name, v]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{number(v as number, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="wd-warnings">
            {payload.comparison.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
          <Audit title="Advanced comparison audit">
            <pre>{JSON.stringify(payload.comparison, null, 2)}</pre>
          </Audit>
        </div>
      )}
    </Section>
  );
}
function History({
  runs,
  selected,
  open,
  rerun,
  toggle,
  busy,
}: {
  runs: Array<DetailV2 & { historyCreatedAt: string }>;
  selected: string[];
  open: (r: DetailV2) => void;
  rerun: (r: DetailV2) => void;
  toggle: (r: DetailV2) => void;
  busy: boolean;
}) {
  return (
    <Section id="temporary-history" step="—" title="Temporary research history">
      <p className="wd-history-label">TEMPORARY RESEARCH HISTORY</p>
      <p>
        This history may disappear when the preview service restarts. Showing
        the latest available runs, up to twelve.
      </p>
      {!runs.length ? (
        <p className="workbench-empty">No V2 runs are available.</p>
      ) : (
        <div className="wd-table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  "Created",
                  "OOS range (end exclusive)",
                  "Type",
                  "Training",
                  "Rebalance",
                  "OOS cost",
                  "Selection cost",
                  "Folds",
                  "Status",
                  "Final index",
                  "Actions",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const result = latestSuccess(r);
                return (
                  <tr key={r.run_id}>
                    <td>{formatTimestamp(r.historyCreatedAt)}</td>
                    <td>
                      {r.spec.evaluation_start} →{" "}
                      {r.spec.evaluation_end_exclusive}
                    </td>
                    <td>{label(r.spec.window_type)}</td>
                    <td>{r.spec.training_window_months} months</td>
                    <td>{label(r.spec.rebalance_frequency)}</td>
                    <td>{r.spec.transaction_cost_bps} bps</td>
                    <td>{r.spec.selection_cost_bps} bps</td>
                    <td>{result?.evaluation?.fold_count ?? "Not returned"}</td>
                    <td>{r.latest_status}</td>
                    <td>
                      {result && typeof result.metrics !== "string"
                        ? number(result.metrics.final_research_index, 6)
                        : "Not available"}
                    </td>
                    <td>
                      <div className="wd-history-actions">
                        <Button variant="outline" onClick={() => open(r)}>
                          OPEN
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy || !result}
                          onClick={() => rerun(r)}
                        >
                          RERUN
                        </Button>
                        <Button
                          variant={
                            selected.includes(r.run_id)
                              ? "secondary"
                              : "outline"
                          }
                          disabled={!result}
                          onClick={() => toggle(r)}
                        >
                          {selected.includes(r.run_id) ? "SELECTED" : "COMPARE"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
function Designer({ token, signOut }: { token: string; signOut: () => void }) {
  const client = useMemo(() => new WorkbenchV2Client(token), [token]);
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyDesign);
  const [revision, setRevision] = useState(0);
  const revisionRef = useRef(0);
  const [preview, setPreview] = useState<{ plan: PlanV2; revision: number }>();
  const [accepted, setAccepted] = useState(false);
  const [activeId, setActiveId] = useState<string>();
  const [receipt, setReceipt] = useState<ReceiptV2>();
  const [rerunReview, setRerunReview] = useState<DetailV2>();
  const [rerunReviewed, setRerunReviewed] = useState(false);
  const [pollStart, setPollStart] = useState<number>();
  const [now, setNow] = useState(Date.now());
  const expected = useRef(new Map<string, ExpectedPlanV2>());
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const statusRef = useRef<HTMLDivElement>(null);
  const planRef = useRef<HTMLDivElement>(null);
  const caps = useQuery({
    queryKey: ["designer", "capabilities"],
    queryFn: () => client.getCapabilities(),
    retry: false,
  });
  const problems = caps.data ? capabilityProblemsV2(caps.data) : [];
  const ready = !!caps.data && !problems.length;
  const parsed = useMemo(
    () =>
      caps.data
        ? readDesign(form, caps.data)
        : { errors: ["Load capabilities first."] },
    [form, caps.data],
  );
  const planMutation = useMutation({
    mutationFn: async (v: { request: SubmissionV2; revision: number }) => {
      const plan = await client.plan(v.request);
      if (!planMatchesRequest(plan, v.request))
        throw new DesignerApiError(
          409,
          "PLAN_EXECUTION_MISMATCH",
          "The returned plan does not match the requested design.",
        );
      return plan;
    },
    onSuccess: (plan, v) => {
      if (v.revision === revisionRef.current) {
        setPreview({ plan, revision: v.revision });
        setAccepted(false);
        setTimeout(
          () =>
            planRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            }),
          0,
        );
      }
    },
  });
  const history = useQuery({
    queryKey: ["designer", "history"],
    enabled: ready,
    retry: false,
    queryFn: async () => {
      const list = await client.listRuns();
      return Promise.all(
        list.runs.slice(0, 12).map(async (r) => ({
          ...(await client.getRun(r.run_id)),
          historyCreatedAt: r.created_at,
        })),
      );
    },
  });
  const run = useQuery({
    queryKey: ["designer", "run", activeId],
    enabled: ready && !!activeId,
    queryFn: () => client.getRun(activeId!),
    retry: false,
    refetchInterval: (q) =>
      !terminal(q.state.data?.latest_status) &&
      pollStart !== undefined &&
      Date.now() - pollStart < WORKBENCH_UI_POLL_TIMEOUT_MS
        ? 2000
        : false,
  });
  const acceptReceipt = (r: ReceiptV2) => {
    setRerunReview(undefined);
    setRerunReviewed(false);
    setReceipt(r);
    setActiveId(r.run_id);
    setPollStart(Date.now());
    void queryClient.invalidateQueries({
      queryKey: ["designer", "run", r.run_id],
    });
    void history.refetch();
    setTimeout(
      () =>
        statusRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      0,
    );
  };
  const submit = useMutation({
    mutationFn: async (p: PlanV2) => {
      const r = await client.submitRun(p.normalized_request);
      expected.current.set(r.run_id, p);
      return r;
    },
    onSuccess: acceptReceipt,
  });
  const rerun = useMutation({
    mutationFn: async (d: DetailV2) => {
      const result = latestSuccess(d);
      if (!result || typeof result.validation_diagnostics === "string")
        throw new DesignerApiError(
          409,
          "PLAN_EXECUTION_MISMATCH",
          "A verified previous design is required before rerunning.",
        );
      expected.current.set(d.run_id, {
        normalized_request: d.spec,
        folds: result.validation_diagnostics.exact_fold_plan,
      });
      return client.rerun(d.run_id);
    },
    onSuccess: acceptReceipt,
  });
  const selected = compareIds
    .map((id) => history.data?.find((d) => d.run_id === id))
    .filter((d) => d !== undefined);
  const comparison = useMutation({
    mutationFn: async (): Promise<ComparisonPayload> => {
      const [left, right] = selected;
      if (!left || !right)
        throw new DesignerApiError(
          409,
          "COMPARE_REQUIRES_SUCCESS",
          "Select two successful designs.",
        );
      const compared = await client.compareRuns(left.run_id, right.run_id);
      if (
        compared.left.run_id !== left.run_id ||
        compared.right.run_id !== right.run_id ||
        compared.left.execution_attempt_id !==
          latestSuccess(left)?.execution_attempt_id ||
        compared.right.execution_attempt_id !==
          latestSuccess(right)?.execution_attempt_id ||
        compared.left.financial_result_hash !==
          latestSuccess(left)?.financial_result_hash ||
        compared.right.financial_result_hash !==
          latestSuccess(right)?.financial_result_hash
      )
        throw new DesignerApiError(
          409,
          "COMPARISON_ARTIFACT_MISMATCH",
          "The comparison evidence differs from the selected results. Refresh history before comparing.",
        );
      return { comparison: compared, left, right };
    },
  });
  const active = run.data ?? history.data?.find((d) => d.run_id === activeId);
  const mismatch =
    !!active &&
    !!expected.current.get(active.run_id) &&
    !executionMatchesPlan(active, expected.current.get(active.run_id)!);
  const executionBusy =
    submit.isPending ||
    rerun.isPending ||
    active?.latest_status === "RUNNING" ||
    active?.latest_status === "PENDING" ||
    (!!receipt &&
      !terminal(receipt.status) &&
      (!active ||
        active.latest_attempt?.execution_attempt_id !==
          receipt.execution_attempt_id ||
        !terminal(active.latest_status)));
  const currentPlan = !!preview && preview.revision === revision;
  const protocolFailure = [
    run.error,
    submit.error,
    rerun.error,
    history.error,
  ].some((e) => e instanceof WorkbenchApiError && e.status === 502);
  const mayRun =
    ready &&
    !mismatch &&
    !protocolFailure &&
    canRunPlan(
      preview?.plan,
      parsed.request,
      currentPlan,
      accepted,
      executionBusy || planMutation.isPending,
    );
  const allErrors = [
    caps.error,
    run.error,
    history.error,
    submit.error,
    rerun.error,
    comparison.error,
  ].filter(Boolean);
  useEffect(() => {
    if (
      allErrors.some((e) => e instanceof WorkbenchApiError && e.status === 401)
    )
      signOut();
  }, [
    allErrors.find((e) => e instanceof WorkbenchApiError && e.status === 401),
    signOut,
  ]);
  useEffect(() => {
    if (active && terminal(active.latest_status)) void history.refetch();
  }, [active?.latest_status, active?.latest_attempt?.execution_attempt_id]);
  useEffect(() => {
    if (pollStart === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pollStart]);
  const change = (key: keyof DesignForm, value: string) => {
    revisionRef.current += 1;
    setRevision(revisionRef.current);
    setForm((f) => ({ ...f, [key]: value }));
    setAccepted(false);
    setRerunReview(undefined);
    setRerunReviewed(false);
    planMutation.reset();
  };
  const open = (d: DetailV2) => {
    setRerunReview(undefined);
    setRerunReviewed(false);
    setReceipt(undefined);
    setActiveId(d.run_id);
    setPollStart(Date.now());
    setTimeout(
      () =>
        statusRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      0,
    );
  };
  const requestRerun = (d: DetailV2) => {
    const reviewed = expected.current.get(d.run_id);
    if (reviewed && executionMatchesPlan(d, reviewed)) {
      rerun.mutate(d);
      return;
    }
    // A history entry from another session has not yet been reviewed here.
    // Display its immutable engine plan; do not reconstruct a new run spec.
    open(d);
    setRerunReview(d);
  };
  const historicalRerunResult = latestSuccess(rerunReview);
  const historicalRerunPlan =
    historicalRerunResult &&
    typeof historicalRerunResult.validation_diagnostics !== "string"
      ? historicalRerunResult.validation_diagnostics.exact_fold_plan
      : undefined;
  const toggle = (d: DetailV2) => {
    comparison.reset();
    setCompareIds((ids) =>
      ids.includes(d.run_id)
        ? ids.filter((id) => id !== d.run_id)
        : ids.length < 2
          ? [...ids, d.run_id]
          : [ids[1], d.run_id],
    );
  };
  if (caps.isPending)
    return (
      <main className="workbench-loading">
        <span className="workbench-activity" />
        <p>Loading V2 research capabilities…</p>
      </main>
    );
  if (!ready)
    return (
      <main className="workbench-shell wd-shell">
        <Header signOut={signOut} />
        <ErrorNotice
          error={
            caps.error ??
            new DesignerApiError(
              502,
              "CAPABILITY_CONTRACT_MISMATCH",
              `Execution disabled: ${problems.join(", ")}.`,
            )
          }
        />
        <Button variant="outline" onClick={() => void caps.refetch()}>
          REFRESH CAPABILITIES
        </Button>
      </main>
    );
  const c = caps.data!;
  const timing = derivedTiming(c, form.rebalance_frequency);
  const p = preview?.plan;
  const status =
    active?.latest_attempt?.execution_attempt_id ===
      receipt?.execution_attempt_id || !receipt
      ? active?.latest_status
      : receipt.status;
  const timedOut =
    pollStart !== undefined &&
    now - pollStart >= WORKBENCH_UI_POLL_TIMEOUT_MS &&
    !terminal(status);
  const previewSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (parsed.request && !planMutation.isPending) {
      setAccepted(false);
      planMutation.mutate({ request: parsed.request, revision });
    }
  };
  return (
    <main className="workbench-shell wd-shell">
      <Header signOut={signOut} />
      <nav className="wd-steps" aria-label="Research workflow">
        {[
          "Configure",
          "Preview folds",
          "Review",
          "Run",
          "Results",
          "Compare",
        ].map((s, i) => (
          <a
            key={s}
            href={`#${["configure", "preview-folds", "review", "run-status", "results", "compare"][i]}`}
          >
            <span>{i + 1}</span>
            {s}
          </a>
        ))}
      </nav>
      {allErrors.map((e, i) => (
        <ErrorNotice key={i} error={e} />
      ))}
      <div className="wd-design-layout">
        <Section id="configure" step="01" title="Define your research design">
          <p className="wd-context">
            SPY · Historical empirical research · Traditional walk-forward ·
            Certified market-exposure model
          </p>
          <form onSubmit={previewSubmit} noValidate>
            <DesignInputs form={form} c={c} change={change} />
            {timing && (
              <div className="wd-timing" aria-label="Derived timing">
                <h3>Derived timing · read only</h3>
                <Facts
                  entries={[
                    ["OOS horizon", monthLabel(timing.oosMonths)],
                    ["Step", monthLabel(timing.stepMonths)],
                    [
                      "Recalibration",
                      `Every ${timing.recalibration} rebalance`,
                    ],
                  ]}
                />
              </div>
            )}
            {parsed.errors.length > 0 && (
              <div className="wd-validation">
                <p>Complete the design to preview:</p>
                <ul>
                  {parsed.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            <Button
              size="lg"
              type="submit"
              disabled={!parsed.request || planMutation.isPending}
            >
              {planMutation.isPending ? "PLANNING…" : "PREVIEW WALK-FORWARD"}
            </Button>
            <p className="wd-muted">
              Preview only constructs and validates folds. It does not run a
              backtest.
            </p>
          </form>
          {planMutation.error && <ErrorNotice error={planMutation.error} />}
        </Section>
        <DatasetRules c={c} />
      </div>
      <div ref={planRef}>
        <Section
          id="preview-folds"
          step="02"
          title="Exact walk-forward fold map"
        >
          {!p ? (
            <p className="workbench-empty">
              Define your design and preview the folds before running research.
            </p>
          ) : (
            <>
              {!currentPlan && (
                <div className="wd-notice" role="status">
                  <strong>PLAN OUTDATED</strong>
                  <p>
                    Inputs changed. This map belongs to the previous request.
                    Preview the current design before running.
                  </p>
                </div>
              )}
              <FoldMap folds={p.folds} />
              <FoldTable folds={p.folds} />
              <p className="wd-muted">
                *Warmup observations is the backend-reported history available
                before training; the model uses its required trailing warmup.
                Calendar observations do not imply an equal number of realized
                OOS returns.
              </p>
              <p className="wd-muted">
                Calendar fold boundaries and actual observed decision dates are
                distinct when the boundary is not a trading day.
              </p>
            </>
          )}
        </Section>
      </div>
      <Section id="review" step="03" title="Review before execution">
        {p ? (
          <>
            <DesignSummary
              spec={p.normalized_request}
              count={p.number_of_folds}
            />
            <Facts
              entries={[
                [
                  "OOS horizon",
                  monthLabel(p.derived_engine_calendar.test_months),
                ],
                ["Step", monthLabel(p.derived_engine_calendar.step_months)],
                [
                  "Recalibration",
                  `Every ${p.derived_engine_calendar.recalibration_frequency} rebalance`,
                ],
                ["Estimated jobs", p.estimated_jobs.total_jobs_estimated],
                ["First training date", p.first_training_date],
                ["Last observed OOS date", p.last_oos_date],
              ]}
            />
            <div className="wd-warnings">
              <h3>Plan warnings</h3>
              {p.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
              <h3>Blockers</h3>
              {p.blockers.length ? (
                p.blockers.map((b, i) => <p key={i}>{JSON.stringify(b)}</p>)
              ) : (
                <p>None returned by the backend.</p>
              )}
            </div>
            <label className="wd-review-check">
              <input
                type="checkbox"
                checked={accepted && currentPlan}
                disabled={
                  !currentPlan ||
                  !!p.blockers.length ||
                  !!planMutation.error ||
                  planMutation.isPending
                }
                onChange={(e) => setAccepted(e.target.checked)}
              />
              I have reviewed these exact training and OOS folds and both cost
              assumptions.
            </label>
          </>
        ) : (
          <p>
            Run is disabled until a successful, current fold plan has been
            reviewed.
          </p>
        )}
        <div className="wd-run-action">
          <Button
            size="lg"
            disabled={!mayRun}
            onClick={() => {
              if (mayRun && p) submit.mutate(p);
            }}
          >
            {submit.isPending ? "SUBMITTING…" : "RUN RESEARCH"}
          </Button>
          <p>
            Runs only the normalized financial request returned by this plan.
          </p>
        </div>
      </Section>
      <div ref={statusRef}>
        <Section id="run-status" step="04" title="Execution status">
          <div aria-live="polite">
            {!active && !receipt ? (
              <p>No design has been submitted in this session.</p>
            ) : (
              <>
                <div className="workbench-status">
                  {!terminal(status) && <span className="workbench-activity" />}
                  <div>
                    <strong>
                      {status ? STATUS_LABELS[status] : "Loading status"}
                    </strong>
                    <small>{status}</small>
                  </div>
                </div>
                {active && (
                  <DesignSummary
                    spec={active.spec}
                    count={
                      latestSuccess(active)?.evaluation?.fold_count ??
                      expected.current.get(active.run_id)?.folds.length
                    }
                  />
                )}
                <p>
                  Stage:{" "}
                  {active?.latest_attempt?.stage ??
                    receipt?.stage ??
                    "Not available"}
                </p>
                {receipt?.reused_existing_attempt && (
                  <p className="wd-notice">
                    Existing experiment reused. This submission did not start a
                    duplicate execution.
                  </p>
                )}
                {status === "BLOCKED" && (
                  <div className="wd-notice">
                    The run is blocked. Another run may occupy the worker. No
                    automatic retry will be started.
                    {active?.blockers.map((b, i) => (
                      <p key={i}>{JSON.stringify(b)}</p>
                    ))}
                  </div>
                )}
                {status === "FAILED" && (
                  <p className="wd-error">
                    {active?.latest_attempt?.error_message ??
                      "The attempt failed. Evidence is preserved."}
                  </p>
                )}
                {timedOut && (
                  <p className="wd-notice">
                    Bounded status polling paused. The server may still be
                    working. Refresh manually; do not submit again.
                  </p>
                )}
                <div className="workbench-actions">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPollStart(Date.now());
                      void run.refetch();
                      void history.refetch();
                    }}
                  >
                    REFRESH STATUS
                  </Button>
                  {active && latestSuccess(active) && (
                    <Button
                      variant="outline"
                      disabled={executionBusy || mismatch || protocolFailure}
                      onClick={() => requestRerun(active)}
                    >
                      RERUN SAME DESIGN
                    </Button>
                  )}
                </div>
                <p className="wd-muted">
                  A rerun preserves experiment identity and creates a new
                  immutable attempt; prior evidence remains intact.
                </p>
                {rerunReview && historicalRerunPlan && (
                  <div className="wd-rerun-review">
                    <h3>Review the immutable design before rerunning</h3>
                    <p>
                      This exact design was executed previously. Review its
                      stored folds before creating a new attempt; the current
                      configuration form is not submitted.
                    </p>
                    <DesignSummary
                      spec={rerunReview.spec}
                      count={historicalRerunPlan.length}
                    />
                    <FoldMap folds={historicalRerunPlan} />
                    <label className="wd-review-check">
                      <input
                        type="checkbox"
                        checked={rerunReviewed}
                        onChange={(e) => setRerunReviewed(e.target.checked)}
                      />
                      I have reviewed this immutable design and its exact folds
                      for rerun.
                    </label>
                    <Button
                      disabled={
                        !rerunReviewed ||
                        executionBusy ||
                        mismatch ||
                        protocolFailure
                      }
                      onClick={() => rerun.mutate(rerunReview)}
                    >
                      CONFIRM RERUN SAME DESIGN
                    </Button>
                  </div>
                )}
                <Audit>
                  <code>run_id: {activeId}</code>
                  <code>
                    execution_attempt_id:{" "}
                    {active?.latest_attempt?.execution_attempt_id ??
                      receipt?.execution_attempt_id}
                  </code>
                </Audit>
              </>
            )}
          </div>
        </Section>
      </div>
      <ResultPanel
        detail={active}
        mismatch={mismatch}
        verified={!!active && expected.current.has(active.run_id)}
        newerAttemptPending={
          !!receipt &&
          !!active &&
          receipt.run_id === active.run_id &&
          receipt.execution_attempt_id !==
            active.latest_attempt?.execution_attempt_id
        }
      />
      <Comparison
        selected={selected}
        payload={comparison.data}
        compare={() => comparison.mutate()}
        busy={comparison.isPending}
      />
      <History
        runs={history.data ?? []}
        selected={compareIds}
        open={open}
        rerun={requestRerun}
        toggle={toggle}
        busy={executionBusy || mismatch || protocolFailure}
      />
      <aside className="workbench-unavailable">
        <h2>Not available in this version</h2>
        <p>
          Other assets and research modes, independent OOS/step/recalibration
          controls, signals, optimizers, allocation research, broker execution,
          and investment recommendations.
        </p>
      </aside>
    </main>
  );
}
export default function WorkbenchDesigner() {
  const [token, setToken] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : sessionStorage.getItem(WORKBENCH_SESSION_TOKEN_KEY),
  );
  const cache = useQueryClient();
  const signOut = useCallback(() => {
    sessionStorage.removeItem(WORKBENCH_SESSION_TOKEN_KEY);
    cache.removeQueries({ queryKey: ["designer"] });
    setToken(null);
  }, [cache]);
  return token ? (
    <Designer token={token} signOut={signOut} />
  ) : (
    <Access accept={setToken} />
  );
}
