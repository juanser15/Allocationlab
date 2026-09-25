# C1 — ONE REMAINING BROWSER CHECK; NO DEVELOPMENT

## Frozen revision and accepted evidence

Application revision: `0c859f78f6a0c658505785ba2512dae142c6e0f7`.

The supplied final report records successful A1, A2, A2.1, A3, B1, B2,
B3, C1 contribution/integrity suites and typecheck on that revision.
It also records successful experiment #7 creation, fresh-client retrieval,
rendered replay, complete financial/summary reconciliation and an isolated
snapshot-free legacy rejection that created zero Validation Runs.

Carry this evidence forward while the application revision is unchanged.
Do not rerun the entire regression batch or restart C1.

The historical A2.1 timeout's exact cause is NOT a closure requirement.
Record it as: "Previously observed timeout; not reproduced in isolated or
final verification; historical cause undetermined." Do not claim it was
fixed and do not investigate it further in this task.

## Sole remaining acceptance case

Demonstrate that a genuinely snapshot-free legacy session selected in the
surrounding application does NOT block access to C1 and use of an explicitly
selected, valid frozen B2 alpha policy.

A successful normal-session browser journey and a separate legacy API
rejection do not, on their own, demonstrate this combined starting state.

## One bounded verification

Budget: one browser scenario, at most 10 minutes, no automatic retries.
No application-source edits, dependency changes, deployment, financial
changes or additional repair pass. If the revision differs, report the
revision mismatch and stop; do not silently reuse incompatible evidence.

Use an isolated browser context. Use existing authentication normally.

1. Select a genuine snapshot-free legacy session through the normal UI.
   Record its ID, confirm missing immutable snapshot through existing
   read-only metadata, and capture the selected state. A session with a
   snapshot, including the previously selected #39, does not satisfy this.
   If needed, use the existing isolated test-fixture mechanism to create a
   temporary legacy record. Never strip a snapshot from a real saved run.

2. While that legacy session is selected, open Backtest and Alpha
   Contribution through the rendered UI. Do NOT run legacy Validate,
   attach a fabricated snapshot, or bypass navigation guards.

3. In C1, explicitly select an existing valid frozen B2 alpha policy and
   its compatible frozen preparation. Reuse a known feasible baseline
   plus single-exclusion configuration and its existing input history.
   Do not generate new alpha libraries, download data or broaden the test.

4. Create the small experiment through visible controls. Confirm that its
   references point to the valid policy, not the snapshot-free legacy run.

5. Reload or use a fresh authenticated client, retrieve the new experiment,
   and click its rendered Replay button. Verify the actual POST request,
   HTTP 200, replay status `pass`, empty differences and visible success.

This is the previously untested starting-state scenario, not a new feature.
Do not mock the API, fabricate a browser trace, or label an unexecuted step
PASS. Use test-environment records only and clean up the temporary legacy
fixture without deleting other runs or changing archived data.

## Report and stop

Return only:
- unchanged application revision;
- legacy session ID and proof its snapshot was absent at the start;
- evidence C1 opened without legacy validation;
- selected valid policy/preparation and new experiment IDs;
- rendered replay method, URL, HTTP status and result;
- screenshot/trace references and elapsed time;
- PASS, FAIL or NOT_RUN with the exact reason.

PASS plus the accepted same-revision evidence: C1 CLOSED; STOP.
FAIL: C1 BLOCKED on the specific observed browser failure; STOP.
NOT_RUN/time limit: C1 remains pending this single check; STOP.

No full-suite rerun, code correction, C2 work or further investigation
is authorized by this task.
