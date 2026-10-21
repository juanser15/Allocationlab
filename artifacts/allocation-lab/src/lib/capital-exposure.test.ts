import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { capabilitiesV2Schema, submissionV2Schema } from "./workbench-v2-api";
import {
  readStandardDesign,
  readDesign,
  emptyDesign,
  FIELD_LABELS,
} from "./workbench-designer-state";
const caps = capabilitiesV2Schema.parse(
  JSON.parse(
    readFileSync("reports/workbench01/phase-b3a/capabilities-v2.json", "utf8"),
  ),
);
const example = {
  ...emptyDesign(),
  evaluation_start: "2022-01-01",
  evaluation_end_exclusive: "2022-04-01",
  training_window_months: "24",
  rebalance_frequency: "MONTHLY",
  window_type: "ROLLING",
  transaction_cost_bps: "3.125",
};
test("Standard cost mapping is explicit, exact and distinct backend fields remain supported", () => {
  const p = readStandardDesign(example, caps);
  assert.equal(p.errors.length, 0);
  assert.equal(p.request?.transaction_cost_bps, 3.125);
  assert.equal(p.request?.selection_cost_bps, 3.125);
  assert.equal(Object.keys(p.request!).length, 12);
  const advanced = readDesign(
    { ...example, selection_cost_bps: "6.875" },
    caps,
  );
  assert.equal(advanced.request?.transaction_cost_bps, 3.125);
  assert.equal(advanced.request?.selection_cost_bps, 6.875);
  assert.equal(submissionV2Schema.safeParse(advanced.request).success, true);
});
test("No silent defaults and no duplicate hidden cost validation in the standard form", () => {
  const empty = readStandardDesign(emptyDesign(), caps);
  assert.equal(empty.request, undefined);
  assert.equal(
    Object.values(emptyDesign()).every((v) => v === ""),
    true,
  );
  assert.equal(
    empty.errors.some((e) => e.startsWith(FIELD_LABELS.selection_cost_bps)),
    false,
  );
  for (const cost of ["NaN", "Infinity", "-1", ""])
    assert.equal(
      readStandardDesign({ ...example, transaction_cost_bps: cost }, caps)
        .request,
      undefined,
    );
});
test("Primary copy has a backtest period and one cost; no engine documentation panel", () => {
  const source = readFileSync(
    "artifacts/allocation-lab/src/pages/workbench-designer.tsx",
    "utf8",
  ).replace(/\s+/g, " ");
  assert.equal(FIELD_LABELS.evaluation_start, "From");
  assert.equal(FIELD_LABELS.evaluation_end_exclusive, "To");
  assert.match(source, /<legend>Backtest Period<\/legend>/);
  assert.match(source, /field\("transaction_cost_bps"\)/);
  assert.doesNotMatch(
    source,
    /field\("selection_cost_bps"\)|Available empirical data|Out-of-Sample Start|Out-of-Sample End|Model-Selection Cost/,
  );
  assert.match(source, /Data available:/);
  assert.match(source, /c\.data_first_observation/);
  assert.match(source, /c\.data_last_observation/);
  assert.match(source, /RUN BACKTEST/);
  assert.doesNotMatch(source, /RUN RESEARCH/);
  assert.match(source, /This stage tests SPY versus cash exposure/);
  assert.match(source, /does not allocate capital among ETFs/);
});
test("Model transparency and result attribution are backend-driven, without frontend financial formulas", () => {
  const source = readFileSync(
    "artifacts/allocation-lab/src/pages/capital-exposure-results.tsx",
    "utf8",
  );
  assert.match(source, /model\.components\.map/);
  assert.match(source, /model\.candidate_policy_set\.map/);
  assert.match(source, /model\.regime_thresholds/);
  assert.match(source, /model\.limitation/);
  assert.match(source, /r\.benchmark_metrics/);
  assert.match(source, /r\.attribution/);
  assert.doesNotMatch(
    source,
    /Math\.pow|Math\.sqrt|covariance\(|regression\(|market_return\s*\*/,
  );
  assert.match(
    source.replace(/\s+/g, " "),
    /diagnostic benchmark, not an ex-ante investable strategy/,
  );
  assert.match(
    source.replace(/\s+/g, " "),
    /positive timing residual is not automatically statistical alpha/,
  );
});
