import type { ReactNode } from "react";
import { models, pct } from "./coordinated-ui";

/** Only the capital-policy fields; the same shape exists on the shared draft and the study copy. */
export type PolicyFields = {
  control_mode: "MAX_EXPOSURE" | "RISK_BUDGET";
  maximum_exposure: number;
  risk_budget: number;
  regime_response: "FIXED" | "ADAPTIVE";
  defensive_multiplier: number;
  regime_model: keyof typeof models;
  capital_signal_frequency?: CapitalFrequency;
};
export type CapitalFrequency = "REBALANCE_ONLY" | "DAILY";
/** Absent on historical records means the rebalance-only clock. */
export const freqOf = (p: any): CapitalFrequency => (p?.capital_signal_frequency === "DAILY" ? "DAILY" : "REBALANCE_ONLY");
export const freqLabel = (f: unknown) => (f === "DAILY" ? "Daily" : "Rebalance dates only");

const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
/** Display only: percent reduction in fully defensive conditions = 100 * (1 - multiplier). */
export const reductionPct = (m: number) =>
  finite(m) ? Number((100 * (1 - m)).toFixed(4)) : NaN;
export const noAdaptiveEffect = (p: Partial<PolicyFields>) =>
  p?.regime_response === "ADAPTIVE" && p.defensive_multiplier === 1;
/** Compare actual copied inputs, not rounded display strings or unrelated study dates. */
export function sameCapitalPolicy(a: PolicyFields & { slippage_bps?: number }, b: PolicyFields & { slippage_bps?: number }) {
  if (freqOf(a) !== freqOf(b)) return false;
  return (["control_mode", "maximum_exposure", "risk_budget", "regime_response", "defensive_multiplier", "regime_model", "slippage_bps"] as const)
    .every(key => Object.is(a[key], b[key]));
}

export const noEffectText = (p: Partial<PolicyFields>) =>
  p.control_mode === "RISK_BUDGET"
    ? "Stress reduction is 0%: the volatility ceiling ignores the regime. SPY weight can still vary with estimated training volatility."
    : "Stress reduction is 0%: the exposure ceiling is the same in every regime, as with a fixed rule.";

export function NoEffectWarning({ policy, testId = "warning-no-adaptive-effect" }: { policy: Partial<PolicyFields>; testId?: string }) {
  if (!noAdaptiveEffect(policy)) return null;
  return (
    <div className="cpx-warn" role="status" data-testid={testId}>
      <strong>Regime has no effect.</strong> {noEffectText(policy)}
    </div>
  );
}

export function limitText(p: Partial<PolicyFields>, multiplier = 1) {
  if (p.control_mode === "RISK_BUDGET")
    return `${pct((p.risk_budget ?? NaN) * multiplier)} volatility ceiling`;
  return `${pct((p.maximum_exposure ?? NaN) * multiplier)} maximum exposure`;
}

/** One-line rule description for any policy, including saved specs. */
export function policySentence(p: any) {
  if (!p) return "Not recorded";
  const base = limitText(p);
  const clock = ` · capital ${freqLabel(freqOf(p)).toLowerCase()}`;
  if (p.regime_response !== "ADAPTIVE") return `${base} · fixed${clock}`;
  return `${base} · adaptive, cut ${finite(p.defensive_multiplier) ? `${reductionPct(p.defensive_multiplier)}%` : "—"} under full stress · ${models[p.regime_model as keyof typeof models] ?? p.regime_model}${clock}`;
}

export function PolicySummary({ policy, label, testId, children }: { policy: any; label: string; testId: string; children?: ReactNode }) {
  return (
    <div className="cpx-summary" data-testid={testId}>
      <small>{label}</small>
      <strong>{policySentence(policy)}</strong>
      {children}
      <NoEffectWarning policy={policy} testId={`${testId}-no-effect`} />
    </div>
  );
}

function Illustration({ p }: { p: PolicyFields }) {
  const adaptive = p.regime_response === "ADAPTIVE";
  const m = adaptive ? p.defensive_multiplier : 1;
  const risk = p.control_mode === "RISK_BUDGET";
  return (
    <div className="cpx-illus" data-testid="text-policy-illustration">
      <div><small>Calm market</small><strong>{limitText(p)}</strong></div>
      <span aria-hidden>→</span>
      <div><small>Full stress</small><strong>{limitText(p, m)}</strong></div>
      <p>
        {risk
          ? "The SPY or ETF weight is whatever fits this volatility ceiling given estimated training volatility (never above 100%). It is not a guaranteed minimum weight or loss limit."
          : "Investment may sit below this ceiling; the rest is cash. Cash return assumption: 0%."}
        {!risk && adaptive && p.defensive_multiplier === 0 && " A 100% stress reduction is valid: at full stress maximum invested exposure is 0% and cash is 100%."}
        {adaptive && " Between the endpoints the limit scales with the classifier's defensive score (HMM: high-volatility probability)."}
      </p>
    </div>
  );
}

