import assert from "node:assert/strict";
import test from "node:test";
import {
  readWorkingDraftValue,
  isCurrentViewRequest,
  writeWorkingDraftValue,
} from "./portfolio-working-draft.ts";

test("working draft cache round-trips exact form values across independent fields", () => {
  const candidateIds = ["ETF-A", "ETF-B"];
  const objective = { type: "regularized_mean_variance", gamma: 1.25, eta: 0.003 };
  const forecast = {
    type: "SHRUNK_MEAN",
    shrinkage: 0.125,
    shrinkagePrior: { source: "DEFAULT" },
    displayZ: 1.96,
  };
  let raw: string | null = null;
  raw = writeWorkingDraftValue(raw, "candidateIds", candidateIds);
  raw = writeWorkingDraftValue(raw, "objective", objective);
  raw = writeWorkingDraftValue(raw, "forecastModel", forecast);
  assert.deepEqual(readWorkingDraftValue(raw, "candidateIds", [], Array.isArray), candidateIds);
  assert.deepEqual(readWorkingDraftValue(raw, "objective", {}, value => !!value && typeof value === "object"), objective);
  assert.deepEqual(readWorkingDraftValue(raw, "forecastModel", {}, value => !!value && typeof value === "object"), forecast);
});

test("draft cache rejects malformed versions and uses exact defaults for invalid fields", () => {
  assert.equal(readWorkingDraftValue('{"version":2,"values":{"kappaText":"2"}}', "kappaText", "1", value => typeof value === "string"), "1");
  const raw = writeWorkingDraftValue(null, "estimationWindow", "not-a-number");
  assert.equal(readWorkingDraftValue(raw, "estimationWindow", 252, value => typeof value === "number" && Number.isFinite(value)), 252);
});

test("late replay results are rejected after the user changes the viewed identity", () => {
  const request = { requestedView: "allocation:12", requestGeneration: 4 };
  assert.equal(isCurrentViewRequest({ ...request, currentView: "allocation:12", currentGeneration: 4 }), true);
  assert.equal(isCurrentViewRequest({ ...request, currentView: "allocation:13", currentGeneration: 5 }), false);
});