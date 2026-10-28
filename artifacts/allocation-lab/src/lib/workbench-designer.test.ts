import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canRunPlan,
  derivedTiming,
  emptyDesign,
  executionMatchesPlan,
  foldGeometry,
  readDesign,
  sameFolds,
  sameRequest,
  temporallyComparable,
} from "./workbench-designer-state";
import {
  capabilitiesV2Schema,
  capabilityProblemsV2,
  DESIGN_FIELDS,
  DesignerApiError,
  planV2Schema,
  SPEC_V2,
  submissionV2Schema,
  WorkbenchV2Client,
  type DetailV2,
} from "./workbench-v2-api";

const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const caps = capabilitiesV2Schema.parse(
  json("reports/workbench01/phase-b3a/capabilities-v2.json"),
);
const answers = json(
  "reports/workbench01/phase-b3a/fold-planner-known-answers.json",
);
// UI geometry fixtures only; the committed report explicitly labels these 2020
// known answers as temporal examples, not executable empirical evidence.
const request = submissionV2Schema.parse(answers.rolling.request);
const form = Object.fromEntries(
  DESIGN_FIELDS.map((k) => [k, String(request[k])]),
);
const fixturePlan = planV2Schema.parse({
  ...caps,
  ...answers.rolling,
  contract_version: SPEC_V2,
  normalized_request: request,
  first_training_date: answers.rolling.folds[0].training_start,
  first_oos_date: request.evaluation_start,
  last_oos_date: "2020-04-30",
  estimated_jobs: { total_jobs_estimated: 99 },
  warnings: [],
  blockers: [],
});

