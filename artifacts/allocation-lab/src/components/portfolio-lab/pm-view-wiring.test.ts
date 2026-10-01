import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../../pages/portfolio-lab.tsx", import.meta.url), "utf8");
test("ModelsTab is never remounted by key and gets inspection flag and zeroed token", () => {
  assert.doesNotMatch(page, /<ModelsTab[^>]*?key=/);
  assert.match(page, /inspectionActive=\{!!inspection\}/);
  assert.match(page, /riskExecutionToken=\{inspection \? 0 : riskExecutionToken\}/);
  assert.match(page, /<ModelsTab[\s\S]*?result=\{viewResult\}/);
  assert.match(page, /allocationId=\{viewAllocationId\}/);
});
test("ConstraintsTab is not audited against current constraints while inspecting", () => {
  assert.match(page, /!inspection \?[\s\S]*?<ConstraintsTab/);
  assert.match(page, /text-constraints-audit-unrecorded/);
});
test("no b2Extra escape", () => assert.doesNotMatch(page, /b2Extra|as object/));

test("advanced research children mount lazily only while the details is open", () => {
  assert.match(page, /useState\(false\)/);
  assert.match(page, /onToggle=\{\(e\) => setAdvancedOpen/);
  assert.match(page, /\{advancedOpen && \(\s*<div[^>]*data-testid="advanced-research-body"[\s\S]*?<FactorsRegimesTab[\s\S]*?<C1ContributionPanel[\s\S]*?<C2DiagnosticsPanel[\s\S]*?<C3SelectionPoliciesPanel/);
  assert.match(page, /setAdvancedOpen\(true\)/);
  const marker = page.indexOf('id="pm-saved-runs"');
  for (const tag of ["<FactorsRegimesTab", "<C1ContributionPanel", "<C2DiagnosticsPanel", "<C3SelectionPoliciesPanel", 'data-testid="details-advanced-research"']) {
    assert.equal(page.split(tag).length - 1, 1, `${tag} appears exactly once`);
    assert.ok(page.indexOf(tag) > marker, `${tag} lives in Saved Runs / Replay`);
  }
  assert.match(page, /Advanced research on saved runs/);
  assert.match(page, /\{!b2Mode && <FactorsRegimesTab/);
  assert.doesNotMatch(page, /setAttribute\("open"/);
});

test("B2 gets inspectionActive; draftReady and draft representation gate top Optimize", () => {
  assert.match(page, /<B2AllocationPanel[\s\S]*?inspectionActive=\{!!inspection\}/);
  assert.match(page, /b2Prepared\?\.draftReady === false/);
  assert.match(page, /draftRepresentation === "signals"/);
  assert.match(page, /topOpt\.disabled \|\| signalsBlocked \|\| draftNotReady/);
  assert.match(page, /alert-draft-not-ready/);
});

test("inspection never writes the working engine; view mode is derived and restores on return", () => {
  assert.match(page, /const b2Mode = inspection \? inspection\.b2Mode : workingB2Mode;/);
  assert.doesNotMatch(page, /setB2Mode\(plan\.b2Mode\)/);
  assert.match(page, /"allocation-lab-optimization-mode", workingB2Mode \?/);
  assert.match(page, /onB2ModeChange=\{inspection \? undefined : setB2Mode\}/);
});

test("working frozen allocation is restored independently of inspected allocation on controller remount", () => {
  const b2 = readFileSync(new URL("./B2AllocationPanel.tsx", import.meta.url), "utf8");
  assert.match(page, /workingAllocationId=\{selectedB2AllocationId\}/);
  assert.match(b2, /useState<number \| null>\(\(\) => workingAllocationId \?\? null\)/);
  assert.match(page, /inspectedAllocationId=\{inspectedAllocationId\}/);
});

test("Ignore retains configured lambda without an inactive objective warning", () => {
  const controls = readFileSync(new URL("./RebalanceRegularizationPanel.tsx", import.meta.url), "utf8");
  const starting = readFileSync(new URL("./StartingPortfolioPanel.tsx", import.meta.url), "utf8");
  assert.match(controls, /active && !referenceDisabled && objective !== "regularized_mean_variance"/);
  assert.match(controls, /Ignored · configured λR retained/);
  assert.match(starting, /!isLegacy && mode !== "ignore" && lambdaError &&/);
});
