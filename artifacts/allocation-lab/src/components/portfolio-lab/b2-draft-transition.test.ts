import assert from "node:assert/strict";
import test from "node:test";
import {
  canOptimizeB2Draft,
  selectB2ResultView,
  updateB2DraftForPreparationChange,
} from "./b2-draft-transition.ts";

test("preparation edits update only B2 draft inputs and preserve the last frozen allocation", () => {
  const frozenResult = { id: 42, status: "SOLVED", result: { assetWeights: { SPY: 1 } } };
  const next = updateB2DraftForPreparationChange(
    { candidateIds: ["new-a", "new-b"], informationCutoff: "2024-05-31" },
    {
      selectedAllocationId: 42,
      result: frozenResult,
    },
  );

  assert.deepEqual(next.candidateIds, ["new-a", "new-b"]);
  assert.equal(next.informationCutoff, "2024-05-31");
  assert.equal(next.selectedAllocationId, 42);
  assert.equal(next.result, frozenResult);
  assert.deepEqual(next.result?.result.assetWeights, { SPY: 1 });
});

test("clearing the prepared draft never clears the prior frozen result or selection", () => {
  const frozenResult = { id: 9, status: "SOLVED" };
  const next = updateB2DraftForPreparationChange(null, {
    selectedAllocationId: 9,
    result: frozenResult,
  });

  assert.deepEqual(next.candidateIds, []);
  assert.equal(next.informationCutoff, "");
  assert.equal(next.selectedAllocationId, 9);
  assert.equal(next.result, frozenResult);
});

test("a not-ready B1 draft blocks Optimize while keeping working parameters and frozen results intact", () => {
  const working = {
    candidateIds: ["SPY"],
    decisionTimestamp: "2025-02-03T16:00",
    result: { id: 9, status: "SOLVED" },
  };
  const before = structuredClone(working);

  assert.equal(canOptimizeB2Draft({
    historyInspectionActive: false,
    preparedInputMatchesDraft: true,
    draftReady: false,
    draftRepresentation: "asset_returns",
    representation: "asset_returns",
  }), false);
  assert.deepEqual(working, before);
});

test("Signal gating prefers the working draft representation and rejects a selected Signals source", () => {
  const shared = {
    historyInspectionActive: false,
    preparedInputMatchesDraft: true,
    draftReady: true,
  };
  assert.equal(canOptimizeB2Draft({
    ...shared,
    draftRepresentation: "signals",
    representation: "asset_returns",
  }), false);
  assert.equal(canOptimizeB2Draft({
    ...shared,
    draftRepresentation: "asset_returns",
    representation: "signals",
  }), false);
});

test("an inspection without a recorded allocation never displays the cached working result", () => {
  const workingResult = { id: 42, status: "SOLVED" };
  const visible = selectB2ResultView({
    historyInspectionActive: true,
    inspectedAllocationId: null,
    inspectedResult: null,
    inspectedLoading: false,
    workingResult,
  });

  assert.deepEqual(visible, { source: "unrecorded", result: null });
  assert.equal(workingResult.id, 42);
});

test("a known inspected allocation waits for its own GET instead of falling back to working output", () => {
  const workingResult = { id: 42, status: "SOLVED" };
  const visible = selectB2ResultView({
    historyInspectionActive: true,
    inspectedAllocationId: 77,
    inspectedResult: null,
    inspectedLoading: true,
    workingResult,
  });

  assert.deepEqual(visible, { source: "inspected-loading", result: null });
});

test("a known inspected allocation displays only its matching frozen GET result", () => {
  const inspectedResult = { id: 77, status: "SOLVED" };
  const visible = selectB2ResultView({
    historyInspectionActive: true,
    inspectedAllocationId: 77,
    inspectedResult,
    inspectedLoading: false,
    workingResult: { id: 42, status: "SOLVED" },
  });

  assert.deepEqual(visible, { source: "inspected", result: inspectedResult });
});