export function PolicyEditor({
  value,
  onChange,
  idPrefix,
  classifierNote,
}: {
  value: PolicyFields;
  onChange: <K extends keyof PolicyFields>(key: K, v: PolicyFields[K]) => void;
  idPrefix: string;
  classifierNote?: string;
}) {
  const risk = value.control_mode === "RISK_BUDGET";
  const adaptive = value.regime_response === "ADAPTIVE";
  const num = (raw: string, scale = 100) => (raw === "" ? NaN : Number(raw) / scale);
  const limitKey = risk ? "risk_budget" : "maximum_exposure";
  const limit = value[limitKey];
  const classifier = (
    <label>
      Regime classifier
      <select
        aria-label="Regime classifier"
        data-testid={`${idPrefix}-select-regime-model`}
        value={value.regime_model}
        onChange={(e) => onChange("regime_model", e.target.value as PolicyFields["regime_model"])}
      >
        {Object.entries(models).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
      </select>
    </label>
  );
  return (
    <div className="cpx-editor">
      <div className="cpx-step">
        <small>1 · Limit</small>
        <label>
          {risk ? "Annualized volatility ceiling (%)" : "Maximum invested (%)"}
          <input
            type="number"
            min={risk ? 0.1 : 0}
            max={100}
            step={risk ? 0.1 : 1}
            data-testid={`${idPrefix}-input-limit`}
            value={finite(limit) ? limit * 100 : ""}
            onInput={(e) => onChange(limitKey, num(e.currentTarget.value))}
          />
        </label>
      </div>
      <div className="cpx-step">
        <small>2 · In stressed markets</small>
        <div className="cpx-seg" role="group" aria-label="Regime response">
          <button aria-pressed={!adaptive} data-testid={`${idPrefix}-button-response-fixed`} onClick={() => onChange("regime_response", "FIXED")}>Keep limit fixed</button>
          <button aria-pressed={adaptive} data-testid={`${idPrefix}-button-response-adaptive`} onClick={() => onChange("regime_response", "ADAPTIVE")}>Reduce limit</button>
        </div>
        {adaptive ? (
          <div className="cp-fields cpx-tight">
            <label>
              Reduction at full stress (%)
              <input
                type="number"
                min={0}
                max={risk && freqOf(value) !== "DAILY" ? 99.9 : 100}
                step={0.1}
                data-testid={`${idPrefix}-input-stress-reduction`}
                value={Number.isNaN(reductionPct(value.defensive_multiplier)) ? "" : reductionPct(value.defensive_multiplier)}
                onInput={(e) => {
                  const raw = e.currentTarget.value;
                  onChange("defensive_multiplier", raw === "" ? NaN : 1 - Number(raw) / 100);
                }}
              />
            </label>
          </div>
        ) : null}
        {adaptive && risk && freqOf(value) !== "DAILY" && value.defensive_multiplier <= 0.001 && (
          <div className="cpx-warn" role="alert" data-testid={`${idPrefix}-warning-reduction-rebalance`}>
            Rebalance dates only allows at most 99.9% reduction under a volatility ceiling. Lower the reduction or choose Daily; the value has not been changed.
          </div>
        )}
        {adaptive ? null : (
          <p className="cp-note">
            The classifier does not change the target{risk ? "; SPY weight can still move as estimated training volatility changes" : ""}.
          </p>
        )}
      </div>
      <div className="cpx-step" data-testid={`${idPrefix}-capital-frequency`}>
        <small>3 · Capital signal frequency</small>
        <div className="cpx-seg" role="group" aria-label="Capital signal frequency">
          <button aria-pressed={freqOf(value) === "REBALANCE_ONLY"} data-testid={`${idPrefix}-button-frequency-rebalance`} onClick={() => onChange("capital_signal_frequency", "REBALANCE_ONLY")}>Rebalance dates only</button>
          <button aria-pressed={freqOf(value) === "DAILY"} data-testid={`${idPrefix}-button-frequency-daily`} onClick={() => onChange("capital_signal_frequency", "DAILY")}>Daily</button>
        </div>
        <p className="cp-note" data-testid={`${idPrefix}-text-frequency-explanation`}>
          Each signal uses data through the previous close; any order fills at the next observed close after the signal day. The optimizer still runs only on monthly or quarterly dates.
          {freqOf(value) === "DAILY"
            ? " Daily: risky ETF target proportions stay frozen between optimizer dates; the daily signal only scales total allocation versus cash. Actual weights drift between fills."
            : " Rebalance dates only: exposure is set with each optimizer rebalance and then drifts with prices."}
        </p>
      </div>
      <Illustration p={value} />
      <NoEffectWarning policy={value} testId={`${idPrefix}-warning-no-effect`} />
      <details className="cp-advanced" data-testid={`${idPrefix}-details-rule-advanced`}>
        <summary data-testid={`${idPrefix}-text-rule-advanced-summary`}>
          Advanced rule settings · limit on {risk ? "estimated volatility" : "capital invested"} · {models[value.regime_model]}
        </summary>
        <div className="cpx-seg" role="group" aria-label="Capital control">
          <button aria-pressed={!risk} data-testid={`${idPrefix}-button-mode-exposure`} onClick={() => onChange("control_mode", "MAX_EXPOSURE")}>Capital invested</button>
          <button aria-pressed={risk} data-testid={`${idPrefix}-button-mode-risk`} onClick={() => onChange("control_mode", "RISK_BUDGET")}>Estimated volatility</button>
        </div>
        <div className="cp-fields cpx-tight">{classifier}</div>
        {!adaptive && <p className="cp-note">Classifier is diagnostics only while the limit is fixed.</p>}
      </details>
      {classifierNote && <p className="cp-note">{classifierNote}</p>}
    </div>
  );
}
