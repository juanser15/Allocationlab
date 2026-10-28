import { useEffect, useRef, useState } from "react";
import { Card, pct, researchApi } from "./coordinated-ui";
import { CURRENT_CASH_POLICY } from "../../../api-server/src/lib/workbench/coordinated-contract";

const show = (v: unknown) => (
  <pre>{JSON.stringify(v, null, 2)}</pre>
);

export const ZERO_CASH_POLICY = CURRENT_CASH_POLICY;
export type CashPolicy = typeof ZERO_CASH_POLICY;
export type Mandate = {
  minimum_positions: number;
  maximum_positions: number;
  minimum_weight: number;
};
// Fields now live on shared CoordinatedRequest; kept as a narrow alias.
export type P0Extras = {
  cash_policy: CashPolicy;
  slippage_bps: number;
  mandate?: Mandate;
  quality_control?: QualityControl;
};
export const QC_POLICY_VERSION = "STRUCTURAL_V1" as const;
export type QualityControl = { enabled: boolean; policy_version: typeof QC_POLICY_VERSION };
export const QC_OFF: QualityControl = { enabled: false, policy_version: QC_POLICY_VERSION };
export const qcLabel = (qc: any) =>
  !qc ? "Not recorded" : `${qc.enabled ? "ON · blocking" : "OFF · observe only"} · ${qc.policy_version ?? "policy not recorded"}`;

export function QualityControlCard({ value, onChange }: { value?: QualityControl; onChange: (v: QualityControl) => void }) {
  const on = !!value?.enabled;
  return (
    <Card title="Quality control">
      <div className="cp-options" role="group" aria-label="Quality control">
        <button className="cp-option" aria-pressed={!on} data-testid="button-qc-off" onClick={() => onChange({ enabled: false, policy_version: QC_POLICY_VERSION })}>
          <strong>OFF · observe only</strong>
          <small>Diagnostics are computed and recorded; nothing is filtered by them.</small>
        </button>
        <button className="cp-option" aria-pressed={on} data-testid="button-qc-on" onClick={() => onChange({ enabled: true, policy_version: QC_POLICY_VERSION })}>
          <strong>ON · blocking</strong>
          <small>An invalid rebalance blocks the run with QUALITY_GATE_BLOCKED.</small>
        </button>
      </div>
      <p data-testid="text-qc-policy">Policy {QC_POLICY_VERSION} · fixed, no tunable thresholds.</p>
      <p className="cp-note">
        Evaluated at every rebalance on the exact rolling or expanding training
        window, using earlier data only. Blocking checks when ON: 100% coverage,
        valid current inputs with causal timestamps, and nonconstant ranking for
        cross-sectional signal selection. PCA concentration and rank stability
        are diagnostics and warnings only; no return thresholds are imposed.
        Data, math and mandate checks stay mandatory in both modes. There is no
        automatic cash or strategy fallback: a blocked run produces no valid
        whole-period performance. Applies to the portfolio only, never to the
        SPY/cash study.
      </p>
    </Card>
  );
}

const fmt = (v: any, percent = false) =>
  v == null || Number.isNaN(Number(v)) ? "—" : percent ? pct(Number(v)) : typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : String(v);

