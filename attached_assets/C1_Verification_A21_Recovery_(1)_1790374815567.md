# C1 — Recover A2.1 test execution and finish verification

## Authorization and closed scope

This authorizes one bounded diagnostic/minimal-correction pass and one final verification pass. It does NOT restart C1 or authorize C2.

The existing C1 corrections are to be preserved. Do not redesign the application, add financial functionality, change optimization/accounting, weaken integrity comparisons, overwrite saved snapshots, or relax numerical tolerances or acceptance assertions.

The task is to determine why the A2.1 persistence tests cannot finish, correct the evidenced cause within this scope, and complete the already-required verification on one identified revision.

## Reported baseline — do not confuse it with final verification

- Revision: `eb3860a` plus an uncommitted T8 correction. Preserve that correction and all unrelated user changes.
- The previous C1 replay mismatch compared metadata-only expectations against the full B3 envelope. The correction compares metadata with metadata and separately verifies financial results.
- UI-created experiment #6, referencing B3 Validation Runs #38 and #39, returned HTTP 200 and `status: "pass"`, `differences: []`, through the rendered Replay button after working settings changed and a fresh-client retrieval.
- The pre-correction child comparison covered 13,577 numeric fields with maximum difference 0. Do NOT reuse those numbers as post-correction C1 verification statistics.
- C1 access no longer requires running legacy Validate. A separate legacy validation attempt returned constraint infeasibility; that is not evidence of the missing-snapshot protection.
- Corrected-revision typecheck, A1 6/6 and A2 7/7 passed. A2.1 timed out, then ended with `Promise resolution is still pending but the event loop has already resolved` (0 passed, 1 cancelled). Later suites were not executed in that pass.

## 1. Freeze the candidate under verification

Record the base commit, a fingerprint of the working-tree diff, Node version, package-manager version and lockfile identity. Do not reset, discard or silently omit the uncommitted correction.

Record the final revision/diff identity after any allowed fix. All closing evidence must identify that final candidate. No code edits during the final verification pass.

## 2. Diagnose A2.1 once; do not guess from the error message

Budget: up to 20 minutes for diagnosis and the minimal correction. No repeated blind reruns.

Inspect the existing failure log and A2.1 setup/test/teardown. Use at most one instrumented isolated reproduction if needed to locate the last completed operation and the unresolved operation.

Record whether the problem occurs during:
- test/server/database initialization;
- validation creation or retrieval;
- a pending callback, promise or subtest;
- test teardown/resource closure;
- the runner/reporting process.

Investigate only relevant async ownership/lifecycle: awaited hooks/subtests, server readiness, database connections/transactions, mocks, timers and cleanup. These are diagnostic possibilities, not a presumed root cause.

Allowed correction: the specifically demonstrated test-environment/setup/teardown/async-lifecycle defect, without altering financial or persistence semantics. Tests must continue exercising real persistence.

Do NOT:
- increase timeouts repeatedly or add sleeps to disguise an unresolved operation;
- add dummy keepalive loops or force a successful process exit;
- skip, cancel, mock away or weaken the persistence assertions;
- swallow rejected promises;
- upgrade dependencies speculatively;
- change production calculations or saved data to fit the tests.

If a genuine application persistence defect or unavailable external prerequisite is established and cannot be repaired within this scope/budget, stop modifying code and record the precise blocker. Do not call it “just a flaky test”.

### A2.1 assertions that must remain intact

1. Two validations of one frozen strategy with different cost assumptions produce separate immutable IDs, retain their own assumptions/results, and retrieval of V1 after V2 returns V1 unchanged.
2. A fresh application/client lifecycle retrieves the original persisted Validation Run by ID with unchanged strategy reference, dataset identity, assumptions and financial results within 1e-8. An in-memory replacement cannot satisfy this test.

Both tests must actually complete, with their assertions executed and no skips/cancellations.

## 3. One verification batch; no cascading cancellation of unrelated suites

Run the existing suites on the final frozen candidate:
A1, A2, A2.1, A3, B1, B2, B3, complete C1, integrity controls and typecheck.

Use isolated processes and test fixtures as appropriate. Set and report finite per-suite timeouts before execution, using existing documented limits where available. Run each suite once in this final batch; no watch mode or retry-until-green behavior.

