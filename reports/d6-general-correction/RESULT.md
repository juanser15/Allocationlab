# D6 general correction attempt — BLOCKED

Base revision: `90ce5f4cf54193a6ec5fc9b1a507ebbecd34247d`.
Application changes remain uncommitted. Source manifest SHA-256:
`ba2fa94864eacdfef43e3d48bbae109d3e77c88164f542f920d1054a48d33fb4`.

## Cause: directly observed once

One in-process reproduction using retained allocation #291, policy preparation #316,
evaluation #317 and #515's assumptions ran from 06:10:40.034 to 06:10:48.691 UTC on
2026-09-30. The unchanged B3 implementation ran its own zero-regularization branch
with its independently carried holdings. It reproduced the exact failure:

`D5 zero-regularization comparison failed: Invalid target exposure for D6B on 2025-11-03.`

At that decision, the kappa 0.25 / lambdaR 0 solver returned the finite JavaScript
number **-3.686945489064785e-15** for D6B. The candidate-to-asset mapping was identity;
the mapped B2 exposure and A1 input were the same literal value. A1 observed
`enabled=true`, `finite=true`, `allowShortPositions=false`. The rejecting clause
was exactly `!allowShortPositions && weight < 0`.

The robust solver had accepted a primal residual of **5.248024237403115e-13**
and stationarity residual of **1.2906675692691119e-9**, both below its existing
**1e-8** limits. B2's feasibility tolerance is also 1e-8 (general KKT 1e-6).
This is a demonstrated numerical representation mismatch, not evidence of a Ridge
forecast defect or infrastructure problem. The historical HTTP 502 remains unexplained.

Raw solution, objective matrices, constraints, mapping, frozen requests, carried
holdings and execution checks are retained in `reproduction-trace.jsonl`;
the selected rejected solve is `rejected-solver.json`. `frozen-inputs.json` includes
the original retrieved records. These are separate from all old evidence files.

## General implementation

The long-only B2 path now bounds canonicalization by its existing feasibility
tolerance, retaining raw and executable vectors in solver diagnostics when changed.
It rejects material negatives and nonfinite/nonnumeric coordinates, canonicalizes
only tolerance-sized negative capital coordinates, restores the capital equality
through the largest positive coordinate, and bounds every adjustment by 1e-8.
All original linear constraints, cash constraints and objective optimality are
recertified. The D4 certificate is recomputed without another solve, including its
nullspace case. Mapped negative/nonfinite asset exposures still fail explicitly.
A1's strict long-only guard is unchanged; signed allocation bypasses this
long-only canonicalization and signed execution remains permitted.

There are no ticker/date/ID exceptions in the financial implementation. No dataset,
lambda, kappa, economic parameters, execution dates or tolerances were changed.
#515 was not rewritten and no new Validation Run was created.

## Directed tests and stop

One directed test execution: **4 tests PASS, 0 FAIL** (`directed-tests.log`).
It covers the exact captured rejected vector and objective recertification,
preservation of originals, small/material negatives, nonfinite/nonnumeric values,
other tickers/dates, long-only no-short execution, signed negative execution,
and captured positive/zero regularization solves and robustness variants.

The subsequent root typecheck **FAILED**: the newly added diagnostic-only runner
`d6-directed-reproduction.ts` treats `Response.json()` values as typed objects,
but the compiler types them `unknown` (eight TS18046 diagnostics).
Production correction code and directed tests emitted no listed type errors.
No retry or second correction was made after this failed verification requirement.

Consequently no final browser Validate, fresh-client retrieval, Replay, pre-D6
replay, or affected regression batch was started. Their gates are **NOT RUN**,
not PASS. Full-policy ledger discrepancy and replay maximum difference remain
**unavailable**, not zero.

**D6 BLOCKED. STOP.** The general cause is established and the implementation passes
the directed tests, but the final verification requirements are not satisfied.