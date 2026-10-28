import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  loadDatasetV2,
  planCalendarV2,
  parseSubmissionV2,
  normalizedSpecV2,
  runIdV2,
  CalendarContractError,
  type SubmissionV2,
} from "./calendar-v2";
import { selectionPreflight, validatedWorkbenchPlan } from "./design-preflight";
import {
  infrastructureFailure,
  attachSafeFailure,
} from "./failure-diagnostics";
const dataset = loadDatasetV2();
export const exact: SubmissionV2 = parseSubmissionV2({
  contract_version: "workbench-research-run-spec-2.0.0",
  research_mode: "CAPITAL_MARKET_EXPOSURE",
  execution_scope: "EMPIRICAL",
  universe: "SPY",
  validation_protocol: "TRADITIONAL_WALK_FORWARD",
  evaluation_start: "2019-10-01",
  evaluation_end_exclusive: "2026-10-01",
  window_type: "ROLLING",
  training_window_months: 1,
  rebalance_frequency: "MONTHLY",
  transaction_cost_bps: 1,
  selection_cost_bps: 1,
});
test("Exact production failure evidence identifies constraint rejection, defined scores, first fold and original limits", () => {
  const before = JSON.parse(
    readFileSync(
      "reports/workbench01/phase-b3c1/before-fix-reproduction.json",
      "utf8",
    ),
  );
  const candidates = JSON.parse(
    readFileSync(
      "reports/workbench01/phase-b3c1/short-window-candidate-diagnostics.json",
      "utf8",
    ),
  );
  assert.equal(before.status, "FAILURE_REPRODUCED");
  assert.deepEqual(before.request, exact);
  assert.equal(before.plan.number_of_folds, 84);
  assert.equal(before.submission.http_status, 202);
  assert.equal(before.primary_cause, "NO_VALID_CANDIDATE");
  assert.equal(before.first_failing_fold.outer_fold, 0);
  assert.equal(before.engine_job_counts.invalid, 0);
  assert.equal(before.engine_job_counts.failed, 0);
  assert.equal(
    before.internal_error.internal_exception_message,
    "Error: Dynamic campaign did not complete as a fresh execution",
  );
  assert.equal(
    before.internal_error.safe_message,
    "The committed capital research engine could not complete this attempt.",
  );
  assert.ok(before.elapsed_ms < before.limits.timeout_ms);
  assert.ok(before.output_bytes < before.limits.max_output_bytes);
  assert.ok(
    candidates.candidates.every(
      (c: any) =>
        c.validity_status === "VALID" &&
        typeof c.selection_metric_value === "number" &&
        c.constraint_status === "CONSTRAINT_REJECTED",
    ),
  );
});
test("Exact 84-fold plan blocks by a mathematically necessary initial-entry bound, without changing input or executing returns", () => {
  const before = structuredClone(exact),
    oldPlan = planCalendarV2(exact, dataset);
  const diagnostic = JSON.parse(
    readFileSync(
      "reports/workbench01/phase-b3c1/short-window-candidate-diagnostics.json",
      "utf8",
    ),
  );
  assert.equal(oldPlan.number_of_folds, 84);
  assert.throws(
    () => selectionPreflight(exact, dataset, oldPlan),
    (e: unknown) => {
      assert.ok(e instanceof CalendarContractError);
      assert.equal(e.code, "NO_VALID_CANDIDATE");
      assert.equal(e.statusCode, 422);
      assert.equal(e.details.failed_fold_id, 0);
      assert.equal(e.details.failed_decision_date, "2019-10-01");
      assert.equal(e.details.number_of_folds, 84);
      const bounds = e.details.candidates as any[];
      for (const c of diagnostic.candidates) {
        const b = bounds.find((x) => x.candidate_id === c.candidate_id);
        assert.equal(
          b.initial_target_spy_exposure,
          c.initial_target_spy_exposure,
        );
        assert.ok(
          Math.abs(b.annualized_turnover_lower_bound - c.annualized_turnover) <
            1e-12,
        );
      }
      return true;
    },
  );
  assert.deepEqual(exact, before);
});
test("No calendar-month minimum: real one-month sample can pass, but complete candidate viability is never guaranteed", () => {
  const request = {
    ...exact,
    evaluation_start: "2020-05-01",
    evaluation_end_exclusive: "2020-06-01",
  };
  const p = validatedWorkbenchPlan(request, dataset);
  assert.equal(p.normalized_request.training_window_months, 1);
  assert.equal(p.preflight.financial_backtests_executed, 0);
  assert.equal(p.preflight.candidate_viability_guaranteed, false);
});
test("Long financially admissible plans also respect unchanged immutable file budget before execution", () => {
  const request = { ...exact, training_window_months: 2 };
  assert.throws(
    () => validatedWorkbenchPlan(request, dataset),
    (e: unknown) => {
      assert.ok(e instanceof CalendarContractError);
      assert.equal(e.code, "OUTPUT_OR_LOG_LIMIT");
      assert.equal(e.details.resource, "ENGINE_FILE_COUNT");
      assert.equal(e.details.number_of_folds, 84);
      assert.ok(
        Number(e.details.minimum_required_engine_files) >
          Number(e.details.maximum_engine_files),
      );
      return true;
    },
  );
});
test("Prior supported specs retain their exact identities; preflight never enters normalization or financial hashing", () => {
  const old = JSON.parse(
    readFileSync(
      "reports/workbench01/phase-b3c/browser-acceptance.json",
      "utf8",
    ),
  );
  for (const item of old.matrix) {
    const p = validatedWorkbenchPlan(item.request, dataset);
    assert.equal(runIdV2(normalizedSpecV2(item.request, dataset)), item.run_id);
    assert.deepEqual(p.folds, planCalendarV2(item.request, dataset).folds);
  }
});
test("Infrastructure classes are actionable and never copy private errors, stack paths, environment or stderr", () => {
  const privateText =
    "secret Bearer private-token at /workspace/private/file.ts DATABASE_URL=private";
  for (const [code, expected] of [
    ["WORKBENCH_WORKER_PROTOCOL_ERROR", "WORKER_PROTOCOL_FAILURE"],
    ["WORKBENCH_LOG_LIMIT_EXCEEDED", "OUTPUT_OR_LOG_LIMIT"],
    ["WORKBENCH_EXECUTION_TIMEOUT", "WORKER_EXECUTION_TIMEOUT"],
    ["UNKNOWN", "UNCLASSIFIED_EXECUTION_FAILURE"],
  ]) {
    const d = infrastructureFailure(code, privateText);
    assert.equal(d.error_class, expected);
    assert.doesNotMatch(
      JSON.stringify(d),
      /private-token|\/workspace|DATABASE_URL/,
    );
    assert.ok(d.suggested_user_action);
    assert.equal(d.failed_fold_id, null);
  }
});

test("Failure diagnostic version never overwrites the V2 result contract or existing financial evidence", () => {
  const original = {
    contract_version: "workbench-research-run-result-2.0.0",
    financial_result_hash: "preserved",
    provenance: { original: true },
    status: "FAILED",
  };
  const d = {
    ...infrastructureFailure("WORKBENCH_WORKER_PROTOCOL_ERROR", "private"),
    contract_version: "workbench-failure-diagnostic-1.0.0",
  };
  const enriched = attachSafeFailure(original, d);
  assert.equal(enriched.contract_version, original.contract_version);
  assert.equal(enriched.financial_result_hash, original.financial_result_hash);
  assert.deepEqual(enriched.provenance, original.provenance);
  assert.equal(
    enriched.failure_diagnostic.contract_version,
    "workbench-failure-diagnostic-1.0.0",
  );
});
