/**
 * Opt-in structural quality policy. Uses existing feature/rank/eigen routines;
 * it is not a return forecast, optimizer, or certification of economic value.
 */
import { assetFeatures } from "./forecasts";
import { spearman } from "../../artifacts/api-server/src/lib/allocation-core/gates/signal";
import { eigen } from "../../artifacts/api-server/src/lib/allocation-core/assets-engine/numerics";
import { canonicalJson } from "../../artifacts/api-server/src/lib/workbench/identity";
import { sha256, CalendarContractError } from "../../artifacts/api-server/src/lib/workbench/calendar-v2";
import { DEFAULT_FORECAST, type ResearchSubmission } from "../../artifacts/api-server/src/lib/workbench/coordinated-contract";
import type { PriceRow } from "../../artifacts/api-server/src/lib/calculator";
import { STRUCTURAL_POLICY, QUALITY_POLICY_HASH } from "../../artifacts/api-server/src/lib/workbench/quality-policy";
export { STRUCTURAL_POLICY, QUALITY_POLICY_HASH };
export interface QualityContext {
  request: ResearchSubmission;
  fold: { decision_date: string; information_cutoff: string; training_start: string; fold_id: string };
  training: PriceRow[];
  assets: string[];
  forecast: any;
}
interface Snapshot { cutoff: string; source_start: string; scores: Record<string, number>; }
export type QualityDecision = ReturnType<typeof evaluateQuality>;
// Invalid source values remain invalid and blocking. A typed marker permits an
// audit hash of the rejected input without replacing it with a usable price.
function auditValue(value: any): any {
  if (typeof value === "number" && !Number.isFinite(value)) return { rejected_number: String(value) };
  if (value === undefined) return { rejected_value: "undefined" };
  if (Array.isArray(value)) return value.map(auditValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, auditValue(v)]));
  return value;
}

