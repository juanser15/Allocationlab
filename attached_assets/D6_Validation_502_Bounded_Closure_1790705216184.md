# D6 — Targeted Validation / Persistence / Replay Closure

## Closed scope and evidence baseline

D6 remains BLOCKED. Do not restart the Ridge implementation or change its economics to make validation easier.

The user supplied a completion report: unit/integration checks cover the implemented Ridge path, but the real browser Validate request for allocation #291 returned HTTP 502 before a Validation Run was saved. Required end-to-end T6–T8 evidence is missing. The reported aggregate is 180 passing distinct cases after test-fixture corrections; three optional seed cases were skipped, not passed.

A subsequent read-only Replit inspection found:
- Clean application revision `daabbc8`; the old report's uncommitted-tree description is stale.
- No observed active D6 validation, and no saved Validation Run linked to #291.
- Existing logs begin after an API restart and do not establish where the earlier request failed.
- The latest/default price dataset still contains test-only D6A–D6E, matching dataset #19.
- Older snapshots reference dataset #13, but this does NOT establish the immediately preceding user dataset. Do not guess that restoration target.

Verify the current revision and activity first. Preserve concurrent work; do not start a second calculation if the previous one is active.

Retained case to inspect and reuse, after confirming identities:
- Allocation #291; frozen policy preparation #316; evaluation preparation #317.
- Synthetic dataset #19: five assets, 620 weekday observations, 2024-01-02–2026-05-18.
- Dataset hash: d8d49a9b4e27a91d5c6c2aad773d84329fa252c8a303c08a2405826725be7b4f.
- Three signals: momentum, trend_quality, volatility.
- Ridge lambdaSignal=1; 252 complete training dates; HAC bandwidth=5.
- Positive D4 kappa=0.25 and D5 SIMPLE lambdaR=0.01, explicit cash-only initial holdings.
- Monthly / same_close evaluation 2025-09-23–2026-05-18.

These IDs identify retained evidence, not assumed database sequence values. Confirm their frozen content before running. If a record is absent or incompatible, report that exact fact; do not silently generate a different case or use latest working data.

## 1. One traced validation, not a blind retry

The old 502 does not prove a timeout, financial error or solver failure. Do not invent its historical cause from absent logs.

For the next authorized browser Validate action:
1. Capture a request identifier, frozen input references, start time and browser request/response.
2. Retain minimal correlated server evidence for request receipt, dataset/panel preparation, each dated Ridge fit/uncertainty/solve, ledger completion, persistence and response. Record durations and exceptions; do not flood logs with matrices or secrets.
3. Check application/process exit or restart evidence if the request disappears.
4. Before any repeat, check whether a job or persisted Validation Run already exists. Do not create duplicate validation jobs because the browser lost a response.

Instrument only what is necessary to locate the failing operation. A diagnostic trace is not permission to redesign observability.

If this traced request succeeds, keep its saved result and complete the remaining acceptance evidence. Do not manufacture a patch for an unreproduced incident.

## 2. At most one correction justified by evidence

If failure recurs, identify the exact operation and observed reason before editing.

Allowed correction: the smallest proven integration, runtime or persistence defect preventing the specified validation. If repeated point-in-time recomputation is the demonstrated performance cause, reuse immutable calculations only when all dataset, candidate, cutoff, timing and parameter inputs match; prove equivalence. Never reuse a future fit or terminal scaler.

If a request-lifetime limit is actually demonstrated, prefer an existing job/status facility if the app has one, preserving the same validation and immutable result. Do not blindly increase timeouts, build a new queue platform, detach untracked background work or report success merely because work was accepted.

If the necessary correction exceeds this bounded scope, return the specific blocker and stop.

Do NOT change:
- Ridge objective, lambda, pooled fitting or training-only scaler;
- target return horizon, execution lag or label-maturity rules;
- balanced-panel policy, minimum history or missing-data handling;
- HAC formula, bandwidth, cross-asset covariance or uncertainty interpretation;
- D3 gross/excess conversion, risk model, D4 robustness or D5 regularization;
- dates, assets, selected signals, constraints or positive test exposures;
- A1 accounting, numerical tolerances, exact replay comparisons.

No reducing the historical window, disabling robustness, replacing uncertainty with zero, substituting old forecasts or dropping failed dates to obtain PASS.

## 3. Complete the existing end-to-end evidence

Using the actual UI and the retained allocation's frozen specification:
- Retrieve allocation #291 and inspect its saved inputs; no need to repeat Optimize if the saved allocation is valid and unchanged.
- Validate against its explicitly selected evaluation preparation. A successful HTTP response must lead to a genuinely persisted completed Validation Run with a ledger, not just an acknowledgement.
- Verify at least three historical fits, their matured labels and cutoffs, nonzero risky exposure and actual executions. Reuse the already passing isolated-fit mathematical checks when their source identity is unchanged; inspect the new full ledger reconciliation maximum.
- Change draft settings only, then use a fresh browser client to retrieve the saved allocation and new Validation Run.
- Use the rendered Replay actions. Capture method/status, visible result, frozen references, unexpected differences and measured maximum numerical difference. Require <=1e-8.
- Replay an identifiable pre-D6 frozen run to check compatibility. A real persisted API replay may satisfy this old-run check; do not invent an additional mandatory old-run browser journey.
- Do not conflate original-ledger reconciliation with replay agreement. Record both.

If no Validation Run is persisted, do not attempt or claim its replay. If an operation remains active, report its identity/stage instead of launching another one.

## 4. Test data must not masquerade as market data

Keep the synthetic fixture available for frozen replay, clearly marked TEST_ONLY. Do not delete dataset #19 or its referenced preparations, overwrite its content, or rewrite archived snapshots.

