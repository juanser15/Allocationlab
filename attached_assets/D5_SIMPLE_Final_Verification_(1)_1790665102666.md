# D5 SIMPLE — FINAL VERIFICATION AND A2.1 FIXTURE CORRECTION

## Objective and current evidence

Close the EXISTING D5 Simple implementation. Do not restart development.

The last read-only inspection identified application revision `d0e33da`, a clean working tree, and D5 Simple incorporated. Earlier verification recorded its six acceptance criteria and browser flow as satisfactory, but two A2.1 tests failed because requested dates had no available price data. Some temporary verification logs were no longer available.

The persisted original D5 BLOCKED report refers to the superseded absolute-transaction-cost objective, NOT D5 Simple. Do not repair or reactivate that objective.

First record the actual current revision and any pending work. Preserve newer changes; do not reset to the historical revision or work concurrently over another active change.

## Closed scope

Preserve D3 forecasts and uncertainty, D1 risk models, D2 signed exposures, D4's exact robust objective, B3 timing and A1 accounting. No new models, factors, constraints, cost features, OHLC, navigation redesign, or D6.

D5 Simple remains the existing optional smooth penalty on changes in consolidated underlying risky-asset exposures. Its coefficient is an objective preference, not a fee. Actual fees/slippage remain separate A1/B3 cash charges. Zero/off must retain the accepted D4 behavior.

## 1. Establish and correct the A2.1 failure cause

For each failing test, compare the requested dates, warmup, selected dataset identity and actual coverage. Establish whether the test failed to create its required inputs; do not assume this without checking.

Make the tests self-contained if necessary:
- Create deterministic test-only price data with sufficient warmup and coverage for the explicit evaluation dates.
- Create valid configuration and an immutable strategy snapshot using the existing real application persistence path.
- Capture identifiers dynamically. Do not depend on the latest user upload, old dataset dates or historical record IDs.
- Use the proven database test runner and actual database persistence; no in-memory replacements.
- Isolate verification records and preserve user settings and archives. Retain fixtures until their consumers finish; clean up only records owned by the test.

Preserve the two original A2.1 requirements:

**A2.1-1 — Separate immutable validations.** Validate the same frozen strategy with V1 assumptions and again with V2 using different transaction costs. Both Validation Runs persist under different IDs. Retrieving V1 afterward returns its unchanged original inputs, dataset identity, assumptions and complete financial outputs.

**A2.1-2 — Persistence across fresh processes.** Retrieve the saved Validation Run by ID from a fresh client/process. Identity, strategy reference, dataset identity, assumptions and stored results remain unchanged; any numerical replay comparison must remain within the existing 1e-8 tolerance.

Do not bypass missing-data validation, substitute current inputs, weaken legacy protection or change production dates to make the test pass.

If valid fixtures demonstrate a genuine application defect, make only the minimum in-scope correction and record its cause. If it needs broader financial changes, stop with the precise blocker instead of extending this task.

## 2. Preserve the original six D5 Simple gates

**T1 — Zero identity.** On unique-solution fixtures spanning capital/signed and nominal/robust modes, a zero/off penalty reproduces accepted D4 outputs within 1e-8. Off mode does not introduce a new holdings-input requirement. An existing archived run remains reproducible.

**T2 — Analytical penalty.** In the existing one-risky-asset fixture, the base objective is one-half times 0.02 times squared weight minus 0.012 times weight. With current asset weight 0.20, the base optimum is 0.60; regularization coefficient 0.04 gives one-third under nonbinding constraints. Independently verify optimum, derivatives and objective within 1e-8. Flat prices, zero cash yield and zero economic fees must not generate a cash debit from the regularization preference.

**T3 — Underlying aggregation.** Distinct alpha-coefficient vectors with identical underlying targets have identical penalties. Include signed exposures, actual drifted holdings and an outside-candidate liquidation. Independently reconcile squared displacement and external fees; no double charging at alpha level.

**T4 — Safety and timing.** Preserve supported binding constraints and independent optimality checks in capital/signed and nominal/robust cases. Invalid coefficients, missing valuations and infeasibility return explicit failures. Future observations do not alter an earlier holdings reference or decision.

**T5 — Historical comparison.** Zero and positive regularization use identical non-regularization settings and actual fee/slippage assumptions. Each policy follows its own actual holdings path. Predeclared feasible fixtures must produce positive risky exposure and at least two executions. Both ledgers reconcile within 1e-8. Better returns, fewer trades or lower absolute turnover are NOT acceptance requirements.

**T6 — Real browser and replay.** Use fresh mapped-alpha fixtures with dynamic IDs, retained until verification finishes. Through the actual browser choose signed robust mode, explicit holdings and positive regularization; Optimize, inspect targets/objective, Validate/save, change draft settings, retrieve through a fresh client and click Replay. Require a visible successful response, unchanged frozen references, zero unexpected differences and maximum numeric replay difference at most 1e-8. A manual API request alone does not establish the browser journey. Fixtures remain clearly labeled test-only.

## 3. Bounded verification

One targeted correction pass, at most one repair of a demonstrated in-scope failure, then one final verification on a frozen revision. Finite timeouts; no automatic reruns until green. Continue safely isolated suites after an unrelated failure, but do not count required skips, cancellations or loader errors as PASS.

Run both A2.1 tests, the D5 Simple T1–T6/persistence verification and workspace typecheck. Preserve logs or durable test reports.

If application source is unchanged, existing regression evidence is reusable ONLY if retrievable and tied to identical application source. Rerun relevant suites once when evidence is unavailable; do not infer PASS from an inaccessible historical summary.

If application source changes, run affected accepted A1, A2, A2.1, B2, B3, D1, D2, D3 and D4 suites once. Include A3, B1 or C1–C3 when the correction affects their shared behavior. Do not open unrelated feature audits or revive obsolete D5-L1 acceptance tests.

A non-reproduced historical timeout with insufficient evidence can be recorded as unresolved history. Explaining its original cause is not a new closure requirement.

## 4. Deliverable and stop

Save and return a concise **D5 SIMPLE COMPLETION REPORT**, separately from the original D5 BLOCKED report:
- Final application revision and whether application source changed.
- A2.1 cause established, fixture correction and coverage, or exact unresolved cause.
- A2.1-1 and A2.1-2 expected/observed PASS or FAIL.
- D5 Simple T1–T6 expected/observed PASS or FAIL.
- Executed versus reused regression evidence, distinguished explicitly.
- Typecheck result.
- Actual browser-created IDs, replay status and measured maximum ledger/replay differences.
- Exact remaining blocker, if any.

All required evidence passes: **D5 SIMPLE CLOSED. STOP.**

Any required gate remains unresolved: **D5 SIMPLE BLOCKED**, identify the precise failure and stop.

Do not begin D6 automatically. No additional cost features, broad refactoring or new acceptance conditions after this scope is satisfied.
