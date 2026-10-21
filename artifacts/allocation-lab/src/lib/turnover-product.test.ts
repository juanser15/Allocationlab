import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FailureNotice } from "../pages/workbench-failure-notice";
import { RecurringTurnoverWarning } from "../pages/capital-exposure-results";
import { readStandardDesign, emptyDesign } from "./workbench-designer-state";
import { capabilitiesV2Schema, PRODUCT_SPEC, RECURRING_V2 } from "./workbench-v2-api";
const caps = capabilitiesV2Schema.parse({ ...JSON.parse(readFileSync("reports/workbench01/phase-b3a/capabilities-v2.json", "utf8")),
  supported_spec_version: PRODUCT_SPEC, turnover_constraint_methodology_version: RECURRING_V2 });
test("no recurring change is explained as uninformative, never established low turnover", () => {
  const html = renderToStaticMarkup(createElement(RecurringTurnoverWarning,{warnings:["NO_RECURRING_REBALANCE_OBSERVED"]}));
  assert.match(html,/not informative/); assert.match(html,/does not establish low turnover/);
  assert.equal(renderToStaticMarkup(createElement(RecurringTurnoverWarning,{warnings:[]})),"");
});
test("ordinary design explicitly binds fixed V2 methodology, keeps one cost and has no new financial defaults", () => {
  assert.ok(Object.values(emptyDesign()).every(v => v === ""));
  const form = { ...emptyDesign(), evaluation_start: "2022-01-01", evaluation_end_exclusive: "2022-04-01", window_type: "ROLLING",
    training_window_months: "6", rebalance_frequency: "MONTHLY", transaction_cost_bps: "3.125" };
  const p = readStandardDesign(form,caps); assert.deepEqual(p.errors, []);
  assert.equal(p.request?.contract_version, PRODUCT_SPEC); assert.equal(p.request?.turnover_constraint_methodology_version, RECURRING_V2);
  assert.equal(p.request?.transaction_cost_bps, 3.125); assert.equal(p.request?.selection_cost_bps, 3.125);
  const source = readFileSync("artifacts/allocation-lab/src/pages/workbench-designer.tsx","utf8");
  assert.doesNotMatch(source, /field\("(?:selection_cost_bps|turnover_constraint_methodology_version)"\)/);
  assert.doesNotMatch(source, /onClick=.*(?:broker|placeOrder|authorizeCapital)|\/api\/(?:broker|order|trade)/i);
});
test("capacity failure has a concise primary explanation and collapsed technical evidence", () => {
  const failure = { error_class: "INTERACTIVE_EXECUTION_CAPACITY_EXCEEDED", failed_stage: "EXECUTION_CAPACITY_PREFLIGHT", failed_fold_id: null,
    failed_decision_date: null, safe_message: "This backtest is larger than the current interactive execution capacity: 4,067 estimated tasks versus a 2,000-task limit.",
    actionable_explanation: "This design is financially valid enough to plan, but exceeds current interactive execution capacity.",
    suggested_user_action: "Ask the preview owner about extended-run capacity, or explicitly preview a smaller design.", diagnostic_reference: "PRE_RUN_NO_ATTEMPT_CREATED",
    capacity: { number_of_folds: 84, estimated_jobs: 4067, maximum_jobs: 2000, minimum_required_engine_files: 8500, maximum_engine_files: 512, no_attempt_created: true } };
  const html = renderToStaticMarkup(createElement(FailureNotice,{failure}));
  const primary = html.split('<details')[0];
  assert.match(primary,/current execution capacity/); assert.match(primary,/4,067/); assert.match(primary,/2,000/);
  assert.match(primary,/No execution attempt was created/); assert.match(primary,/Next action/);
  assert.doesNotMatch(primary,/INTERACTIVE_EXECUTION_CAPACITY_EXCEEDED|failed stage|candidate_id/);
  assert.match(html,/SHOW TECHNICAL DETAILS/); assert.doesNotMatch(html,/<details[^>]*\bopen(?:=|>)/);
  assert.match(html,/maximum engine files/); assert.match(html,/number of folds/);
});
test("candidate failures hide candidate details initially, and model details stay under expansion", () => {
  const f = { error_class: "NO_VALID_CANDIDATE", failed_stage: "CANDIDATE_SELECTION", failed_fold_id: 0, failed_decision_date: "2020-01-02",
    safe_message: "No exposure policy satisfied the recurring-turnover constraint in the first training window.", actionable_explanation: "Exact candidate evidence is retained.",
    suggested_user_action: "Review constraints.", diagnostic_reference: "PRE_RUN_NO_ATTEMPT_CREATED",
    candidates: [{ exposure_policy: "constant", parameters: { risk: 1 }, annualized_turnover: 12, maximum_annualized_turnover: 8 }] };
  const html = renderToStaticMarkup(createElement(FailureNotice,{failure:f}));
  assert.doesNotMatch(html.split('<details')[0],/Constant SPY|NO_VALID_CANDIDATE|Fold 0/);
  assert.match(html,/Constant SPY/); assert.match(html,/SHOW TECHNICAL DETAILS/);
  const source = readFileSync("artifacts/allocation-lab/src/pages/capital-exposure-results.tsx","utf8");
  const primary = source.split('<summary>How the exposure rule works</summary>')[0];
  assert.match(primary,/Turnover rule/); assert.doesNotMatch(primary,/model\.components\.map|model\.candidate_policy_set\.map/);
  assert.match(source,/model\.components\.map/); assert.match(source,/Recurring turnover/); assert.match(source,/Total turnover/); assert.match(source,/Initial implementation/);
});