Do not upload another synthetic dataset as a workaround. Use explicit frozen input references, not the global latest CSV.

Restore a previous working-data selection only if an authoritative saved selection is known and the restoration is safe; do NOT infer it from old snapshots, filenames or sequence numbers. Do not mutate datasets to make another one appear latest.

If the previous selection cannot be established, leave test data clearly identified and report that the user must explicitly select market data before any real-market report. Never claim the live market dataset has been restored when it has not. This is cleanup of the existing test-only requirement, not a new ingestion project.

## 5. Verification budget and release evidence

Authorize one traced reproduction, at most one minimal evidenced correction, and one final verification. A successful reproduction can serve as the final browser run when no further application changes occur. No automatic retries until green.

Set and report finite time bounds before execution; allow at most 30 minutes for diagnosis/correction, plus one bounded final verification batch. If the budget or scope is exceeded, stop with the last observed stage. Do not raise limits repeatedly.

Freeze the final application revision/source fingerprint and preserve diagnostic/test evidence outside temporary-only logs.

Retain T1–T5 results when traceable to unchanged relevant source. Execute the pending T6–T8 evidence and affected D6 persistence/B3 tests. If application source changes, run directly affected accepted A1/A2/A2.1/B1/B2/B3/D3/D4/D5 and D1/D2 compatibility tests once; run C1–C3 only if a shared contract they consume changes. Continue safe independent suites after another suite fails.

The named optional C2, C3 and D5 fixture seeds are not required D6 gates. Report them as optional/not run rather than PASS; do not reopen those stages just to exercise optional seeding. Required D6 evidence may not be skipped or substituted with a seeder.

Typecheck must pass. Do not rerun all 31 suites by habit or demand an explanation of an unreproduced historical timeout to close this stage.

## 6. Completion report and stop

Return a concise D6 closure report:
- Final revision and whether application source changed.
- The 502 cause actually established, or explicitly not reproduced/unknown.
- Correlated request evidence and duration; latest completed stage if blocked.
- Actual allocation/validation IDs, original input references and at least three fit/execution dates.
- T1–T8 status mapped to the original gates below; reused evidence versus new execution clearly distinguished.
- Max ledger discrepancy and max replay difference, separately measured.
- Old-run replay, executed regressions, required versus optional skips, typecheck.
- Whether the working dataset remains TEST_ONLY or which verified selection was safely restored.

All original required gates pass: **D6 CLOSED**, then STOP.
Otherwise: **D6 BLOCKED**, exact unresolved gate and observed operation, then STOP.

No new alpha research, OHLC, nonlinear estimators, cost work, or later stage is authorized.

---

## Original D6 acceptance gates (unchanged)

**T1 — Ridge mathematics.** On an independently calculated fixture with one standardized feature having equal observations at -1/+1, y=-0.02/+0.02, and lambda_signal=1, the fitted intercept is zero and slope is 0.01 under the declared average-loss objective. Verify multifeature collinear cases with an independent reference, unpenalized intercept and objective/normal-equation residuals. Numeric agreement within 1e-8; no grid search.

**T2 — Label timing and leakage.** Verify historical same_close and next_close training-label start/end dates. Immature labels cannot enter fitting. Mutating future prices, outcomes, feature values or working factor definitions cannot change earlier fitted scalers, coefficients, forecasts, uncertainty or trades. Exercise actual B1/B3 paths, not a disconnected feature helper.

**T3 — Preprocessing, identity and missing inputs.** Train-only standardization reproduces independently; constant features contribute zero without being misidentified using future data. Aliases do not add model columns. Distinct correlated signals remain selectable. Missing historical dates and missing current features follow the declared policies, with no invented forecasts or silent candidate-set change.

**T4 — Forecast uncertainty.** Independently calculate date scores, Bartlett covariance, penalized sandwich and full cross-asset V_mu on a deterministic small fixture with shared date shocks; match within 1e-8 and verify PSD. Replicating the same information across assets on the same dates must not create iid-per-row uncertainty reduction. Verify nonzero cross-asset forecast covariance and distinguish it from return risk. No Sigma/T substitution.

**T5 — End-to-end forecast separation.** Feature contributions plus intercept equal predicted excess returns, and adding cash once equals the exact mu received by B2/D4. Independently verify forecast-risk dimensions and D4 objective contribution. Toggling D5 does not refit or change mu/V_mu. Unsupported new-estimator/alpha-stream combinations fail explicitly while existing alpha/signed forecasts remain functional.

**T6 — Historical sequential refitting.** Across at least three decisions, compare the B3 forecast with isolated fits at the same historical cutoffs. Require nonzero risky exposure and actual executions in the declared feasible fixture, valid known labels, independent evaluation metrics and A1 reconciliation within 1e-8. Do not require higher returns or better IC to pass.

**T7 — Saved identity and old-run safety.** Save the fit, allocation and validation; change working data/features/lambda and use a fresh client. Retrieve and replay with identical metadata and max numerical difference <=1e-8. Test an existing pre-D6 run remains reproducible. No overwriting saved models or parameter selection after viewing results.

**T8 — Real browser journey.** Create fresh, dynamically identified fixtures with at least five assets and three executable selected signals, enough warmup and evaluation history. Through the UI select Ridge, explicit lambda, a supported risk estimator, positive D4 kappa with nonzero valid uncertainty, and D5 regularization with explicit holdings. Optimize; inspect coefficients/contribution/formula; Validate and save; change drafts; fresh-browser retrieve and press the actual Replay button. Require observed HTTP success, visible PASS, unchanged frozen identities, zero unexpected differing fields and max numeric replay difference <=1e-8. Synthetic fixtures are test-only, not market evidence. Retain fixtures through the browser test.
