import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

test("workflow stage reads saved validations and decision logs without calculation or creation GETs", () => {
  const workflow = source("../../lib/workflow.ts");
  assert.match(workflow, /useListValidationRuns/);
  assert.match(workflow, /useGetValidationRun/);
  assert.match(workflow, /useListDecisionLogs/);
  assert.doesNotMatch(workflow, /useGetBacktest|useGetOrCreateDecisionLog|useGetCommittee/);
  assert.match(workflow, /decisionLog\?\.status === "under_review"/);
});

test("C2 and C3 draft edits cannot trigger dependency-plan POSTs", () => {
  for (const [file, hook] of [
    ["C2DiagnosticsPanel.tsx", "planRequest"],
    ["C3SelectionPoliciesPanel.tsx", "planRef"],
  ] as const) {
    const panel = source(file);
    assert.doesNotMatch(panel, /useEffect\s*\(/, `${file} must not calculate plans from draft effects`);
    assert.equal((panel.match(new RegExp(`${hook}\\.current\\(\\{ data: input \\}\\)`, "g")) ?? []).length, 1);
    assert.match(panel, /async function run\(\)/);
    assert.ok(
      panel.indexOf(`${hook}.current({ data: input })`) > panel.indexOf("async function run()"),
      `${file} plan call must be inside the explicit Run handler`,
    );
  }
});

test("allocation and committee navigation cannot eagerly create logs or calculate committee evidence", () => {
  const allocation = source("AllocationTab.tsx");
  const committee = source("../../pages/investment-committee.tsx");
  assert.match(allocation, /useListDecisionLogs/);
  assert.doesNotMatch(allocation, /useGetOrCreateDecisionLog/);
  assert.match(committee, /useListDecisionLogs/);
  assert.doesNotMatch(committee, /useGetOrCreateDecisionLog/);
  assert.equal((committee.match(/getOrCreateDecisionLog\(/g) ?? []).length, 2);
  assert.equal((committee.match(/enabled: false/g) ?? []).length, 4);
  assert.match(committee, /const handleStartReview = async/);
  assert.match(committee, /const handleGenerateCommitteePack = async/);
  assert.match(committee, /const openEvidenceDrawer =/);
});

test("risk model calculation is gated by a newly issued explicit execution token", () => {
  const models = source("ModelsTab.tsx");
  assert.match(models, /riskExecutionToken\?: number/);
  assert.match(models, /token <= 0 \|\| token === seenRiskExecutionToken\.current/);
  assert.match(models, /enabled: !!riskRequest/);
  assert.match(models, /refetchOnMount: false/);
  assert.match(models, /refetchOnWindowFocus: false/);
  assert.match(models, /refetchOnReconnect: false/);
});

test("history inspection suppresses working risk execution and cached response", () => {
  const models = source("ModelsTab.tsx");
  assert.match(models, /inspectionActive\?: boolean/);
  assert.match(models, /if \(inspectionActive\) return;\s+const token = riskExecutionToken/);
  assert.match(models, /const riskModel = inspectionActive \? undefined : lastCompletedRisk\?\.result/);
  assert.match(models, /Frozen risk snapshot not recorded for this history item/);
});