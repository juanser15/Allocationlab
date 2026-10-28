import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { readExecutionCapacity, DEFAULT_EXECUTION_CAPACITY } from "./execution-capacity";
import { PRODUCT_SPEC, RECURRING_V2, TOTAL_V1, productPlan, normalizeProduct, productRunId, parseProductSubmission, productCampaign } from "./turnover-product";
import { loadDatasetV2, normalizedSpecV2, runIdV2, CalendarContractError } from "./calendar-v2";
import { validatedWorkbenchPlan } from "./design-preflight";
import { versionedSpecDifferences } from "./turnover-comparison";
const { ledgerTurnover, turnoverConstraint, selectRecurring } = require("../../../../../research/workbench/turnover-selection") as any;
const { select } = require("../../../../../research/capital/metrics") as any;
const data = loadDatasetV2();
const legacy = JSON.parse(readFileSync("reports/workbench01/phase-b3c1/exact-84-fold-acceptance.json", "utf8"));
const exact = { ...legacy.exact_request, contract_version: PRODUCT_SPEC, turnover_constraint_methodology_version: RECURRING_V2 };
const small = { ...exact, evaluation_end_exclusive: "2019-11-01" };
test("versioned orchestration preserves the exact certified ledger/fit/PIT and OOS aggregation code", () => {
  const old = readFileSync("research/capital/engine.ts", "utf8"), current = readFileSync("research/workbench/recurring-turnover-engine.ts", "utf8");
  const section = (s: string, from: string, to?: string) => s.slice(s.indexOf(from), to ? s.indexOf(to, s.indexOf(from)) : undefined);
  assert.equal(section(current, "  const fit =", "  try {\n    for (const outer"), section(old, "  const fit =", "  try {\n    for (const outer"));
  assert.equal(section(current, "  const ledgerRecords:"), section(old, "  const ledgerRecords:"));
});
function ledger(fills: number[], bps = 1) {
  return [...fills,...Array(Math.max(0,20-fills.length)).fill(0)].map((notional, i) => ({ date: `2020-01-${String(i + 1).padStart(2,"0")}`, beginningNav: 100, etfPnl: 0, cashPnl: 0,
    transactionCosts: Math.abs(notional) * bps / 10000, trades: notional ? [{ notional }] : [] }));
}
test("ledger decomposition identifies actual implementation once, preserves all costs and the full denominator", () => {
  const d = ledgerTurnover(ledger([0, 80, -20, 10]), 20, 1);
  assert.equal(d.initial_implementation_turnover, .8);
  assert.ok(Math.abs(d.recurring_gross_turnover - .3) < 1e-14);
  assert.ok(Math.abs(d.total_gross_turnover - 1.1) < 1e-14);
  assert.ok(Math.abs(d.annualized_recurring_turnover - .3 * 252 / 20) < 1e-14);
  assert.equal(d.annualized_total_turnover, d.total_gross_turnover * 252 / 20);
  assert.equal(d.initial_implementation_cost, .008);
  assert.ok(Math.abs(d.realized_simulated_cost - d.initial_implementation_cost - d.recurring_simulated_cost) < 1e-14);
  assert.equal(d.annualization_observations, 20);
  assert.equal(d.initial_implementation_date, "2020-01-02");
});
test("no later trade is a non-blocking warning, never evidence of demonstrated low turnover", () => {
  const d = ledgerTurnover(ledger([0,100,0]), 20, 1);
  assert.equal(d.recurring_gross_turnover, 0); assert.equal(d.annualized_recurring_turnover, 0);
  assert.deepEqual(d.warnings, ["NO_RECURRING_REBALANCE_OBSERVED"]);
  assert.match(d.recurring_turnover_interpretation, /not informative/);
  assert.equal(turnoverConstraint(d, 8, RECURRING_V2).turnover_constraint_status, "ELIGIBLE");
  assert.equal(turnoverConstraint(d, 8, TOTAL_V1).turnover_constraint_status, "CONSTRAINT_REJECTED");
});
function selectionFixture(fills: number[]) {
  const l = ledger(fills), d = ledgerTurnover(l, 20, 1);
  const candidate = { candidate_id: "synthetic-accounting-test-only", spec: {} };
  const metrics = { observations: 20, net_sharpe: 1, cagr: .1, max_drawdown: -.1, turnover: d.total_gross_turnover,
    turnover_annualized: d.annualized_total_turnover, exposure: .5, costs: d.realized_simulated_cost };
  const ranked = [{ candidate, metrics, status: "VALID", complexity: 0 }];
  const job = { candidate_id: candidate.candidate_id, outer_fold: 0, stage: "train", scenario: 1, status: "VALID", ledger: l, observations: Array(20).fill({}) };
  const campaign = { selection_metric: "net_sharpe", selection_cost_bps: 1, constraints: { max_turnover: 8, max_drawdown: .6, min_exposure: 0, max_exposure: 1 } };
  return { campaign, ranked, job };
}
test("V2 excludes only initial numerator; V1 exact select remains rejected; high recurring turnover still rejects", () => {
  const a = selectionFixture([100]);
  assert.equal(select(a.campaign, a.ranked).winner, undefined);
  assert.ok(selectRecurring(a.campaign, a.ranked, [a.job], 0).winner);
  const high = selectionFixture([80,-80,80]);
  const rejected = selectRecurring(high.campaign, high.ranked, [high.job], 0);
  assert.equal(rejected.winner, undefined);
  assert.ok(rejected.turnover_evidence[high.job.candidate_id].annualized_recurring_turnover > 8);
  assert.equal(rejected.ranking[0].status, "CONSTRAINT_REJECTED");
  assert.equal(rejected.ranking[0].score, undefined, "Rejected candidates do not inflate the valid-score distribution");
  writeFileSync("/tmp/allocationlab-b3c2-high-recurring-fixture.json", JSON.stringify({ status: "PASS", execution_scope: "SYNTHETIC_TEST",
    purpose: "Isolated accounting/eligibility known answer, not empirical research", candidate_id: high.job.candidate_id,
    ledger: high.job.ledger, observations: 20, selection_metric_defined: true, other_constraints_satisfied: true,
    evidence: rejected.turnover_evidence[high.job.candidate_id], selection_status: rejected.ranking[0].status }, null, 2) + "\n");
  for (const patch of [{ max_drawdown: -.7 }, { exposure: 1.1 }, { net_sharpe: null }]) {
    const r = [{ ...a.ranked[0], metrics: { ...a.ranked[0].metrics, ...patch } }];
    assert.equal(selectRecurring(a.campaign, r, [a.job], 0).winner, undefined);
  }
});
test("total-turnover tie breaking remains certified when recurring eligibility permits both", () => {
  const a = selectionFixture([100]), b = selectionFixture([80]);
  b.ranked[0].candidate.candidate_id = "other"; b.job.candidate_id = "other";
  const result = selectRecurring(a.campaign, [...a.ranked,...b.ranked], [a.job,b.job], 0);
  assert.equal(result.winner.candidate.candidate_id, "other");
});
test("cross-version comparison represents absent fields without canonicalizing undefined or migrating a spec", () => {
  const old = { contract_version: "old", inputs: { cost: 1 } }, current = { contract_version: "new", inputs: { cost: 1 }, turnover_constraint_methodology_version: RECURRING_V2 };
  const before = structuredClone(old);
  assert.deepEqual(versionedSpecDifferences(old,current), [
    { path: "/contract_version", left: "old", right: "new" },
    { path: "/turnover_constraint_methodology_version", left: "NOT_PRESENT", right: RECURRING_V2 },
  ]);
  assert.deepEqual(old,before);
});
test("legacy exact 84-fold blocker is byte-compatible while V2 gets only an operational capacity block", () => {
  assert.throws(() => validatedWorkbenchPlan(legacy.exact_request, data), (e: unknown) => {
    assert.ok(e instanceof CalendarContractError); assert.equal(e.code, legacy.blocker.code);
    assert.equal(e.message, legacy.blocker.message); assert.deepEqual(e.details, legacy.blocker.issues); return true;
  });
  assert.throws(() => productPlan(exact, data), (e: unknown) => {
    assert.ok(e instanceof CalendarContractError); assert.equal(e.code, "INTERACTIVE_EXECUTION_CAPACITY_EXCEEDED");
    assert.equal(e.details.number_of_folds, 84); assert.equal(e.details.no_attempt_created, true);
    assert.equal(e.details.turnover_constraint_methodology_version, RECURRING_V2);
    assert.ok(Number(e.details.minimum_required_engine_files) > Number(e.details.maximum_engine_files)); return true;
  });
  const plan = productPlan(small, data); assert.equal(plan.preflight.initial_entry_bounds_checked, false);
  assert.equal(plan.preflight.financial_backtests_executed, 0); assert.equal(plan.number_of_folds, 1);
});
test("methodology is fixed before identity; financial requests stay strict and old identities stay exact", () => {
  for (const value of [{ ...small, turnover_constraint_methodology_version: TOTAL_V1 }, { ...small, max_jobs: 10000 },
    { ...small, step_months: 1 }, { ...small, transaction_cost_bps: NaN }]) assert.throws(() => parseProductSubmission(value));
  const oldSpec = { ...legacy.exact_request, evaluation_start: "2020-05-01", evaluation_end_exclusive: "2020-06-01" };
  const v2 = normalizeProduct({ ...oldSpec, contract_version: PRODUCT_SPEC, turnover_constraint_methodology_version: RECURRING_V2 }, data);
  const v1 = normalizedSpecV2(oldSpec, data);
  assert.notEqual(productRunId(v2), runIdV2(v1));
  assert.notEqual(productRunId(v2), productRunId({ ...v2, turnover_constraint_methodology_version: TOTAL_V1 } as any));
  assert.equal(productRunId(v2), productRunId({ ...v2, created_at: "display" } as any));
});
test("capacity has validated existing defaults, rejects invalid startup values and never enters identity", () => {
  assert.deepEqual(readExecutionCapacity({}), DEFAULT_EXECUTION_CAPACITY);
  for (const key of ["WORKBENCH_MAX_JOBS", "WORKBENCH_MAX_ENGINE_FILES", "WORKBENCH_EXECUTION_TIMEOUT_MS", "WORKBENCH_MAX_OUTPUT_BYTES"])
    for (const v of ["", "0", "-1", "NaN", "Infinity", "1.5", "1e3", "9007199254740992", " 2"])
      assert.throws(() => readExecutionCapacity({ [key]: v }));
  assert.throws(() => readExecutionCapacity({ WORKBENCH_EXECUTION_TIMEOUT_MS: "2147483648" }));
  const c = readExecutionCapacity({ WORKBENCH_MAX_JOBS: "2500", WORKBENCH_MAX_ENGINE_FILES: "600", WORKBENCH_EXECUTION_TIMEOUT_MS: "140000", WORKBENCH_MAX_OUTPUT_BYTES: "70000000" });
  const a = normalizeProduct(small, data, { ...DEFAULT_EXECUTION_CAPACITY }), b = normalizeProduct(small, data, c);
  assert.deepEqual(a,b); assert.equal(productRunId(a), productRunId(b));
  assert.ok(!JSON.stringify(a).includes('max_jobs'));
});
