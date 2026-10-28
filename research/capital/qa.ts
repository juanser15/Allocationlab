// QA-only synthetic fixtures. Never added to the real financial registry.
import { defaultRegistry, type FitContext } from "./registry";
import { hash, type Campaign, type CandidateSpec } from "./spec";
import type { PriceRow } from "../../artifacts/api-server/src/lib/calculator";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
export const qaSpec: CandidateSpec = { model_family: "qa_observable", input_set: ["SIGNAL", "A", "B"],
  transformations: [{ name: "identity" }], model_parameters: { kind: "neutral" },
  exposure_policy: "constant", exposure_parameters: { risk: .5 }, rebalance_frequency: "monthly", recalibration_frequency: "monthly" };
export function qaCampaign(changes: Partial<Campaign> = {}): Campaign {
  return { experiment_id: "cl04-synthetic", validation_mode: "nested", window_type: "rolling",
    dates: { start: "2020-01-01", end_exclusive: "2020-05-01" }, train_months: 3, test_months: 1, step_months: 1,
    inner_train_months: 2, inner_test_months: 1, inner_step_months: 1,
    rebalance_frequency: "monthly", recalibration_frequency: "monthly", search_method: "grid", candidate_budget: 200,
    candidate_space: [{ base: qaSpec, axes: { "exposure_parameters.risk": [.25, .5, 1] } }],
    selection_metric: "cagr", constraints: {}, transaction_cost_bps: [0, 5], selection_cost_bps: 5,
    cash_yield: { type: "constant", daily: 0, reference_daily: 0 }, risk_asset: "R", reference_universe: ["SIGNAL", "A", "B"],
    data_csv: "SYNTHETIC", data_sha256: "SYNTHETIC", data_provenance: "CL04 QA, deterministic synthetic observations", warmup_rows: 2, max_jobs: 1000, ...changes };
}
export function qaData(months = 16, returns: (month: number) => number = () => .02): PriceRow[] {
  const result: PriceRow[] = []; let price = 100;
  for (let month = 0; month < months; month++) {
    const first = new Date(Date.UTC(2020, month, 1)); let t = +first;
    const dates: string[] = [];
    while (dates.length < 3) {
      const d = new Date(t); if (![0, 6].includes(d.getUTCDay())) dates.push(d.toISOString().slice(0, 10)); t += 86400000;
    }
    dates.forEach((date, i) => {
      if (i === 2) price *= 1 + returns(month);
      const next = i === 2 ? month + 1 : month;
      const up = returns(next) > 0;
      result.push({ date, prices: { R: price, SIGNAL: up ? 200 : 50, A: up ? 200 : 50, B: up ? 50 : 200 } });
    });
  }
  return result;
}
export function qaRegistry(fits: FitContext[] = []) {
  return defaultRegistry().model("qa_observable", {
    version: "qa-only-1",
    validate() {},
    fit(spec, ctx) {
      fits.push(structuredClone(ctx));
      if (spec.model_parameters.kind === "fit_failure") throw new Error("QA deliberate fit failure");
      if (spec.model_parameters.kind === "mutate_spec") (spec.model_parameters as any).forbidden = true;
      if (spec.model_parameters.kind === "check_projection" && ("exposure_policy" in spec || "exposure_parameters" in spec)) throw new Error("Policy data leaked into model");
      const values = ctx.rows.map(r => r.prices.SIGNAL);
      return { mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 100, n: values.length };
    },
    predict(spec, fitted: any, ctx) {
      if (spec.model_parameters.kind === "prediction_failure") throw new Error("QA deliberate prediction failure");
      if (spec.model_parameters.kind === "leaky") {
        const future = ctx.history.find(r => r.date > ctx.information_cutoff);
        if (!future) throw new Error("QA future observation unavailable");
        return { score: future.prices.SIGNAL / 200 };
      }
      const last = ctx.history.at(-1)!;
      if (spec.model_parameters.kind === "perfect") return { score: last.prices.SIGNAL > 100 ? 1 : 0 };
      if (spec.model_parameters.kind === "indicator") return { score: last.prices[String(spec.model_parameters.indicator)] > 100 ? 1 : 0 };
      return { score: .5, state: { normalized_observable: last.prices.SIGNAL / fitted.mean } };
    },
  });
}
export const files = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(path, e.name)) : [join(path, e.name)]);
export const jobs = (root: string): any[] => files(root + "/jobs").filter(p => p.endsWith(".json")).map(p => JSON.parse(readFileSync(p, "utf8")).result);
export const shaFile = (path: string) => hash(readFileSync(path, "utf8"));
