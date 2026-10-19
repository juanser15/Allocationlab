import { computeRegime, type PriceRow } from "../../artifacts/api-server/src/lib/calculator";
import type { CandidateSpec } from "./spec";
import { immutable } from "./storage";
export type ModelSpec = Pick<CandidateSpec, "model_family" | "input_set" | "transformations" | "model_parameters">;
export function modelSpec(spec: CandidateSpec): ModelSpec {
  return immutable(structuredClone({ model_family: spec.model_family, input_set: spec.input_set,
    transformations: spec.transformations, model_parameters: spec.model_parameters }));
}
export interface MarketOutput { state?: unknown; score?: number; forecast?: number; probabilities?: Record<string, number>; }
export interface FitContext { rows: readonly PriceRow[]; input_set: readonly string[]; training_start: string; training_end: string; information_cutoff: string; }
export interface PredictContext { history: readonly PriceRow[]; input_set: readonly string[]; information_cutoff: string; }
export interface ModelFamily {
  version: string;
  validate(spec: ModelSpec): void;
  fit(spec: ModelSpec, context: FitContext): unknown;
  predict(spec: ModelSpec, fitted: unknown, context: PredictContext): MarketOutput;
}
export interface ExposurePolicy { version: string; validate(parameters: Record<string, unknown>): void; map(output: MarketOutput, parameters: Record<string, unknown>): number; }
export class Registry {
  models = new Map<string, ModelFamily>(); policies = new Map<string, ExposurePolicy>();
  model(name: string, definition: ModelFamily) { if (this.models.has(name)) throw new Error("Duplicate model"); this.models.set(name, definition); return this; }
  policy(name: string, definition: ExposurePolicy) { if (this.policies.has(name)) throw new Error("Duplicate policy"); this.policies.set(name, definition); return this; }
  validate(spec: CandidateSpec) {
    const model = this.models.get(spec.model_family), policy = this.policies.get(spec.exposure_policy);
    if (!model || !policy) throw new Error("Unregistered model/policy");
    if (!["monthly", "quarterly"].includes(spec.rebalance_frequency) || !["monthly", "quarterly", "yearly", "once"].includes(spec.recalibration_frequency)) throw new Error("Unsupported independent clock");
    if (!spec.input_set.length || new Set(spec.input_set).size !== spec.input_set.length) throw new Error("Invalid input_set");
    model.validate(modelSpec(spec)); policy.validate(immutable(structuredClone(spec.exposure_parameters)));
  }
  versions() { return { models: Object.fromEntries([...this.models].map(([k, v]) => [k, v.version])), policies: Object.fromEntries([...this.policies].map(([k, v]) => [k, v.version])) }; }
}
export function defaultRegistry() {
  return new Registry().model("current_regime", {
    version: "production-regime-adapter-1",
    validate(spec) {
      if (spec.transformations.some(t => t.name !== "identity" || Object.keys(t.parameters ?? {}).length)) throw new Error("Only identity transformation registered in v1");
      const lookback = Number(spec.model_parameters.lookback_rows ?? 252);
      if (!Number.isInteger(lookback) || lookback < 200) throw new Error("Regime requires >=200 history rows");
      if (Object.keys(spec.model_parameters).some(k => k !== "lookback_rows")) throw new Error("Unknown regime parameter");
    },
    // Current production regime is stateless: no learned estimator is invented.
    fit() { return { estimator: "stateless production computeRegime" }; },
    predict(spec, _fitted, ctx) {
      const history = [...ctx.history].slice(-Number(spec.model_parameters.lookback_rows ?? 252));
      if (history.length < 200 || history.some(r => ctx.input_set.some(t => !Number.isFinite(r.prices[t]) || r.prices[t] <= 0))) throw new Error("Incomplete regime information history");
      const state = computeRegime(history, [...ctx.input_set]);
      return { state, score: state.composite / 100 };
    },
  }).policy("cash_band", {
    version: "current-cash-policy-1",
    validate(p) { const a = p.cash_min, b = p.cash_max; if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b) || a < 0 || a > b || b > 1 || Object.keys(p).some(k => !["cash_min", "cash_max"].includes(k))) throw new Error("Invalid cash band"); },
    map(output, p) {
      if (!Number.isFinite(output.score)) throw new Error("Policy requires finite score");
      const a = p.cash_min as number, b = p.cash_max as number;
      // Exact existing cash expression, separated from ETF construction.
      const cash = Math.max(a, Math.min(b, a + (b - a) * .5 + ((50 - output.score! * 100) / 50) * (b - a) * .5));
      return 1 - cash;
    },
  }).policy("constant", {
    version: "fixed-risk-policy-1",
    validate(p) { if (typeof p.risk !== "number" || !Number.isFinite(p.risk) || p.risk < 0 || p.risk > 1 || Object.keys(p).some(k => k !== "risk")) throw new Error("Invalid constant risk"); },
    map(_output, p) { return p.risk as number; },
  });
}