export function QualityDecisionTable({ decisions }: { decisions: any[] }) {
  return (
    <div className="cp-scroll">
      <table data-testid="table-quality-decisions">
        <thead><tr><th>Decision</th><th>Status</th><th>Cutoff</th><th>Training window</th><th>Coverage</th><th>Dispersion</th><th>PC1 share</th><th>Rank stability</th><th>Blocking / warnings</th></tr></thead>
        <tbody>
          {decisions.map((d, i) => (
            <tr key={`${d.decision_date}-${i}`} data-testid={`row-quality-${i}`}>
              <td>{d.decision_date}</td>
              <td><strong>{d.status}</strong>{d.would_block && d.status !== "BLOCKED" ? " · would block" : ""}</td>
              <td>{d.information_cutoff}</td>
              <td>{d.training_start ?? "—"} → {d.information_cutoff} · {fmt(d.observations)} obs</td>
              <td>{fmt(d.metrics?.coverage, true)}</td>
              <td>{fmt(d.metrics?.dispersion)}</td>
              <td>{fmt(d.metrics?.pc1_share, true)}</td>
              <td>{fmt(d.metrics?.rank_stability)}{d.metrics?.rank_history_count != null ? ` · n=${d.metrics.rank_history_count}` : ""}</td>
              <td>{[...(d.blocking_reasons ?? []).map((r: string) => `Block: ${r}`), ...(d.warnings ?? [])].join(" · ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const qcStatusText: Record<string, string> = {
  PASS: "PASS · all evaluated rebalances passed the blocking checks",
  WARN: "WARN · no blocking failure, warnings recorded",
  OFF_OBSERVE_ONLY: "OFF · observe only (diagnostics recorded, not enforced)",
  NOT_REQUIRED_CAPITAL_ONLY: "Not required · capital-only study",
};

export function QualityGateEvidence({ evidence, spec }: { evidence: any; spec?: any }) {
  if (!evidence)
    return (
      <Card title="Quality gate evidence">
        <p data-testid="status-quality-evidence">Not recorded for this result. This is neither a pass nor a failure.</p>
        {spec && <p className="cp-note">Saved configuration: {qcLabel(spec.quality_control)}.</p>}
      </Card>
    );
  const decisions: any[] = Array.isArray(evidence.decisions) ? evidence.decisions : [];
  return (
    <Card title="Quality gate evidence">
      <dl className="cp-engines">
        <dt>Status</dt><dd data-testid="status-quality-evidence">{qcStatusText[evidence.status] ?? evidence.status ?? "Not recorded"}</dd>
        <dt>Mode</dt><dd>{evidence.enabled ? "ON · blocking" : "OFF · observe only"} · {evidence.policy_version ?? "—"}</dd>
        <dt>Policy hash</dt><dd><code>{evidence.policy_hash ?? "Not recorded"}</code></dd>
        <dt>Coverage of rebalances</dt><dd>{fmt(evidence.evaluated_rebalances)} evaluated / {fmt(evidence.expected_rebalances)} expected · every rebalance: {evidence.every_rebalance ? "yes" : "no"}</dd>
        <dt>Predictive quality</dt><dd>{evidence.predictive_quality === "NOT_USED_NO_FUTURE_LABELS" ? "Not used · no future labels" : evidence.predictive_quality ?? "Not recorded"}</dd>
      </dl>
      {decisions.length ? <QualityDecisionTable decisions={decisions} /> : <p className="cp-empty">No per-rebalance decisions recorded.</p>}
      <details>
        <summary>Raw quality evidence</summary>
        {show(evidence)}
      </details>
    </Card>
  );
}

export function GateFailureEvidence({ failure }: { failure: any }) {
  const ev = failure?.gate_evidence ?? failure?.technical_details?.gate_evidence ?? failure?.technical_details?.quality_gate_evidence;
  const blocked = failure?.error_class === "QUALITY_GATE_BLOCKED";
  if (!blocked && !ev) return null;
  const decisions: any[] = Array.isArray(ev?.decisions) ? ev.decisions : ev?.decision_date ? [ev] : [];
  return (
    <Card title="Quality gate blocked this run">
      <p data-testid="status-quality-blocked">
        {failure?.error_class ?? "Blocked"}{failure?.failed_decision_date ? ` · decision ${failure.failed_decision_date}` : ""}. No whole-period performance was produced and no fallback was substituted.
      </p>
      {decisions.length > 0 && <QualityDecisionTable decisions={decisions} />}
      {(ev || failure?.technical_details) && (
        <details>
          <summary>Raw blocker details</summary>
          {show(ev ?? failure.technical_details)}
        </details>
      )}
    </Card>
  );
}
export const PERSISTENT = "PERSISTENT_POSTGRES_RESEARCH_STORAGE";
export const STORAGE_NOTE =
  "Research only · new runs persist in research storage · earlier runs are labeled temporary/unverified";

export const cashPolicyLabel = (policy: any) =>
  policy?.type === "ZERO_RETURN"
    ? "Cash return assumption: 0%"
    : policy?.type === "SGOV_TOTAL_RETURN"
    ? `${policy.ticker ?? "SGOV"} total-return proxy`
    : "Not recorded (original run)";

export function CashPolicyCard({
  slippage,
  onSlippage,
}: {
  slippage: number;
  onSlippage: (v: number) => void;
}) {
  return (
    <Card title="Cash and execution frictions">
      <div className="cp-fields">
        <label>
          Cash policy
          <input readOnly value="Cash return assumption: 0% (forced)" data-testid="text-cash-policy" />
        </label>
        <label>
          Slippage · basis points
          <input
            type="number"
            min={0}
            max={1000}
            step={0.1}
            data-testid="input-slippage"
            value={Number.isNaN(slippage) ? "" : slippage}
            onInput={(e) =>
              onSlippage(e.currentTarget.value === "" ? NaN : Number(e.currentTarget.value))
            }
          />
        </label>
      </div>
      <p className="cp-note">
        Cash return is fixed at 0% for all new portfolio backtests and independent
        SPY/cash studies until this policy is explicitly changed. No SGOV history
        is required for cash. Cash allocation is not forced to zero.
        Saved results retain their original cash assumptions.
        Slippage is applied on top of trading costs and defaults to 0.
      </p>
    </Card>
  );
}

export function PresetField({
  label,
  value,
  onChange,
  presets,
  percent = false,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  presets: Record<string, number>;
  percent?: boolean;
  min: number;
  max: number;
  step: number;
}) {
  const match = Object.entries(presets).find(([, v]) => v === value)?.[0];
  const shown = (v: number) => (percent ? pct(v) : String(v));
  return (
    <div className="cp-preset">
      <div className="cp-preset-head">
        <small>{label}</small>
        <strong data-testid={`text-preset-${label}`}>
          {Number.isNaN(value) ? "Not set" : shown(value)} · {match ?? "Custom value"}
        </strong>
      </div>
      <div className="cp-preset-row" role="group" aria-label={`${label} presets`}>
        {Object.entries(presets).map(([name, v]) => (
          <button
            key={name}
            aria-pressed={match === name}
            onClick={() => onChange(v)}
            data-testid={`button-preset-${name}`}
          >
            {name} · {shown(v)}
          </button>
        ))}
      </div>
      <details className="cp-advanced">
        <summary>Set an exact value</summary>
        <label>
          {label}
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={Number.isNaN(value) ? "" : value * (percent ? 100 : 1)}
            onInput={(e) =>
              onChange(
                e.currentTarget.value === ""
                  ? NaN
                  : Number(e.currentTarget.value) / (percent ? 100 : 1),
              )
            }
          />
        </label>
      </details>
      <p className="cp-note">Presets only apply when clicked; your configured value is never changed otherwise.</p>
    </div>
  );
}

export function MandateFields({
  value,
  maxWeight,
  selected,
  onChange,
}: {
  value?: Mandate;
  maxWeight: number;
  selected: number;
  onChange: (v: Mandate | undefined) => void;
}) {
  const set = (key: keyof Mandate, raw: string, scale = 1) =>
    value && onChange({ ...value, [key]: raw === "" ? NaN : Number(raw) / scale });
  return (
    <details className="cp-advanced" open={!!value}>
      <summary>Mandate constraints · {value ? "active" : "not applied"}</summary>
      <label className="cp-check">
        <input
          type="checkbox"
          checked={!!value}
          data-testid="input-mandate-enabled"
          onChange={(e) =>
            onChange(
              e.target.checked
                ? { minimum_positions: 1, maximum_positions: Math.max(1, selected), minimum_weight: 0 }
                : undefined,
            )
          }
        />
        Apply a final-holdings count and minimum-weight mandate
      </label>
      {value && (
        <div className="cp-fields">
          <label>
            Minimum final holdings
            <input type="number" min={1} value={Number.isNaN(value.minimum_positions) ? "" : value.minimum_positions} onInput={(e) => set("minimum_positions", e.currentTarget.value)} />
          </label>
          <label>
            Maximum final holdings
            <input type="number" min={1} value={Number.isNaN(value.maximum_positions) ? "" : value.maximum_positions} onInput={(e) => set("maximum_positions", e.currentTarget.value)} />
          </label>
          <label>
            Minimum weight per held asset (% of NAV)
            <input type="number" min={0} max={100} step={0.1} value={Number.isNaN(value.minimum_weight) ? "" : value.minimum_weight * 100} onInput={(e) => set("minimum_weight", e.currentTarget.value, 100)} />
          </label>
        </div>
      )}
      <p className="cp-note">
        Position limits count FINAL holdings on each rebalance, not selected
        candidates: {selected} candidate{selected === 1 ? "" : "s"} may exceed the
        maximum positions. All weights are fractions of total NAV, including
        cash. Maximum weight remains the per-asset limit above ({pct(maxWeight)}).
        Mandates apply to the portfolio only, never to the SPY/cash study. The
        optimizer does not search over position counts; the server checks each
        resulting allocation and rejects violations. Nothing is relaxed,
        redistributed or replaced by a fallback.
      </p>
    </details>
  );
}

export function AlphaHandoffCard({ context }: { context: string }) {
  return (
    <Card title="Alpha generation and versioned handoff">
      <p>
        Alpha streams are generated and versioned in the legacy Portfolio Lab,
        under Prepared inputs with the B2 optimization engine. Select the
        "alpha streams" representation, define factor, universe, mapping,
        capital fraction and schedule, then prepare and hand off a versioned
        candidate set to B2 allocation.
      </p>
      <dl className="cp-engines">
        <dt>This workspace ({context})</dt>
        <dd>Coordinated engine · regime + asset forecasts + mean–variance on selected ETFs. It does not consume alpha streams.</dd>
        <dt>Portfolio Lab · Prepared inputs</dt>
        <dd>B2 engine · prepared asset returns or versioned alpha streams, with B3 validation. Direct asset and factor selection also live there.</dd>
      </dl>
      <p className="cp-note">
        No alpha is exported between engines. Results from the two engines are
        separate evidence and are not mixed.
      </p>
      <a className="cp-link-button" href="/portfolio-lab" data-testid="link-alpha-portfolio-lab">
        Open Portfolio Lab · Prepared inputs
      </a>
    </Card>
  );
}

export function StorageBadge({ record, compact = false }: { record: any; compact?: boolean }) {
  const status =
    record?.storage_status ??
    record?.latest_successful_result?.storage_status ??
    record?.provenance?.storage_status;
  const persistent = status === PERSISTENT;
  return (
    <span className={`cp-storage ${persistent ? "is-persistent" : "is-legacy"}`} data-testid="status-storage">
      {persistent
        ? compact ? "Persistent" : "Persistent research storage"
        : compact ? "Original temporary · unverified" : "Original temporary storage · unverified"}
    </span>
  );
}


export function FrozenEvidence({ result, spec }: { result: any; spec: any }) {
  const accounting = result?.accounting,
    convention = result?.metrics_convention ?? accounting?.metrics_convention,
    mandate = result?.mandate_evidence,
    gate = result?.capital_gate ?? result?.capital_gate_evidence,
    quality = result?.quality_gate_evidence;
  return (
    <Card title="Frozen accounting and gate evidence">
      <dl className="cp-engines">
        <dt>Cash policy</dt>
        <dd>{cashPolicyLabel(accounting?.cash_policy ?? spec?.cash_policy)}{!accounting?.cash_policy && " · not frozen in this result"}</dd>
        <dt>Slippage</dt>
        <dd>{spec?.slippage_bps == null ? "Not recorded" : `${spec.slippage_bps} bps`}</dd>
        <dt>Metrics convention</dt>
        <dd>{convention ? (typeof convention === "string" ? convention : "Recorded · see details") : "Not recorded"}</dd>
        <dt>Mandate evidence</dt>
        <dd>{Array.isArray(mandate) ? `${mandate.length} recorded checks` : "Not recorded"}</dd>
        <dt>Capital gate</dt>
        <dd>{gate ? "Recorded" : "Not recorded for this result"}</dd>
        <dt>Quality gate</dt>
        <dd data-testid="status-quality-gate">{quality ? (qcStatusText[quality.status] ?? quality.status ?? "Recorded") : `Not recorded${spec?.quality_control ? ` · configured ${qcLabel(spec.quality_control)}` : ""}`}</dd>
      </dl>
      {(accounting || mandate || gate || quality) && (
        <details>
          <summary>Recorded evidence</summary>
          {show({ accounting, metrics_convention: convention, mandate_evidence: mandate, capital_gate: gate, quality_gate_evidence: quality })}
        </details>
      )}
    </Card>
  );
}

type Review = {
  state: "CALCULATED" | "REVIEWED" | "APPROVED" | "REJECTED";
  events: { id: string; run_id: string; execution_attempt_id: string; actor: string; decision: string; note: string; created_at: string; result_hash: string }[];
  approval_blockers: string[];
};

function successfulAttempt(run: any): string | null {
  const r = run?.latest_successful_result;
  if (r?.execution_attempt_id) return r.execution_attempt_id;
  if (run?.latest_successful_attempt_id) return run.latest_successful_attempt_id;
  const attempts: any[] = Array.isArray(run?.attempt_history) ? run.attempt_history : [];
  const ok = [...attempts].reverse().find((a) => a.status === "SUCCESS");
  return ok?.attempt?.execution_attempt_id ?? ok?.execution_attempt_id ?? null;
}

export function ReviewPanel({ run }: { run: any }) {
  const runId: string | undefined = run?.run_id;
  const attempt = successfulAttempt(run);
  const [review, setReview] = useState<Review | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [actor, setActor] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  const current = useRef(runId);
  current.current = runId;
  const load = (id: string) => {
    setLoading(true);
    setError("");
    researchApi(`/runs/${id}/reviews`)
      .then((r) => { if (current.current === id) setReview(r); })
      .catch((e) => { if (current.current === id) setError(e.message); })
      .finally(() => { if (current.current === id) setLoading(false); });
  };
  useEffect(() => {
    setReview(null);
    setNote("");
    if (runId) load(runId);
  }, [runId]);
  if (!runId) return null;
  async function decide(decision: "REVIEWED" | "APPROVED" | "REJECTED") {
    if (!runId || !attempt) return;
    const id = runId;
    setBusy(true);
    setError("");
    try {
      await researchApi(`/runs/${id}/reviews`, { execution_attempt_id: attempt, decision, actor: actor.trim(), note: note.trim() });
      if (current.current === id) { setNote(""); load(id); }
    } catch (e) {
      if (current.current === id) setError((e as Error).message);
    } finally {
      if (current.current === id) setBusy(false);
    }
  }
  const ready = !!attempt && actor.trim() && note.trim() && !busy;
  const state = review?.state;
  return (
    <Card title="Review and approval">
      <div className="cp-states" aria-label="Lifecycle">
        {["DRAFT", "CALCULATED", "REVIEWED", "APPROVED"].map((s) => (
          <span key={s} className={s === state || (s === "DRAFT" && !state) ? "is-on" : ""}>{s.toLowerCase()}</span>
        ))}
        {state === "REJECTED" && <span className="is-on is-rejected">rejected</span>}
      </div>
      {loading && !review && <div className="cp-skeleton" aria-busy="true" />}
      {error && (
        <div className="cp-error" role="alert">
          {error} <button onClick={() => load(runId)}>Retry</button>
        </div>
      )}
      {review && (
        <>
          <p data-testid="status-review-state">Server state: <strong>{review.state}</strong></p>
          {review.approval_blockers.length > 0 && (
            <div className="cp-error">
              Approval blocked:
              <ul>{review.approval_blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            </div>
          )}
          {review.events.length ? (
            <div className="cp-scroll">
              <table>
                <thead><tr><th>When</th><th>Decision</th><th>Declared actor</th><th>Note</th><th>Attempt · hash</th></tr></thead>
                <tbody>
                  {review.events.map((e) => (
                    <tr key={e.id}>
                      <td>{e.created_at}</td><td>{e.decision}</td><td>{e.actor}</td><td>{e.note}</td>
                      <td><code>{e.execution_attempt_id} · {e.result_hash?.slice(0, 12)}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="cp-empty">No review decisions recorded for this run.</p>}
        </>
      )}
      {attempt ? (
        <>
          <div className="cp-fields">
            <label>Declared reviewer<input value={actor} onChange={(e) => setActor(e.target.value)} data-testid="input-review-actor" /></label>
            <label className="cp-wide">Note (required)<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} data-testid="input-review-note" /></label>
          </div>
          <div className="cp-actions">
            <button disabled={!ready} onClick={() => void decide("REVIEWED")} data-testid="button-review-reviewed">Mark reviewed</button>
            <button className="cp-primary" disabled={!ready || (review?.approval_blockers.length ?? 0) > 0} onClick={() => void decide("APPROVED")} data-testid="button-review-approve">Approve</button>
            <button disabled={!ready} onClick={() => void decide("REJECTED")} data-testid="button-review-reject">Reject</button>
          </div>
          <p className="cp-note">
            Bound to successful attempt {attempt}. Quality gate for this run:{" "}
            {run?.latest_successful_result?.quality_gate_evidence
              ? qcStatusText[run.latest_successful_result.quality_gate_evidence.status] ?? run.latest_successful_result.quality_gate_evidence.status
              : "not recorded"}
            ; the server may still block approval. The reviewer name is declared,
            not authenticated. The server checks freshness and may refuse a stale
            decision.
          </p>
        </>
      ) : (
        <p className="cp-empty">Reviews require a successful execution attempt.</p>
      )}
    </Card>
  );
}
