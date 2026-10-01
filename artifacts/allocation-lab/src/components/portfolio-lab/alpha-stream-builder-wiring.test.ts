import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const src = (n: string) => readFileSync(new URL(`./${n}`, import.meta.url), "utf8");

test("builder has no API imports and exposes stable test ids", () => {
  const b = src("AlphaStreamDraftBuilder.tsx");
  assert.doesNotMatch(b, /api-client-react|fetch\(/);
  for (const id of ["select-alpha-builder-mapping", "input-alpha-builder-threshold", "input-alpha-builder-gross",
    "details-alpha-builder-advanced", "alpha-builder-preview", "button-create-alpha-draft"]) assert.match(b, new RegExp(id));
  assert.match(b, /<option value="next_close">/);
  assert.match(b, /<option value="same_close">/);
  assert.doesNotMatch(b, /next_open/);
  assert.doesNotMatch(b, /Number\(raw\)\s*\|\|\s*0/);
});

test("create action only appends previewed additions without prepare side effects", () => {
  const p = src("PreparedInputsPanel.tsx");
  const m = p.match(/const createAlphaDrafts = [\s\S]*?\n  \};/);
  assert.ok(m);
  assert.match(m[0], /setAlphaDefinitions\(existing => \[\.\.\.existing, \.\.\.previewAlphaDraft\(input, existing\)\.additions\]\)/);
  assert.doesNotMatch(m[0], /prepareInputs|mutate|fetch|setAcceptedDraftSignature|onPreparedSelectionChange/);
  assert.match(p, /data-testid="text-alpha-draft-count"/);
});

test("manual editor is collapsed by default", () => {
  const p = src("PreparedInputsPanel.tsx");
  const details = p.split("\n").find(line => line.includes('data-testid="details-alpha-manual-editor"'));
  assert.ok(details?.includes("<details"));
  assert.match(details, /open=\{manualEditorOpen\}/);
  assert.match(p, /const \[manualEditorOpen, setManualEditorOpen\] = useState\(false\)/);
  assert.match(p, /data-testid="button-add-alpha"/);
  assert.doesNotMatch(src("AlphaStreamDraftBuilder.tsx"), /<details[^>]*\sopen/);
});

test("manual editor children render only while open", () => {
  const p = src("PreparedInputsPanel.tsx");
  assert.match(p, /useState\(false\)/);
  assert.match(p, /onToggle=\{event => setManualEditorOpen\(event\.currentTarget\.open\)\}/);
  assert.match(p, /\{manualEditorOpen && <div/);
});
