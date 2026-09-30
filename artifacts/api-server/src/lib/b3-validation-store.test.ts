import assert from "node:assert/strict";
import test from "node:test";
import {
  b3InputHash, matchesPreparedFingerprint, resultDifferences, verifyLegacyB3ReplayFingerprint,
} from "./b3-validation-store";
import { fingerprint } from "./prepared-inputs";

test("B3 accepts frozen OHLC preparation fingerprints across JSONB's undefined-key removal", () => {
  const request = { representation: "asset_returns", assetTickers: ["D6A"], cutoffDate: undefined };
  const base = { request, datasetHash: "close-hash", factorVersion: "v1", engineVersion: "b1" };
  const persisted = JSON.parse(JSON.stringify({
    dataset: { sha256: "close-hash", ohlcSha256: "open-hash" },
    factorSet: { version: "v1" }, engineVersion: "b1", request,
  }));
  assert.equal(matchesPreparedFingerprint(persisted,
    fingerprint({ ...base, ohlcDatasetHash: "open-hash" })), true);
  assert.equal(matchesPreparedFingerprint(persisted,
    fingerprint(JSON.parse(JSON.stringify({ ...base, ohlcDatasetHash: "open-hash" })))), true);
  assert.equal(matchesPreparedFingerprint(persisted,
    fingerprint({ ...base, ohlcDatasetHash: "tampered-hash" })), false);
  assert.equal(matchesPreparedFingerprint(persisted, fingerprint(base)), false,
    "An adjusted-OHLC preparation cannot claim the historical close-only fingerprint");
});

test("B3 persisted input fingerprint survives JSONB removal of undefined D4 diagnostic fields", () => {
  const input = {
    allocationId: 443,
    validationPreparedInputId: 17,
    policySnapshot: { engineVersion: "b1-test" },
    policyRequest: { candidateIds: ["candidate-a"], robustness: { method: "ROBUST_MEAN_UNCERTAINTY", kappa: 0.2 } },
    validationSnapshot: { dataset: { sha256: "frozen-data" } },
    assumptions: { initialNav: 100 },
    engineVersion: "b3-test",
    result: {
      decisions: [{
        optimizer: {
          robustness: {
            diagnostics: {
              nominalRequest: {
                candidateIds: ["candidate-a"],
                signedConstraints: undefined,
                constraints: { candidateBounds: undefined },
              },
            },
          },
        },
        expectedReturn: 0.001,
      }],
    },
  };
  const persisted = JSON.parse(JSON.stringify(input)) as typeof input;

  // The legacy direct fingerprint changes across JSONB's undefined-field
  // removal; B3's persisted hash deliberately uses JSONB's representation.
  assert.notEqual(fingerprint(input), fingerprint(persisted));
  assert.equal(b3InputHash(input), b3InputHash(persisted));
  assert.deepEqual(resultDifferences(input.result, persisted.result), []);
});

test("B3 replay comparison still detects substantive result differences", () => {
  const saved = {
    decisions: [{ optimizer: { robustness: { diagnostics: { solverStatus: "SOLVED" } } } }],
    value: 0.25,
  };
  const replayed = {
    decisions: [{ optimizer: { robustness: { diagnostics: { solverStatus: "SOLVED" } } } }],
    value: 0.2501,
  };
  assert.match(resultDifferences(saved, replayed).join("\n"), /result\.value/);
});

test("legacy B3 replay fallback rejects sub-tolerance saved-result tampering", () => {
  const legacyInput = {
    allocationId: 443,
    validationPreparedInputId: 17,
    policySnapshot: { engineVersion: "b1-test" },
    policyRequest: { candidateIds: ["candidate-a"] },
    validationSnapshot: { dataset: { sha256: "frozen-data" } },
    assumptions: { initialNav: 100 },
    engineVersion: "b3-test",
    result: { value: 0.25, optionalD4Field: undefined },
  };
  const storedLegacyHash = fingerprint(legacyInput);
  const replayedResult = legacyInput.result;
  const persistedResult = JSON.parse(JSON.stringify(legacyInput.result)) as { value: number };
  const persistedInput = { ...legacyInput, result: persistedResult };

  assert.equal(
    verifyLegacyB3ReplayFingerprint(persistedInput, storedLegacyHash, replayedResult, true),
    true,
    "an untouched JSONB result with a matching legacy hash should pass",
  );
  assert.equal(
    verifyLegacyB3ReplayFingerprint({
      ...persistedInput, result: { value: persistedResult.value + 1e-9 },
    }, storedLegacyHash, replayedResult, true),
    false,
    "a 1e-9 stored-result mutation must fail even though it is within ordinary replay tolerance",
  );
  assert.equal(
    verifyLegacyB3ReplayFingerprint(persistedInput, storedLegacyHash, replayedResult, false),
    false,
    "legacy fallback must not bypass engine-version verification",
  );
  assert.equal(
    verifyLegacyB3ReplayFingerprint(persistedInput, `${storedLegacyHash}-wrong`, replayedResult, true),
    false,
    "legacy fallback must require the exact stored legacy hash",
  );
});