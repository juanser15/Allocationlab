# C1 — T8 Integration Closure

## Status and scope

C1 remains BLOCKED. The latest report records T1–T7, the unequal-warmup correction, Stage A/B regressions and typecheck as passing. T8 remains unresolved.

This specification is self-contained. The original C1 T1–T8 acceptance criteria are included below; do not search other conversations for them.

This authorizes ONE targeted implementation pass, followed by ONE final verification pass. It does not authorize a new feature iteration or another autonomous repair loop.

Fix only:
1. C1 replay's unexplained result mismatches on untouched experiments.
2. Access to the C1 UI flow when an unrelated legacy optimization session is selected.

Preserve the corrected baseline-derived observation lists and every financial convention in A1–A3/B1–B3. Do not change estimators, objectives, constraints, covariance, costs, selection policies, or solver tolerances. Do not start C2 or redesign navigation.

## Reported reproduction

- Untouched experiment #5 reports mismatches at `children[0].B3Envelope.result` and `children[1].B3Envelope.result`.
- Its child B3 replays individually pass. This does NOT establish that the C1 stored copies, references and summary are correct.
- Opening Backtest required validation of the selected legacy session. That request returned HTTP 422: `Legacy run — exact input snapshot unavailable.` The C1 panel never appeared.
- The generated replay request has already been corrected to POST `/alpha-contribution-experiments/{id}/replay` under the existing API base path. Verify this in the browser; do not change it again without evidence.

## 1. Reproduce and identify the exact mismatch before changing logic

Use #5 read-only if available; otherwise create one minimal two-child experiment through the existing preparation/policy flow. Do not hardcode a special case for any experiment ID.

Compare the actual values at these boundaries:
- Frozen C1 manifest and child references.
- C1's persisted child result copy.
- Authoritative persisted B3 record fetched using that child reference.
- Fresh B3 replay output from the child's frozen inputs.
- Persisted C1 summary and independently recomputed C1 summary.

Produce a leaf-level difference, not merely `B3Envelope.result`:
- full field path;
- expected and observed value;
- expected and observed type;
- missing-field status;
- total differing-field count.

Show at most 12 differences in the completion report; retain the full diagnostic in a test artifact if necessary.

Do NOT assume an envelope/serialization mismatch is harmless. Establish whether this is a payload-shape error, persistence error, reference error, or genuine numerical difference.

If the cause cannot be established from these values and the responsible code path, stop with the diagnostic. Do not begin a broad refactor.

## 2. Repair the comparison contract without weakening integrity

Compare equivalent, explicitly defined payloads at each boundary. An HTTP/transport envelope and the financial result it contains are different objects; do not compare unlike representations.

Required checks remain:
- Exact original manifest, candidate/variant identity and exclusions.
- Correct child IDs, policy identity, dataset hashes and frozen assumptions.
- Identical ordered per-decision estimation observations.
- Child financial outputs, target/actual exposures, executions, ledgers, metrics and statuses.
- Recomputed C1 metric deltas and alpha/asset allocation distances.

Stored C1 copies must agree with the referenced stored B3 result. The B3 financial result must agree with independently recalculated frozen-input output. Recompute the C1 summary from the verified children, using the existing formulas and date alignment, and compare it to the stored summary.

Representation-only normalization is permitted only after documenting the exact field and why its economic meaning is unchanged. Transient replay request metadata may be treated separately only if explicitly identified; original run IDs, dataset identity, historical timestamps, decision/execution dates, assumptions and results remain checked.

Never:
- omit `.result`, the ledger, input identity or failed checks to obtain PASS;
- ignore arbitrary fields or use generic missing/null/zero equivalence;
- loosen the existing numerical tolerance of 1e-8;
- substitute saved outputs for actual recalculation;
- overwrite snapshots or summaries to match the replay;
- infer overall C1 PASS merely from child B3 PASS.

If an existing experiment really contains inconsistent persisted content, leave it flagged and unchanged. Fix creation/comparison as appropriate and prove a new immutable experiment is consistent. Do not relabel corrupted records as verified or rewrite their history.

Report comparison coverage: numeric fields compared, nonnumeric identity checks, maximum absolute difference and any checks not run. NOT_RUN must not be reported as zero difference.

## 3. Remove only the incorrect UI prerequisite

The user must be able to open the existing Backtest / Alpha Contribution surface and retrieve saved C1 experiments without first validating an unrelated legacy session.

Separate navigation/read access from permission to execute a particular validation.

- Preserve the legacy replay protection and its HTTP 422 response.
- Do not fabricate a snapshot for a legacy run.
- Do not auto-select the newest dataset or silently substitute another strategy.
- The existing legacy Validate action must still refuse exact validation when inputs are unavailable.
- C1 creation requires explicit selection of an eligible frozen B2 policy.
- C1 retrieval and replay use the selected experiment's immutable references.
- If no eligible policy exists, show a specific creation-blocked state, while retaining access to existing saved experiments.
- Do not run optimization or validation automatically merely to mount the panel.