A failed/hung suite must NOT prevent unrelated, safely isolated suites from running. Record every outcome as PASS, FAIL, TIMEOUT, CANCELLED or NOT_RUN, with counts and reason. If a shared dependency genuinely prevents another suite from running, report that dependency explicitly rather than cascading an unexplained cancellation.

Continue collecting evidence; do not start further repairs after final verification begins.

Failures, cancellations and missing required evidence still prevent C1 closure. Continuing independent suites does not relax the gate.

## 4. Finish the existing T8 evidence

Use isolated test records and the existing C1 UI fixture; do not pollute or reset the user's working portfolios. Do not add new product behavior.

Run the actual browser path once on the final candidate:
- access C1 without requiring validation of an unrelated legacy session;
- select an explicit frozen, compatible B2 alpha policy;
- create a C1 experiment;
- change working draft settings;
- reload/retrieve from a fresh client;
- click the rendered Replay button;
- record request path, HTTP status, visible result, experiment and child IDs.

Verify the original stored experiment and child records remain unchanged.

For that post-correction replay, report the actual numeric-field count and maximum absolute difference across the compared financial outputs. Preserve exact identity/status/date checks and the 1e-8 financial tolerance. Do not report unmeasured counts or reuse experiment #5 statistics.

First establish an intact experiment PASS; then execute the existing isolated wrong-reference, altered-child-result and altered-summary integrity controls. Controls must identify the intended mismatch, not pass because all replays fail generically. Do not edit real archived records for these controls.

Separately exercise an isolated legacy fixture that truly lacks the immutable snapshot, with otherwise feasible configuration so an unrelated constraint error does not mask the check. Legacy validation must retain the explicit missing-snapshot refusal; no substituted current inputs. C1 remains accessible independently.

## 5. Original C1 T1–T8 acceptance criteria — unchanged

The following preserves the original criteria for context. This task does not authorize rebuilding or expanding them.

**T1 — Genuine reoptimization**
For a deterministic exclusion, compare C1 against independent B3 runs of the full and reduced policies. Results must match within 1e-8. Demonstrate that remaining weights are recalculated, not merely rescaled.

**T2 — Comparable inputs**
Verify identical dates, shared observation windows, candidate definitions, asset constraints, capital and execution assumptions across variants. Removing an alpha must not alter another signal's peer universe.

Retain the correction freezing the full policy's ordered per-decision observations for all variants. Do not reopen sample selection or change the development window.

**T3 — Metric and distance reconciliation**
Independently compute ledger metrics, full-minus-variant deltas and both allocation-distance levels. Match within 1e-8. Undefined Sharpe remains undefined.

**T4 — Pair experiment**
Execute all four policies for a selected pair. Verify each against an independent B3 run and calculate differences from observed outputs, without imposing additivity or a favorable outcome.

**T5 — No performance-based filtering**
Technically valid weak-performing and highly correlated candidates remain in the baseline unless explicitly excluded by the PM. Aliases cannot add economic dimensions or duplicate experiment variants.

**T6 — Failure integrity**
A required positive-weight candidate is excluded: report infeasibility. A held-asset price is missing: preserve B3's dated invalid result. Neither case may become a successful shortened or substitute backtest.

**T7 — Temporal and budget protection**
Change observations after development ends, including reserved holdout. Development results must remain unchanged. Reject more than six distinct policies before execution.

**T8 — Real UI/API persistence**
Create an experiment through the actual flow, change working settings, reload and retrieve it. Manifest and child results remain unchanged. A new experiment cannot overwrite the first.

## Completion report and stop rule

Return one concise report with:
- final commit/diff identity and runtime versions;
- exact A2.1 root cause and minimal correction, or the precise unresolved operation;
- executed suite commands, durations, exit codes and pass/fail/cancel/skip counts;
- explicit mapping of C1 T1–T8 to observed results;
- final browser experiment/child IDs and actual replay response;
- post-correction numeric count and maximum difference;
- intact and tampered integrity-control outcomes;
- genuine missing-snapshot legacy-refusal result;
- exact blocker, if any.

C1 CLOSED requires all original T1–T8, required regressions, integrity controls, existing legacy protection and typecheck to pass on the final identified candidate. No required tests may be skipped, cancelled or counted as passed because they never ran.

If all pass, close C1 and STOP. No extra polish or new requirements.

Otherwise report C1 BLOCKED and the exact unresolved gate. STOP; do not start another autonomous repair pass, promise another “final” iteration, or begin C2.
