import assert from "node:assert/strict";
import test from "node:test";
import {
  GetPreparedInputResponse,
  ListPreparedInputSummariesResponse,
} from "@workspace/api-zod";
import { preparedInputSummaryProjection } from "./prepared-input-summary";

const summaryFields = [
  "preparedInputId",
  "representation",
  "technicalStatus",
  "createdAt",
  "candidateCount",
  "coverageStartDate",
  "coverageEndDate",
  "observationCount",
  "coverageStatus",
  "datasetId",
  "datasetHash",
  "cutoffDate",
];

test("prepared-input picker projection selects only compact saved-row metadata", () => {
  assert.deepEqual(Object.keys(preparedInputSummaryProjection).sort(), [...summaryFields].sort());
  for (const forbidden of ["snapshot", "candidates", "candidateIds", "returnSeries", "signalSeries", "ledger"])
    assert.equal(forbidden in preparedInputSummaryProjection, false);
});

test("summary responses preserve actual candidate counts and allow unavailable optional coverage", () => {
  const summaries = ListPreparedInputSummariesResponse.parse([{
    preparedInputId: 337,
    representation: "asset_returns",
    technicalStatus: "READY",
    createdAt: new Date("2026-09-30T13:43:30.684Z"),
    candidateCount: 5,
    coverageStartDate: "2024-01-02",
    coverageEndDate: "2026-04-30",
    observationCount: 585,
    coverageStatus: "observed uploaded coverage",
    datasetId: 21,
    datasetHash: "source-hash",
    cutoffDate: null,
  }, {
    preparedInputId: 338,
    representation: "signals",
    technicalStatus: null,
    createdAt: new Date("2026-09-30T13:43:30.684Z"),
    candidateCount: null,
    coverageStartDate: null,
    coverageEndDate: null,
    observationCount: null,
    coverageStatus: null,
    datasetId: null,
    datasetHash: null,
    cutoffDate: null,
  }]);

  assert.equal(summaries[0].preparedInputId, 337);
  assert.equal(summaries[0].candidateCount, 5);
  assert.equal(summaries[1].candidateCount, null);
});

test("explicit prepared-input detail schema retains the full saved candidate and snapshot payload", () => {
  const detail = GetPreparedInputResponse.parse({
    preparedInputId: 337,
    representation: "asset_returns",
    status: "READY",
    candidates: [{ candidateId: "actual-candidate-id", returnSeries: [{ date: "2026-04-30", value: 0.01 }] }],
    snapshot: { request: { cutoffDate: "2026-04-30" }, dataset: { sha256: "source-hash" } },
    createdAt: new Date("2026-09-30T13:43:30.684Z"),
  });

  assert.equal(detail.candidates[0].candidateId, "actual-candidate-id");
  const snapshot = detail.snapshot as Record<string, unknown>;
  const request = snapshot.request as Record<string, unknown>;
  assert.equal(request.cutoffDate, "2026-04-30");
});