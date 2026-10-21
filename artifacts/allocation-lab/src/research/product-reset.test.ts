import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { blankDesign, readDesign, modules, CAPITAL_TABS } from "./state";
import { PlatformShell, ErrorMessage, ProgressPanel } from "./workbench";
import { ResearchClient } from "./api";
test("No silent financial values, no mandatory preview/review workflow, full optimizer shell", () => {
  assert.ok(Object.values(blankDesign()).every((x) => x === ""));
  const html = renderToStaticMarkup(
    createElement(PlatformShell, {
      module: "capital",
      setModule: () => {},
      signOut: () => {},
      children: "Content",
    }),
  );
  for (const m of modules)
    assert.ok(html.includes(m.label.replaceAll("&", "&amp;")));
  assert.ok(!html.includes("Preview Folds"));
  assert.ok(!html.includes("Review"));
  assert.equal(modules.length, 8);
  assert.ok(html.includes("Coming"));
});
test("Primary errors are concise and technical evidence remains collapsed", () => {
  const html = renderToStaticMarkup(
    createElement(ErrorMessage, {
      error: {
        error_class: "NO_VALID_CANDIDATE",
        safe_message:
          "No exposure policy satisfied the recurring-turnover constraint.",
        failed_fold_id: 3,
        failed_decision_date: "2025-03-17",
        technical_details: { candidate_id: "actual" },
      },
    }),
  );
  assert.ok(html.includes("No exposure policy"));
  assert.ok(html.includes("Show technical details"));
  assert.ok(!/<details[^>]*\bopen/.test(html));
  assert.ok(html.includes("NO_VALID_CANDIDATE"));
  assert.ok(html.includes("2025-03-17"));
});
test("Progress displays backend-defined units and ETA; no manufactured percentage", () => {
  const progress = {
    status: "RUNNING",
    stage: "Evaluating candidates",
    completed_work_units: 7,
    total_work_units: 10,
    percent_complete: 70,
    current_fold: 1,
    total_folds: 2,
    completed_candidates: 5,
    total_candidates: 10,
    elapsed_ms: 1200,
    estimated_remaining_ms: null,
    eta_confidence: "ESTIMATING" as const,
  };
  const html = renderToStaticMarkup(
    createElement(ProgressPanel, { progress, status: "RUNNING" }),
  );
  assert.ok(html.includes("70%"));
  assert.ok(html.includes("7 / 10"));
  assert.ok(html.includes("Estimating"));
  assert.ok(html.includes("Evaluating candidates"));
});
test("Client uses authenticated same-origin interactive API; N-run compare accepts more than two", async () => {
  const old = globalThis.fetch,
    calls: any[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url, init });
    return {
      ok: false,
      status: 409,
      json: async () => ({
        error: { code: "COMPARISON_NOT_AVAILABLE", message: "not completed" },
      }),
    } as any;
  }) as any;
  try {
    await assert.rejects(() =>
      new ResearchClient("test-only").compare(["r1", "r2", "r3"]),
    );
    assert.equal(calls[0].url, "/api/workbench/interactive/compare");
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      run_ids: ["r1", "r2", "r3"],
    });
    assert.equal(calls[0].init.headers.Authorization, "Bearer test-only");
    assert.ok(!calls[0].url.includes("/v1/"));
  } finally {
    globalThis.fetch = old;
  }
});
test("No source fixture defaults; only one Trading Costs form field; audit is a separate tab", () => {
  const s = readFileSync(
    "artifacts/allocation-lab/src/research/workbench.tsx",
    "utf8",
  );
  for (const forbidden of [
    "2020-01-01",
    "2024-01-01",
    "2022-01-01",
    "PREVIEW WALK-FORWARD",
    "reviewed",
    "Model-Selection Cost",
  ])
    assert.ok(!s.includes(forbidden));
  assert.equal((s.match(/aria-label="Trading costs"/g) ?? []).length, 1);
  assert.deepEqual(CAPITAL_TABS, [
    "Setup",
    "Results",
    "Compare",
    "Runs",
    "Audit",
  ]);
  assert.ok(!s.includes("broker route"));
  assert.ok(!s.includes("trade button"));
});
