# Issue #2 acceptance map

Contract: [Issue #2](https://github.com/juanser15/Allocationlab/issues/2), including all three source-synchronization comments. The [Phase 0 resolved comment](https://github.com/juanser15/Allocationlab/issues/2#issuecomment-6468571277) authorizes implementation from the reviewed code-only snapshot `90b7b7e2e7ff0a04364be58f8f59cfd801a8e382`. The draft PR targets `source/replit-code-baseline-20261028`, never `main`.

This document maps requirements to implementation and tests; it does not itself assert that a test passed. Exact executed commands, pass/fail counts and build outcomes belong in the final `test-results.json` evidence and PR. **Source-only verification is not full runtime or private-data certification.**

## Ten acceptance criteria

Paths below are relative to the repository root. `optimizer-*.test.ts` and `constrained-optimizer.test.ts` live in `research/coordinated/`; the frontend test lives in `artifacts/allocation-lab/src/research/`.

| # | Issue acceptance criterion | Source implementation and test evidence | Remaining private-runtime check |
|---|---|---|---|
| 1 | Defaults never invalid | `coordinated-p0.tsx::MandateFields` creates a coherent explicit mandate only when candidates exist. Blank/invalid edits stay invalid rather than becoming a substituted financial default. `optimizer-inputs.test.tsx` covers editor and Run gating; `optimizer-preflight.test.ts` covers malformed values. | Confirm the actual saved owner workspace, hydration and browser editing do not revive obsolete invalid drafts. |
| 2 | Min/max holdings valid integers and coherent | Shared `portfolio-feasibility.ts` validates types, finite safe integers, count ordering and eligible-universe size. `parseP0` uses it before data access; the frontend consumes the same feasibility contract. Source tests cover null, blank, zero, negative, fractional, garbage and nonfinite values, duplicate/empty candidates and inconsistent ranges. | Exercise these edits through the deployed-build browser against an isolated real API/store; retain evidence of zero created runs. |
| 3 | No invested solve violates cardinality | `constrained-optimizer.ts` selects and solves constrained supports; `models.ts::optimize` dispatches explicit mandates to it. `constrained-optimizer.test.ts` covers 11+ candidates with maximum ten, joint count combinations and deterministic support search. `optimizer-overlay.test.ts` and `optimizer-api.test.ts` audit invested targets from the actual financial engine. | Repeat the exact owner design and eligible universe across its complete private OOS path. Audit every invested rebalance. |
| 4 | No positive optimized weight below minimum | Support-specific lower/upper NAV bounds are part of the continuous subproblem. `portfolio-numerics.ts` supplies shared support/constraint tolerances. Known-answer 3% cases, volatility-bound cases and engine/API target audits check the returned weights. | Verify all private-path targets, including positive daily overlay states, with the same tolerances and their actual exposure budgets. |
| 5 | No post-solve cosmetic weight alteration | A changed support is re-solved; the final institutional validator is an assertion. Tests cover the L1 transaction-cost kink, independently derived optima, exposure ceiling, volatility, negative covariance and explicit frozen-composition conflicts. Unsupported positive overlay states fail without changing the frozen weights. | Compare actual decision evidence and ledger targets to solver outputs; distinguish the existing capital overlay from weight repairs. |
| 6 | Static feasibility before any run is created | Shared inequalities and request validation precede service/store use. `optimizer-api.test.ts` uses the production router and checks HTTP 422, zero service opening and zero records for malformed/static-impossible mandates; preview creates no records. | Verify actual PostgreSQL/run-store side effects and worker-start counts remain zero for rejected requests. The source HTTP adapter is in memory. |
| 7 | No late failure for pre-detectable static constraints | Preflight rejects count, weight, universe and exposure contradictions without adjusting inputs. Bounded source integration processes more than 85 causal capital signals with 12 candidates and a 1–10 / 3% mandate. Future-data changes do not alter prior decisions. | Run the original long private campaign beyond the observed failure point. Data-dependent volatility, conditioning or positive frozen-overlay incompatibility may still fail with an honest runtime category. |
| 8 | Distinct coverage and portfolio-constraint failures | `research-error-category.ts`, `p0-calendar.ts`, shared feasibility and UI error rendering retain `DATA_COVERAGE`, `PORTFOLIO_CONSTRAINT`, `SOLVER_INFEASIBLE` and `NUMERICAL_FAILURE`. Source preflight tests cover exact requested/training/available dates, earliest OOS boundary, missing symbols and insufficient feature history. | Check the active persisted dataset and private calendar, with actual gaps, training and warmup requirements, through the real worker/API. |
| 9 | Regression tests for the three exact screenshot failures | `scripts/reproduce-optimizer-baseline.mjs` reads the pinned reviewed baseline and reproduces invalid minimum holdings, a below-3% continuous solution and eleven holdings against maximum ten using analytical synthetic inputs. New solver, preflight, frontend and HTTP tests cover the corresponding repaired paths. | Re-run the original owner configurations and retain the before/after evidence privately; source fixtures do not recreate the owner's historical observations. |
| 10 | No Replit update/publish until PR, green tests and explicit approval | Delivery is a dedicated repair branch and draft PR against the handoff branch. No snapshot merge, deployment or Replit modification is authorized. See `replit-verification.md`. | Owner review and a separate explicit authorization are prerequisites to applying the repair delta and performing private-runtime acceptance. |

## Source-only execution boundary

```sh
node scripts/reproduce-optimizer-baseline.mjs
node scripts/test-optimizer-repair.mjs
```

The aggregate source suite bundles solver, preflight, frontend, overlay and HTTP tests. Its fixture modules identify synthetic prices and mathematical inputs explicitly. It does not load the excluded private CSV or replace it at its certified path.

The HTTP integration test exercises the production route factory, parser, planner, normalizer and financial engine with an injected in-memory execution adapter. It verifies configure → plan → submit → retrieve → idempotent submit → rerun, exact fold agreement, immutable prior attempt evidence and deterministic financial results within that adapter. It does **not** certify production worker IPC, PostgreSQL, the production filesystem store, the actual Replit browser or restart behavior.

Overlay tests include both controlled causal stress fixtures and the actual Gaussian HMM on a declared synthetic two-regime price fixture. They verify repeated cash/re-entry, frozen intramonth composition, independent monitoring clocks, next-observation execution ordering, nonzero cost/slippage where trades occur and self-financing accounting. This is mechanical financial evidence, not an empirical performance claim.

## Financial limits to keep explicit

- Position limits apply to total NAV. Frozen risky proportions and effective NAV targets are different quantities and are reported separately.
- Exposure remains a ceiling. The exact-investment capacity inequality is available for an explicitly exact policy; the ordinary API is not changed into an equality budget.
- An explicit zero-exposure risk-off state is valid with positive minimum holdings. A positive exposure too small for the frozen composition is not silently converted to cash or repaired: it receives an explicit infeasibility diagnostic.
- Static preflight proves necessary conditions, not future covariance, candidate viability or numerical convergence.
- Bounded support exploration does not establish global optimality for unenumerated supports. A search-limit failure must not claim mathematically proven infeasibility. Per-solve audit evidence and solver limitations remain reviewable.
- Known-answer analytical checks and synthetic accounting/PIT regressions do not replace the private historical golden comparisons required for full acceptance.
