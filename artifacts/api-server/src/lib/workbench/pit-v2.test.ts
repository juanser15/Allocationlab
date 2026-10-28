import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { campaignV2, loadDatasetV2, parseSubmissionV2, SPEC_V2 } from "./calendar-v2";

const { runCampaign } = require("../../../../../research/capital/engine") as { runCampaign: (...args: any[]) => any };
const { defaultRegistry } = require("../../../../../research/capital/registry") as { defaultRegistry: () => any };

test("V2 PIT: model contexts exclude future data; later folds may train on earlier OOS; future mutations preserve prior fits/selections", {
  skip: process.env.WORKBENCH_B3A_PIT !== "1", timeout: 180000,
}, () => {
  const dataset = loadDatasetV2();
  const spec = parseSubmissionV2({ contract_version: SPEC_V2, research_mode: "CAPITAL_MARKET_EXPOSURE", execution_scope: "EMPIRICAL", universe: "SPY", validation_protocol: "TRADITIONAL_WALK_FORWARD",
    evaluation_start: "2022-01-01", evaluation_end_exclusive: "2022-03-01", training_window_months: 18, window_type: "ROLLING", rebalance_frequency: "MONTHLY", transaction_cost_bps: 0, selection_cost_bps: 0 });
  const campaign = campaignV2(spec, dataset);
  const fits: any[] = [], predictions: any[] = [];
  const registry = defaultRegistry(); const model = registry.models.get("current_regime");
  registry.models.set("current_regime", { ...model,
    fit(modelSpec: any, context: any) {
      assert.ok(context.rows.every((row: any) => row.date >= context.training_start && row.date < context.training_end && row.date <= context.information_cutoff));
      fits.push({ start: context.training_start, end: context.training_end, dates: context.rows.map((row: any) => row.date), cutoff: context.information_cutoff });
      return model.fit(modelSpec, context);
    },
    predict(modelSpec: any, fitted: any, context: any) {
      assert.ok(context.history.every((row: any) => row.date <= context.information_cutoff));
      predictions.push({ cutoff: context.information_cutoff, last: context.history.at(-1)?.date });
      return model.predict(modelSpec, fitted, context);
    },
  });
  const before = mkdtempSync(join(tmpdir(), "b3a-pit-before-")), after = mkdtempSync(join(tmpdir(), "b3a-pit-after-"));
  try {
    const original = runCampaign(campaign, dataset.rows, before, { registry, code_hash: dataset.code_version });
    assert.equal(original.summary.status, "COMPLETE");
    const finalFirst = fits.find(context => context.end === "2022-01-01");
    const finalSecond = fits.find(context => context.end === "2022-02-01");
    assert.ok(finalFirst && finalSecond);
    assert.ok(finalFirst.dates.every((date: string) => date < spec.evaluation_start));
    assert.ok(finalSecond.dates.some((date: string) => date >= "2022-01-01" && date < "2022-02-01"), "Earlier OOS becomes legal historical training for the next fold");
    const mutated = structuredClone(dataset.rows);
    mutated.filter(row => row.date >= "2022-02-01").forEach(row => { for (const ticker of Object.keys(row.prices)) row.prices[ticker] *= 1.4; });
    const changed = runCampaign(campaign, mutated, after, { code_hash: dataset.code_version });
    assert.equal(changed.summary.status, "COMPLETE");
    assert.deepEqual(changed.summary.selected_by_fold, original.summary.selected_by_fold, "Post-cutoff mutation cannot change either historical selection");
    const keys = readdirSync(join(before, "cache/fits"));
    for (const key of keys) assert.equal(readFileSync(join(before, "cache/fits", key), "utf8"), readFileSync(join(after, "cache/fits", key), "utf8"));
    writeFileSync("/tmp/workbench-b3a-pit.json", JSON.stringify({ status: "PASS", actual_historical_data: true, fit_contexts_checked: fits.length,
      prediction_contexts_checked: predictions.length, first_fold_uses_no_own_oos_for_fit: true, second_fold_can_use_prior_oos: true,
      post_cutoff_mutation_start: "2022-02-01", unchanged_historical_selections: true, unchanged_fit_artifacts: keys.length,
      model: "STATELESS_PRODUCTION_REGIME", data_vintage_label: "PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED" }, null, 2) + "\n");
  } finally { rmSync(before, { recursive: true, force: true }); rmSync(after, { recursive: true, force: true }); }
});