test("A/B/E: form is empty; validation comes from capabilities; no independent clock fields", () => {
  assert.ok(Object.values(emptyDesign()).every((v) => v === ""));
  assert.equal(Object.keys(emptyDesign()).length, 7);
  assert.equal(readDesign(emptyDesign(), caps).request, undefined);
  assert.deepEqual(capabilityProblemsV2(caps), []);
  assert.deepEqual(
    capabilityProblemsV2({ ...caps, supported_universe: ["QQQ"] }),
    ["universe"],
  );
  const typed = form as ReturnType<typeof emptyDesign>;
  assert.ok(readDesign(typed, caps).request);
  assert.equal(
    readDesign(typed, { ...caps, supported_evaluation_start_min: "2023-01-01" })
      .request,
    undefined,
  );
  for (const bad of ["test_months", "step_months", "recalibration_frequency"])
    assert.equal(
      submissionV2Schema.safeParse({ ...request, [bad]: 1 }).success,
      false,
    );
});
test("C/D: cadence metadata supplies exact read-only monthly and quarterly timing", () => {
  assert.deepEqual(derivedTiming(caps, "MONTHLY"), {
    oosMonths: 1,
    stepMonths: 1,
    recalibration: "monthly",
  });
  assert.deepEqual(derivedTiming(caps, "QUARTERLY"), {
    oosMonths: 3,
    stepMonths: 3,
    recalibration: "quarterly",
  });
  assert.equal(derivedTiming(caps, ""), undefined);
});
test("F/G: exact rolling and expanding backend dates determine geometry, including unequal month lengths", () => {
  const rolling = foldGeometry(answers.rolling.folds);
  const expanding = foldGeometry(answers.expanding.folds);
  assert.ok(rolling[1].trainingX > rolling[0].trainingX);
  assert.equal(expanding[1].trainingX, expanding[0].trainingX);
  assert.ok(expanding[1].trainingWidth > expanding[0].trainingWidth);
  const f = rolling[0].fold;
  assert.ok(
    Math.abs(
      rolling[0].trainingWidth / rolling[0].oosWidth -
        (Date.parse(f.training_end_exclusive) - Date.parse(f.training_start)) /
          (Date.parse(f.oos_end_exclusive) - Date.parse(f.oos_start)),
    ) < 1e-10,
  );
  assert.ok(rolling[1].oosX >= rolling[0].oosX + rolling[0].oosWidth - 1e-9);
});
test("H/I/J/K: no run before current accepted plan; any edited field invalidates it", () => {
  assert.equal(canRunPlan(undefined, request, true, true, false), false);
  assert.equal(canRunPlan(fixturePlan, request, false, true, false), false);
  assert.equal(canRunPlan(fixturePlan, request, true, false, false), false);
  assert.equal(canRunPlan(fixturePlan, request, true, true, true), false);
  assert.equal(
    canRunPlan(
      { ...fixturePlan, blockers: ["BLOCKED"] },
      request,
      true,
      true,
      false,
    ),
    false,
  );
  assert.equal(
    canRunPlan(
      {
        ...fixturePlan,
        folds: [
          { ...fixturePlan.folds[0], oos_start: "2020-01-02" },
          ...fixturePlan.folds.slice(1),
        ],
      } as any,
      request,
      true,
      true,
      false,
    ),
    false,
  );
  assert.equal(canRunPlan(fixturePlan, request, true, true, false), true);
  for (const key of DESIGN_FIELDS)
    assert.equal(
      sameRequest(request, { ...request, [key]: "changed" } as any),
      false,
    );
});
test("L: exact executed fold mismatch fails closed without hashing or financial calculations", () => {
  const result = {
    execution_attempt_id: "attempt",
    validation_diagnostics: { exact_fold_plan: fixturePlan.folds },
  };
  const detail = {
    spec: request,
    latest_successful_result: result,
    latest_attempt: { execution_attempt_id: "attempt" },
  } as unknown as DetailV2;
  assert.equal(executionMatchesPlan(detail, fixturePlan), true);
  assert.equal(
    executionMatchesPlan(
      {
        ...detail,
        latest_successful_result: {
          ...result,
          validation_diagnostics: {
            exact_fold_plan: [
              { ...fixturePlan.folds[0], decision_date: "2020-01-03" },
              ...fixturePlan.folds.slice(1),
            ],
          },
        },
      } as any,
      fixturePlan,
    ),
    false,
  );
  assert.equal(sameFolds(fixturePlan.folds, fixturePlan.folds.slice(1)), false);
});
test("M/N: arbitrary costs remain explicit, distinct, finite, nonnegative and unrounded", () => {
  const read = readDesign(
    {
      ...form,
      transaction_cost_bps: "3.125",
      selection_cost_bps: "6.875",
    } as any,
    caps,
  );
  assert.equal(read.request?.transaction_cost_bps, 3.125);
  assert.equal(read.request?.selection_cost_bps, 6.875);
  for (const value of ["", "NaN", "Infinity", "-0.1"]) {
    assert.equal(
      readDesign({ ...form, transaction_cost_bps: value } as any, caps).request,
      undefined,
    );
    assert.equal(
      readDesign({ ...form, selection_cost_bps: value } as any, caps).request,
      undefined,
    );
  }
  assert.equal(
    submissionV2Schema.safeParse({
      ...request,
      transaction_cost_bps: undefined,
    }).success,
    false,
  );
});
test("B/O: invalid dates and quarter boundaries never snap or auto-correct", () => {
  const bad = {
    ...form,
    rebalance_frequency: "QUARTERLY",
    evaluation_start: "2022-02-01",
  } as any;
  assert.match(readDesign(bad, caps).errors.join(), /calendar-quarter start/);
  assert.equal(bad.evaluation_start, "2022-02-01");
  assert.equal(
    readDesign({ ...form, evaluation_start: "2022-02-30" } as any, caps)
      .request,
    undefined,
  );
  assert.equal(
    readDesign({ ...form, training_window_months: "0" } as any, caps).request,
    undefined,
  );
});
test("K/Q: plan and run use exactly the strict V2 financial object on ordinary routes", async () => {
  const calls: Array<{ url: string; body: unknown; headers: Headers }> = [];
  const fetcher = (async (url: any, init: any) => {
    calls.push({
      url: String(url),
      body: JSON.parse(init.body),
      headers: new Headers(init.headers),
    });
    return new Response(
      JSON.stringify(
        String(url).endsWith("/plan")
          ? fixturePlan
          : {
              ...caps,
              run_id: `rr_${"a".repeat(64)}`,
              execution_attempt_id: "attempt",
              status: "RUNNING",
              stage: "CAPITAL_ENGINE",
              reused_existing_attempt: false,
              execution_requested: true,
            },
      ),
      { status: 200 },
    );
  }) as typeof fetch;
  const client = new WorkbenchV2Client("injected-unit-token", fetcher);
  const p = await client.plan(request);
  await client.submitRun(p.normalized_request);
  assert.deepEqual(
    calls.map((c) => c.url),
    ["/api/workbench/plan", "/api/workbench/runs"],
  );
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.deepEqual(
    Object.keys(calls[0].body as object).sort(),
    Object.keys(submissionV2Schema.shape).sort(),
  );
  assert.equal(
    calls[0].headers.get("authorization"),
    "Bearer injected-unit-token",
  );
});
test("O: backend blockers and 429 evidence propagate once without automatic retries", async () => {
  let calls = 0;
  const client = new WorkbenchV2Client("token", (async () => {
    calls++;
    return new Response(
      JSON.stringify({
        error: {
          code: "INSUFFICIENT_MODEL_WARMUP_HISTORY",
          message: "Complete model history is required.",
          issues: {
            available_warmup_observations: 100,
            warmup_requirement_observations: 252,
          },
        },
      }),
      { status: 400 },
    );
  }) as typeof fetch);
  await assert.rejects(
    () => client.plan(request),
    (e: unknown) =>
      e instanceof DesignerApiError &&
      e.code === "INSUFFICIENT_MODEL_WARMUP_HISTORY" &&
      (e.issues as any).available_warmup_observations === 100,
  );
  assert.equal(calls, 1);
  const limit = new WorkbenchV2Client("token", (async () => {
    calls++;
    return new Response(
      JSON.stringify({
        error: { code: "BLOCKED_EXECUTION_CAPACITY", message: "Occupied" },
      }),
      { status: 429 },
    );
  }) as typeof fetch);
  await assert.rejects(
    () => limit.submitRun(request),
    (e: any) => e.code === "BLOCKED_EXECUTION_CAPACITY",
  );
  assert.equal(calls, 2);
});
test("Compare: overlay only for matching evaluation intervals, no local result differences", () => {
  const a = { spec: request } as DetailV2;
  assert.equal(
    temporallyComparable(a, {
      spec: { ...request, window_type: "EXPANDING" },
    } as DetailV2),
    true,
  );
  assert.equal(
    temporallyComparable(a, {
      spec: { ...request, evaluation_end_exclusive: "2022-04-01" },
    } as DetailV2),
    false,
  );
});
test("Q/R: live /workbench uses coordinated UI and preserves the Product Reset reference; no V1 execution or broker controls", () => {
  const page = readFileSync(
    "artifacts/allocation-lab/src/pages/workbench-designer.tsx",
    "utf8",
  );
  const client = readFileSync(
    "artifacts/allocation-lab/src/lib/workbench-v2-api.ts",
    "utf8",
  );
  const app = readFileSync("artifacts/allocation-lab/src/App.tsx", "utf8");
  assert.match(app, /import WorkbenchPage from "@\/research\/coordinated"/);
  const coordinated = readFileSync("artifacts/allocation-lab/src/research/coordinated.tsx", "utf8");
  assert.match(coordinated, /import Baseline from "\.\/workbench"/);
  assert.doesNotMatch(
    page + client,
    /\/api\/workbench\/v1|from ["'].*pages\/workbench["']/,
  );
  assert.doesNotMatch(page, />\s*(TRADE|PLACE ORDER|AUTHORIZE CAPITAL)\s*</i);
  assert.match(page, /PLAN OUTDATED/);
  assert.match(page, /PLAN_EXECUTION_MISMATCH/);
});
