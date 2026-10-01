import assert from "node:assert/strict";
import test from "node:test";
import { prepareSnapshot, type PreparedRequest } from "../artifacts/api-server/src/lib/prepared-inputs";
import type { FactorDefinition } from "../artifacts/api-server/src/lib/factor-library";
import { DEFAULT_ALPHA_PARAMETERS, previewAlphaDraft } from "../artifacts/allocation-lab/src/components/portfolio-lab/alpha-stream-draft";

const assetTickers = ["A", "B"];
const factorIds = ["momentum_one", "momentum_two"];
const factors = factorIds.map(id => ({
  id, name: id, description: "Bulk draft contract fixture", family: "Test",
  enabled: true, status: "active", inputSeries: "adjusted close", calculationType: "momentum",
  formula: "P(t-lag)/P(t-lag-lookback)-1", direction: "higher_is_better",
  lookback: 5, lag: 0, normalization: "percentile_rank",
  winsorizationLower: 0, winsorizationUpper: 1, missingDataTreatment: "exclude", baseWeight: 1,
  regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 }, activeRegimes: ["risk_on", "neutral", "risk_off"],
  dataSource: "synthetic test fixture", benchmarkTicker: null, currentCoverage: 1,
  availabilityReason: null, version: "fixture-v1",
})) as FactorDefinition[];
const csv = ["date,A,B", ...Array.from({ length: 120 }, (_, i) => {
  const date = new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10);
  return `${date},${100 + i * 0.2 + Math.sin(i)},${120 + i * 0.3 + Math.cos(i)}`;
})].join("\n");
const freeze = (request: PreparedRequest, csvContent = csv) =>
  prepareSnapshot({ request, csvContent, factorVersion: "fixture-v1", factors });

test("bulk UI definitions retain B1 canonical IDs, alias invariance, and identical mapping results", () => {
  for (const mapping of ["single_asset_long_cash", "cross_sectional_long_only"] as const) {
    const preview = previewAlphaDraft({ assetTickers, factorIds, mapping, parameters: DEFAULT_ALPHA_PARAMETERS }, []);
    assert.equal(preview.error, null);
    assert.equal(preview.additions.length, mapping === "single_asset_long_cash" ? 4 : 2);
    const request: PreparedRequest = { representation: "alpha_streams", assetTickers, factorIds, alphaDefinitions: preview.additions };
    const bulk = freeze(request);
    const renamed = freeze({ ...request, alphaDefinitions: preview.additions.map(alpha => ({ ...alpha, name: `Alias ${alpha.name}` })) });
    assert.deepEqual(bulk.candidates.map(candidate => candidate.candidateId), renamed.candidates.map(candidate => candidate.candidateId));
    assert.deepEqual(bulk.candidates.map(candidate => candidate.returnSeries), renamed.candidates.map(candidate => candidate.returnSeries));
    assert.deepEqual(bulk.candidates.map(candidate => candidate.signalSeries), renamed.candidates.map(candidate => candidate.signalSeries));
    const repeated = previewAlphaDraft({ assetTickers, factorIds, mapping, parameters: DEFAULT_ALPHA_PARAMETERS }, renamed.request.alphaDefinitions);
    assert.equal(repeated.additions.length, 0);
    assert.equal(new Set(bulk.candidates.map(candidate => candidate.candidateId)).size, preview.additions.length);
    const changed = freeze({ ...request, alphaDefinitions: preview.additions.map(alpha => ({ ...alpha, threshold: 0.5 })) });
    assert.notDeepEqual(bulk.candidates.map(candidate => candidate.candidateId), changed.candidates.map(candidate => candidate.candidateId));
  }
});

test("bulk definitions keep the existing B1 cutoff boundary", () => {
  const preview = previewAlphaDraft({ assetTickers, factorIds, mapping: "single_asset_long_cash", parameters: DEFAULT_ALPHA_PARAMETERS }, []);
  const request: PreparedRequest = { representation: "alpha_streams", assetTickers, factorIds, alphaDefinitions: preview.additions, cutoffDate: "2024-03-01" };
  const changedFuture = csv.split("\n").map((line, index) => index > 0 && line.slice(0, 10) > request.cutoffDate! ? `${line.slice(0, 10)},9999,8888` : line).join("\n");
  const original = freeze(request), mutated = freeze(request, changedFuture);
  // Dataset-dependent IDs intentionally change; observations at/before the cutoff must not.
  assert.deepEqual(original.candidates.map(candidate => candidate.signalSeries), mutated.candidates.map(candidate => candidate.signalSeries));
  assert.deepEqual(original.candidates.map(candidate => candidate.returnSeries), mutated.candidates.map(candidate => candidate.returnSeries));
});