Make the smallest state/gating change in the existing surface. No new main tab or command center.

## 4. Verify the actual user journey FIRST

Use a controlled environment with real application UI, API and persistence. Reuse existing deterministic fixtures and browser tooling; do not add a new testing stack or download live data for this repair.

Start with a legacy session selected, deliberately reproducing the reported obstruction.

Through visible browser controls:
1. Open Backtest / Alpha Contribution without running legacy Validate.
2. Explicitly choose a valid frozen B2 alpha policy.
3. Create a minimal full-versus-single-exclusion experiment with positive risky exposure and a feasible exclusion.
4. Save it and record the experiment and child Validation Run IDs.
5. Change working configuration and reload through a fresh client.
6. Retrieve the saved experiment unchanged.
7. Click its actual Replay control.
8. Capture the browser-issued POST URL, experiment ID, HTTP response, integrity response and rendered replay status.

The POST must reach the existing `/alpha-contribution-experiments/{id}/replay` route with the correct API base path and selected ID.

Do not replace this test with a manual API request, DOM-forced navigation, mocked success response or forced browser state that ordinary users cannot reach.

Replay must not overwrite the experiment or create replacement child results to hide differences. Reload/view alone must not rerun computations.

PASS requires the untouched experiment to pass the complete C1 audit, not just both B3 child replays. A separate legacy-validation check must still return the expected refusal.

If this journey still fails after the authorized change, stop with the exact response and leaf differences. Do not spend another autonomous pass redesigning the app.

## 5. Preserve negative controls, with a valid positive control

An always-failing audit cannot demonstrate tamper detection.

Keep the existing six isolated integrity controls unchanged in purpose: wrong references, altered child results and altered summary.

For each control, use isolated test records:
- untouched control passes first;
- introduce exactly the specified mutation;
- audit fails for the specific mutated reference/field, not an unrelated pre-existing mismatch;
- a fresh untouched control passes afterward.

Do not mutate real saved experiments for these tests. Do not rewrite their history.

## Original C1 acceptance criteria — unchanged

T1 — Genuine reoptimization
For a deterministic exclusion, compare C1 against independent B3 runs
of the full and reduced policies. Results must match within 1e-8.
Demonstrate that remaining weights are recalculated, not merely rescaled.

T2 — Comparable inputs
Verify identical dates, shared observation windows, candidate definitions,
asset constraints, capital and execution assumptions across variants.
Removing an alpha must not alter another signal's peer universe.

T3 — Metric and distance reconciliation
Independently compute ledger metrics, full-minus-variant deltas and both
allocation-distance levels. Match within 1e-8.
Undefined Sharpe remains undefined.

T4 — Pair experiment
Execute all four policies for a selected pair.
Verify each against an independent B3 run and calculate the differences
from observed outputs, without imposing additivity or a favorable outcome.

T5 — No performance-based filtering
Technically valid weak-performing and highly correlated candidates
remain in the baseline unless the PM explicitly excludes them.
Aliases cannot add economic dimensions or duplicate experiment variants.

T6 — Failure integrity
A required positive-weight candidate is excluded: report infeasibility.
A held-asset price is missing: preserve B3's dated invalid result.
Neither case may become a successful shortened or substitute backtest.

T7 — Temporal and budget protection
Change observations after development ends, including reserved holdout.
Development results must remain unchanged.
Reject more than six distinct policies before execution.

T8 — Real UI/API persistence
Create an experiment through the actual flow, change working settings,
reload and retrieve it. Manifest and child results remain unchanged.
A new experiment cannot overwrite the first.

The existing replay/manifest-integrity requirements and shared-observation corrections supplement T8/T2 verification; this task does not remove them.

## Final verification and closure

After the clean browser journey passes, run once on the final corrected revision:
- Complete C1 suite, explicitly mapped to T1–T8.
- Existing unequal-warmup and future-data controls.
- Six integrity controls, each with a passing untouched baseline.
- A1, A2, A2.1, A3, B1, B2 and B3 regression suites.
- Full workspace typecheck.

If another required test fails, report it and stop; do not authorize yourself a further repair cycle.

Return only:
1. Exact mismatch root cause with before/after leaf values and types.
2. Exact UI prerequisite removed and legacy protection preserved.
3. Real browser experiment/child IDs, replay POST URL, HTTP status and rendered outcome.
4. Maximum numeric differences and number of fields actually compared; identify unexecuted checks explicitly.
5. T1–T8, integrity controls, regressions and typecheck: executed results.
6. Corrected revision identifier and any blocker.

All required checks pass: C1 CLOSED, then STOP.
Any required check fails or is not executed: C1 BLOCKED with the exact failure, then STOP.

Do not start C2, claim the whole product is production-ready, or propose additional C1 features.