export function evaluateQuality(context: QualityContext, enabled: boolean, history: Snapshot[] = []) {
  const { request, fold, training, assets, forecast } = context;
  const blocking: string[] = [], warnings: string[] = [], notes: string[] = [];
  const validCalendar = training.length > 0 && !training.some((r, i) => r.date < fold.training_start || r.date > fold.information_cutoff || r.date >= fold.decision_date || (i > 0 && training[i - 1].date >= r.date)) && training.at(-1)?.date === fold.information_cutoff;
  if (!validCalendar ||
    training.at(-1)?.date !== fold.information_cutoff)
    blocking.push("Training observations must be inside the declared window and available strictly before the decision.");
  if (new Set(assets).size !== assets.length || assets.length === 0) blocking.push("A distinct nonempty decision universe is required.");
  const valid = assets.filter(t => training.length > 0 && training.every(r => Number.isFinite(r.prices[t]) && r.prices[t] > 0));
  const stale = assets.filter(t => !(Number.isFinite(training.at(-1)?.prices[t]) && training.at(-1)!.prices[t] > 0));
  const minimumHistory = assets.length ? Math.min(...assets.map(t => training.filter(r => Number.isFinite(r.prices[t]) && r.prices[t] > 0).length)) : 0;
  const coverage = assets.length ? valid.length / assets.length : 0;
  if (coverage !== STRUCTURAL_POLICY.coverage) blocking.push("Every selected asset requires finite positive prices throughout the training window; no missing value was filled.");
  const config = request.research_scope === "CAPITAL_EXPOSURE" ? DEFAULT_FORECAST : request.forecast ?? DEFAULT_FORECAST;
  const usesSignals = config.model !== "HISTORICAL_MEAN";
  const maxFeatureHistory = usesSignals ? Math.max(0, ...config.signals.filter(s => s.enabled).map(s => s.lookback_sessions + s.skip_sessions)) : 0;
  // Bound the dependency of a historical score, not merely its publication date.
  // Ridge includes the earliest fit feature, its lookback and a conservative
  // two-session alignment margin; it cannot import an older fit into this window.
  const fitIndex = forecast?.training?.start ? training.findIndex(r => r.date >= forecast.training.start) : training.length - 1;
  const dependencyIndex = config.model === "SIGNAL_RIDGE" ? Math.max(0, fitIndex - maxFeatureHistory - 2) : Math.max(0, training.length - 1 - maxFeatureHistory);
  const scoreSourceStart = training[dependencyIndex]?.date ?? fold.training_start;
  const scores: Record<string, number> = {};
  for (const t of assets) {
    const candidates = forecast?.predictions?.filter((p: any) => p.ticker === t) ?? [];
    const p = candidates[0], value = config.model === "MANUAL_SCORE" ? p?.score : p?.expected_return;
    if (candidates.length !== 1 || typeof value !== "number" || !Number.isFinite(value))
      blocking.push(`Missing or invalid current ${usesSignals ? "signal forecast" : "asset-return estimate"} for ${t}.`);
    else scores[t] = value;
  }
  const values = assets.filter(t => Object.hasOwn(scores, t)).map(t => scores[t]);
  const mean = values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
  const dispersion = values.length >= 2 ? Math.sqrt(values.reduce((s, v) => s + (v - mean!) ** 2, 0) / (values.length - 1)) : null;
  if (usesSignals && assets.length >= 2 && values.length === assets.length && values.every(v => v === values[0]))
    blocking.push("The cross-sectional signal ranking is constant: it cannot distinguish the selected assets.");
  if (!usesSignals) notes.push("Direct asset-return estimation: signal PCA and rank stability are not applicable.");
  if (usesSignals && assets.length < 2) notes.push("Single asset: cross-sectional dispersion and rank stability are not applicable.");
  let pc1: number | null = null, effectiveRank: number | null = null;
  let pcaStatus = usesSignals ? "INSUFFICIENT_DATA" : "NOT_APPLICABLE_DIRECT_ASSET_RETURNS";
  if (usesSignals && validCalendar && valid.length === assets.length && assets.length >= 2) {
    try {
      const features = assetFeatures(training, training.length - 1, assets, config.signals.filter(s => s.enabled));
      const k = features[0].length, n = features.length;
      const centers = Array.from({ length: k }, (_, j) => features.reduce((s, row) => s + row[j], 0) / n);
      const scales = centers.map((mu, j) => Math.sqrt(features.reduce((s, row) => s + (row[j] - mu) ** 2, 0) / (n - 1)));
      // Constant columns carry zero cross-sectional variance, not fabricated noise.
      const z = features.map(row => row.map((v, j) => scales[j] > 0 ? (v - centers[j]) / scales[j] : 0));
      const covariance = centers.map((_, i) => centers.map((_, j) => z.reduce((s, row) => s + row[i] * row[j], 0) / (n - 1)));
      const e = eigen(covariance);
      if (!e.converged) { pcaStatus = "NUMERICAL_FAILURE"; warnings.push("Optional signal PCA did not converge; no blocking economic threshold was applied."); }
      else {
        const positive = e.values.map(v => Math.max(0, v)), total = positive.reduce((s, v) => s + v, 0);
        if (total > 0) {
          const p = positive.map(v => v / total);
          pc1 = p[0]; effectiveRank = Math.exp(-p.reduce((s, v) => s + (v > 0 ? v * Math.log(v) : 0), 0));
          pcaStatus = "DIAGNOSTIC_ONLY";
        } else { pcaStatus = "ZERO_VARIANCE"; warnings.push("Signal feature matrix has no cross-sectional variance."); }
      }
    } catch (error) {
      // Feature-history failure is explicit; no alternate factor set is used.
      pcaStatus = "UNAVAILABLE";
      warnings.push(`Optional signal PCA unavailable: ${error instanceof Error ? error.message : "feature input error"}`);
    }
  }
  const relevant = usesSignals ? history.filter(h => h.source_start >= fold.training_start && h.source_start <= h.cutoff && h.cutoff < fold.information_cutoff).sort((a, b) => a.cutoff.localeCompare(b.cutoff)).slice(-3) : [];
  const correlations = relevant.map(h => {
    const ids = assets.filter(t => Object.hasOwn(scores, t) && Object.hasOwn(h.scores, t));
    return ids.length === assets.length && ids.length >= 2 ? spearman(ids.map(t => scores[t]), ids.map(t => h.scores[t])) : null;
  }).filter((v): v is number => v !== null);
  const stability = correlations.length ? correlations.reduce((s, v) => s + v, 0) / correlations.length : null;
  if (usesSignals && !correlations.length) notes.push("No usable previous ranking within this training window; rank stability is unavailable, not zero.");
  if (stability !== null && stability < 0) warnings.push("Current ranking reverses previous in-window rankings (negative mean Spearman); diagnostic warning only.");
  const wouldBlock = blocking.length > 0;
  const status = !enabled ? "OFF_OBSERVE_ONLY" as const : wouldBlock ? "BLOCKED" as const : warnings.length ? "WARN" as const : "PASS" as const;
  return {
    decision_date: fold.decision_date, information_cutoff: fold.information_cutoff, training_start: fold.training_start,
    training_end_inclusive: fold.information_cutoff, observations: training.length, universe: [...assets],
    enabled, policy_version: STRUCTURAL_POLICY.version, policy_hash: QUALITY_POLICY_HASH,
    status, would_block: wouldBlock, blocking_reasons: blocking, warnings, notes,
    forecast_model: config.model, score_units: config.model === "MANUAL_SCORE" ? "UNIT_FREE_SELECTION_SCORE" : "ARITHMETIC_HOLDING_RETURN_NOT_PERFORMANCE_ALPHA",
    metrics: { eligible_count: assets.length, valid_count: valid.length, coverage, missing_fraction: 1 - coverage, stale_count: stale.length, minimum_history: minimumHistory, dispersion, pc1_share: pc1, signal_effective_rank: effectiveRank, rank_stability: stability, rank_history_count: correlations.length },
    pca_status: pcaStatus, scores, score_source_start: scoreSourceStart,
    historical_rankings_used: relevant.map(h => ({ information_cutoff: h.cutoff, score_source_start: h.source_start })),
    input_hash: sha256(canonicalJson(auditValue({ rows: training, assets, forecast, historical_rankings: relevant, policy: QUALITY_POLICY_HASH }))),
    predictive_quality: STRUCTURAL_POLICY.predictive_quality,
  };
}

export function qualityObserver(enabled: boolean) {
  const decisions: QualityDecision[] = [], history: Snapshot[] = [];
  return {
    decisions,
    observe(context: QualityContext) {
      const decision = evaluateQuality(context, enabled, history);
      decisions.push(decision);
      if (decision.enabled && decision.would_block)
        throw new CalendarContractError("QUALITY_GATE_BLOCKED", "Quality Control rejected this rebalance. No alternate portfolio, cash target or complete-period performance was substituted.", { fold_id: context.fold.fold_id, decision_date: decision.decision_date, gate_evidence: decision, completed_quality_decisions: decisions }, 422);
      history.push({ cutoff: context.fold.information_cutoff, source_start: decision.score_source_start, scores: decision.scores });
      return decision;
    },
  };
}
