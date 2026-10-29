# Pending private-runtime verification and return to Replit

**Not executed by this source-only repair. No full E2E, production-readiness or empirical certification claim is made.** This procedure requires a separate explicit owner approval after review of the draft PR and source-test evidence.

## Preserve the original lineage and private data

The public handoff snapshot `90b7b7e2e7ff0a04364be58f8f59cfd801a8e382` was constructed from reviewed source files, with public `main` as its parent. It is not a replacement for the original Replit history beginning at `d51dd4a4fefbdd6a05dedf112b345ca7b3debf71`.

After approval, apply **only the reviewed P0 repair commits/diff** onto a separate verification branch derived from the current original Replit lineage. Preserve any later owner work. Do not merge or cherry-pick the code-only snapshot itself: it intentionally excludes private files. Do not reset, clean, force-push, overwrite the running checkout or change the deployment branch as part of verification. Resolve any overlapping later changes explicitly and rerun all affected tests.

Keep the existing private historical CSV, reports, PostgreSQL state, saved runs and secrets private. The reference CSV remains required by `calendar-v2.ts`, persistent dataset bootstrap and `p0-calendar.ts`; database availability does not remove that filesystem dependency. Verify its approved identity against `SOURCE_SYNC.md` and the existing local provenance without copying it into the public PR. Its vendor authenticity and redistribution rights are unestablished. No substitute dataset may be presented as that private snapshot.

Use an isolated verification checkout/runtime and a separately approved test database or isolated database copy. Use a new run-store directory outside source and certified artifact paths. Do not point acceptance tests or migrations at the live owner database, change the owner's active workspace or overwrite earlier attempts/results. Preserve preview authentication. No paid data retrieval, broker interaction, orders or real-money operation is part of this procedure.

## Required runtime acceptance

| Check | Evidence to retain privately |
|---|---|
| Provenance and build | Original lineage HEAD, reviewed repair commit IDs, private dataset ID/version/hash, dependency/runtime versions, backend/frontend typechecks and production builds. Record any later-source reconciliation. |
| Original three failures | Replay the precise owner configurations behind invalid minimum holdings, below-3% holdings and eleven holdings against 1–10. Retain normalized requests and exact outcomes, not just screenshots of vanished errors. |
| Static rejection | Submit null/blank/zero/negative/fractional/garbage/nonfinite minimum holdings, incoherent bounds, insufficient candidates and impossible exposure/weight combinations. Show actionable 4xx categories and **zero** created runs, attempts and worker starts. Include UI Run gating and restored saved drafts. |
| Full financial workflow | Through the actual built application and authenticated API: configure → preflight → submit → poll → results → rerun. Use the real PostgreSQL-backed dataset binding, production worker IPC and immutable run store. Demonstrate plan/execution fold agreement and no stale cached result. |
| Bounded long campaign | Use at least eleven eligible ETFs, maximum ten holdings and 3% minimum. Extend beyond the original observed signal failure point. Audit every invested rebalance and all effective positive capital-overlay targets. Do not reduce the owner's requested period silently to manufacture success. A deliberately bounded test must state its actual dates and signal count. |
| Independent capital clock | Monthly ETF allocation with daily HMM monitoring must demonstrate multiple cash → invested → cash transitions within a month. Keep intramonth ETF composition frozen, reuse it on re-entry and show that optimizer refreshes occur only on the allocation schedule. Also execute rebalance-only monitoring. |
| Cash and dynamic infeasibility | Explicit risk-off cash remains valid for positive minimum holdings. A positive frozen-composition/weight-floor or risk conflict must return an actionable data-dependent diagnostic; do not rescale, change support or optimize again intramonth to hide it. |
| Dataset and warmup | Exercise real dataset boundaries, symbol exclusions/missing history, training start, feature warmup, earliest executable OOS date and the immediately preceding invalid boundary. Verify exact dates and `DATA_COVERAGE` before run creation. Never move dates or enlarge training silently. |
| Accounting and timing | Reconcile quantities, prices, cash, initial/re-entry/recurring turnover, transaction cost and slippage from the actual ledger. Verify prior-information cutoffs and execution alignment; future-only price mutations must not affect earlier decisions or wealth. |
| Reproducibility and goldens | Same normalized spec/data/code yields reproducible financial results. Re-runs create a new attempt without overwriting old evidence. Compare known-feasible/no-mandate historical results and benchmark/cost/turnover values with the preserved baseline. Explain intentional mandate-induced selection changes; any unexplained drift blocks acceptance. |

For each invested rebalance, retain selected support/tickers, support size, positive minimum/maximum NAV weight, exposure ceiling and actual exposure, covariance/risk diagnostics, solver status and convergence certificate, objective, constraint residuals, methodology/code version and normalized financial inputs. Keep frozen composition separate from effective daily NAV weights. No “winner” or alpha claim follows from passing these mechanics checks.

## Commands and test interpretation

Run the documented source-only suite first:

```sh
node scripts/reproduce-optimizer-baseline.mjs
node scripts/test-optimizer-repair.mjs
```

The existing dataset-dependent suites include `scripts/test-coordinated.mjs`, `scripts/test-institutional.mjs` and `scripts/test-portfolio-feasibility.mjs`. Inspect their input/output dependencies and run them only in the isolated approved runtime with the required private artifacts. Tests whose expected public error category was intentionally versioned must reflect the reviewed contract; do not weaken financial expectations or mark absent-data failures as passes.

The source-only HTTP adapter is not the production background worker. The runtime acceptance above must additionally use the actual production server/worker and selected persisted dataset, even when the source suites are green. Record exact commands, exit codes, pass/fail/skip counts, actual coverage and reasons for any pending item. Do not describe a skipped private-data golden as reproduced.

## Release boundary

Return sanitized summaries and reviewed test outcomes to the PR; do not upload raw private prices, historical reports, workspace state, tokens or database dumps. Resolve all acceptance failures and obtain explicit owner approval before any separate Replit update/publication decision. This repair task creates a draft PR only: it authorizes no merge, deployment, public dataset publication or modification of the running Replit application.
