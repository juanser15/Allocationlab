import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { safeFailureSchema } from "./workbench-failure";
import { FailureNotice } from "../pages/workbench-failure-notice";
const sample = {
  error_class: "NO_VALID_CANDIDATE",
  failed_stage: "CANDIDATE_SELECTION",
  failed_fold_id: 0,
  failed_decision_date: "2019-10-01",
  safe_message:
    "All exposure policies were rejected in fold 0 by the configured research constraints.",
  actionable_explanation:
    "The 20-observation training interval produced defined scores, but every policy exceeded annualized turnover 8.",
  suggested_user_action:
    "Review the rejected constraint and training history, then preview a revised design. No automatic correction was applied.",
  diagnostic_reference: "PRE_RUN_NO_ATTEMPT_CREATED",
};
test("Failure card renders the actual safe class, fold, decision date, cause and user action", () => {
  const html = renderToStaticMarkup(
    createElement(FailureNotice, { failure: sample }),
  );
  assert.match(html, /NO_VALID_CANDIDATE/);
  assert.match(html, /Fold 0/);
  assert.match(html, /Decision date:.*2019-10-01/);
  assert.match(html, /20-observation/);
  assert.match(html, /Next action/);
  assert.match(html, /No dates or training windows were changed automatically/);
  assert.doesNotMatch(html, /increase.*(?:month|window)/i);
});
test("Only safe contract fields reach the card; private diagnostics and unknown fields are never rendered", () => {
  const parsed = safeFailureSchema.parse({
    ...sample,
    stderr: "secret-password at /workspace/private/worker.ts",
    environment: { DATABASE_URL: "private" },
  });
  const html = renderToStaticMarkup(
    createElement(FailureNotice, { failure: parsed }),
  );
  assert.doesNotMatch(html, /secret-password|\/workspace|DATABASE_URL/);
  for (const field of [
    "safe_message",
    "actionable_explanation",
    "suggested_user_action",
  ])
    assert.equal(
      safeFailureSchema.safeParse({
        ...sample,
        [field]:
          "Error at /workspace/private/file.ts\n    at execute (/tmp/private:4)",
      }).success,
      false,
    );
  const rejected = renderToStaticMarkup(
    createElement(FailureNotice, {
      failure: { ...sample, safe_message: "/workspace/private/worker.ts" },
    }),
  );
  assert.match(rejected, /Detailed failure evidence is unavailable/);
  assert.doesNotMatch(rejected, /\/workspace/);
});
test("Data, history and infrastructure failures retain their own class without an invented training-window remedy", () => {
  for (const error_class of [
    "DATA_AVAILABILITY_FAILURE",
    "INSUFFICIENT_SELECTION_HISTORY",
    "WORKER_PROTOCOL_FAILURE",
    "OUTPUT_OR_LOG_LIMIT",
  ]) {
    const html = renderToStaticMarkup(
      createElement(FailureNotice, {
        failure: {
          ...sample,
          error_class,
          safe_message: "The verified cause requires owner review.",
        },
      }),
    );
    assert.match(html, new RegExp(error_class));
    assert.doesNotMatch(html, /increase.*(?:month|window)/i);
  }
});
test("Plan blockers, latest failed attempt and immutable history use the same actionable renderer", () => {
  const source = readFileSync(
    "artifacts/allocation-lab/src/pages/workbench-designer.tsx",
    "utf8",
  ).replace(/\s+/g, " ");
  assert.match(source, /safeFailureSchema.safeParse\(issues\)/);
  assert.match(source, /<FailureNotice failure=\{issues\}/);
  assert.match(source, /<FailureNotice failure=\{active\?\.latest_attempt\}/);
  assert.match(source, /<FailureNotice failure=\{a\}/);
  assert.doesNotMatch(
    source,
    /The committed capital research engine could not complete this attempt/,
  );
});

test("Public diagnostic text rejects arbitrary environment assignments without embedding server secret names in the client", () => {
  assert.equal(
    safeFailureSchema.safeParse({
      ...sample,
      safe_message: "DATABASE_URL=private",
    }).success,
    false,
  );
  assert.equal(
    safeFailureSchema.safeParse({
      ...sample,
      safe_message: "WORKBENCH_PREVIEW_TOKEN=private",
    }).success,
    false,
  );
});
