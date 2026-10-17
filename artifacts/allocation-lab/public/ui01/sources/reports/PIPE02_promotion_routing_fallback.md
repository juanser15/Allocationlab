# PIPE-02 — Promotion, Logical Routing and Explicit Fallback

**PASS — scoped mechanical research/governance certification**, `promotion-routing-1.0.2`. PIPE-02 ends at target selection/certification. No broker integration, order generation, order transmission, live/paper connection, financial model, optimizer, signal, strategy, correlation pruning or economic-alpha claim was added. No user-facing consumer or UI was built.

Repository `/workspace/Allocationlab`, `juanser15/Allocationlab`; branch `work`; commit `1163a0b574b573004372a3a2fc8752810dea7ef9`. The initial checkpoint froze **7,406 pre-existing files** and git status before editing. All CL/CRE/AL baselines, PIPE-01, the existing dirty calculator, B1/B2/B3, production optimizers, routes, UI, DB, package manifests and lockfiles remain unchanged. No reset, checkout, discard, push, merge, deploy, dependency reinstall or production-service access occurred.

## Architecture and files

New implementation is isolated under `research/governance/`: `contracts.ts`, `common.ts`, `promotion.ts`, `bank.ts`, `router.ts`, `storage.ts`, `data.ts`, `fixtures.ts`, `governance.test.ts`, `cli.ts`, `independent.py`, `verify-hashes.mjs` and `render.py`. Existing components are read-only. AL-01 canonical hashing and CRE CSV/frozen-storage utilities are reused; PIPE-01 target types are imported as types, not runtime financial execution.

The core has three distinct responsibilities:

1. Evaluate a frozen PromotionEvidence packet against an explicit versioned PromotionPolicy.
2. Validate immutable promotion/activation transitions in a temporal registry.
3. Route a certified PIPE-01 result to an exact already-certified primary/previous/fallback target, or an explicit no-target/block.

No allocator, selector, beta estimator, ExposureController, research accounting engine or broker is called. The fixed certification driver requires `--certify` and refuses more than 500 routing jobs. The final suite has **303** inexpensive logical jobs, zero financial-model runs, zero optimizer calls, zero research-selection reruns and zero backtests. The build/dependency and source-boundary evidence are persisted.

## Promotion policy, evidence and governance boundary

Lifecycle: RESEARCH -> VALIDATED -> PROMOTABLE -> PROMOTED; explicit suspension/resume and terminal retirement are separately recorded. RESEARCH has no mechanical approval; VALIDATED has frozen mechanical certification; PROMOTABLE passes an explicit mechanical policy. None implies PROMOTED or ACTIVE.

PromotionPolicy declares eligible allocation modes, required certifications/gates, minimum outer OOS folds/observations, optional economic hurdles, required robustness/reproducibility, allowed blockers, manual-approval requirement, authority reference, clocks and provenance/hash. Supported optional screening fields are CAGR, annualized CAPM residual, PSR, absolute MaxDD magnitude, average beta, downside/tail beta and turnover. There is no global economic hurdle, universal quality score or hardcoded 1% alpha definition. The 1% hurdle appears only in a synthetic threshold test.

Mechanical evaluation returns PROMOTABLE, NOT_PROMOTABLE or DEFERRED_BLOCKED. Missing required evidence/unallowed blockers defer; explicit mechanical/threshold failures do not become warnings. PROMOTED requires a separate APPROVE PromotionDecision bound to identity, evidence hash, policy hash, evaluation hash, explicit actor/authority, decision time, availability and reason. REJECT/DEFER cannot approve use. Even a policy without a manual requirement still needs a separate authorized record; no self-promotion path exists.

Evidence is copied from the frozen AL-07 selected-candidate sources and PIPE-01 certification artifacts: outer/fold results, selection stability, PSR table, alpha/risk diagnostics, gate outcomes, cost scenario, candidate/config identity, RiskMandate hashes and code/data hashes. All references are checked against the pre-edit checkpoint SHA256 values. New data is never substituted. A changed source path/hash is rejected rather than updating an old packet. Packet values and all journal records are content-addressed and immutable; a future performance packet is a separate object.

Four real source groups exist: two frozen campaigns x 0/5bps. Each is represented in RESEARCH_GOVERNANCE and a separate QA_ONLY copy: **eight frozen-real-source packets**, plus two synthetic packets for controlled lifecycle examples. The real packets copy normalized OOS summary values exactly. Full realized beta is not relabelled average beta; pooled PSR is not invented from per-fold PSR. Those two scalar fields remain null, while the original risk/PSR artifacts remain referenced. A policy requiring an unavailable scalar returns DEFERRED_BLOCKED. Absolute MaxDD is an explicit unit conversion of the frozen signed drawdown, not a recalculation from prices.

Actual policy is deliberately mechanical/permissive: minimum 2 outer folds, 20 observations, AL-07/PIPE-01 PASS, portfolio robustness PASS, reproducibility PASS, no economic hurdles, and explicitly allowed inherited limitations. This is not institutional economic approval, evidence of alpha or a new holdout. All actual entries remain **PROMOTABLE / INACTIVE**. All six APPROVE records are **QA_ONLY** under a synthetic authority; there are **zero actual research promotions**. Scope validation prevents QA approval/certificates from authorizing the actual registry.

## PIT distinction in the real replay

Certifications and governance records produced in 2026 were not available in 2020–2021. PIPE-02 does not backdate them into those years. Frozen-source availability is anchored to the certification day (`2026-10-17T00:00:00Z`), with the labelled archival review clock `2026-10-17T00:06:00Z`. These are declared certification-fixture clocks, not claims of contemporaneous operational publication at midnight; the current actual-source registry is proposed research governance with no external approval. Timestamp authenticity, like actor authenticity, remains the responsibility of the supplying governance system. Three separate experiments preserve the distinction:

| Experiment | Logical outcomes | Meaning |
|---|---:|---|
| Archival identity replay, QA_ONLY | 96 USE_PRIMARY_TARGET | Exact frozen targets under an explicitly permissive archival test policy; not ex ante governance |
| Current actual research registry | 96 NO_NEW_TARGET | Actual approvals absent; actual entries inactive; old targets/current market health not certified |
| Original decision-date PIT audit | 96 BLOCKED | No contemporaneous policy/promotion/certificate availability; no future approval used |
| Synthetic known-answer branches | 15 records | Explicit primary/failure/hold/stale/fallback and late-preapproval cases |

The **96/96 archival comparisons pass exact full-object target equality** with PIPE-01, including target IDs, weights, cash, expected risk, mandate hash and execution convention. Both AL-07 protocols and both cost scenarios are included. No candidate is reranked or replaced; no newer performance is computed. These observations remain previously inspected research periods, not a new holdout.

DataHealth distinguishes MARKET_INFORMATION, ARCHIVAL_ARTIFACT_INTEGRITY and SYNTHETIC_INFORMATION_SET. A current archive-byte check is not fresh market data. Policies explicitly declare accepted kinds and maximum age. Actual current governance accepts MARKET_INFORMATION; the archival integrity attestation cannot satisfy it. The QA replay explicitly accepts archive integrity and a 10,000-day target-age bound solely to check immutable old-target identity. Synthetic clocks/health assumptions are separately labelled.

## Logical routing and fallback

RoutingPolicy provides explicit condition priority and per-condition action. Conditions cover primary PASS, signal failure/insufficient data, allocation failure, robustness failure, risk-target infeasibility, missing artifacts, promotion denial, inactive entry and stale data. Unknown/unhandled conditions default only to BLOCKED. An explicit rule cannot force USE_PRIMARY_TARGET through a failed or ineligible primary.

| Action | Result |
|---|---|
| USE_PRIMARY_TARGET | Exact certified PIPE-01 target, with no edits |
| HOLD_PREVIOUS_CERTIFIED_TARGET | Exact latest permitted prior certificate/target |
| USE_PREAPPROVED_FALLBACK | Exact separately certified, previously promoted fallback target |
| NO_NEW_TARGET | Null selected target; no implicit liquidation/cash |
| BLOCKED | Null selected target with an explicit blocker/error |

Hold policy declares maximum origin-target age, required current health, exact RiskMandate match requirement, whether current mechanical recertification is required, its nonempty explicit check list, maximum consecutive holds and the invalid-hold action. Age is measured from the original decision date, not a republished certificate timestamp. The latest supplied prior selected route is checked; current approval/activation and required certifications/gates must still hold. Empty or stale recertification attestations do not qualify. Hold counters use the visible prior routing prefix.

Fallbacks are immutable preapproved definitions with configuration identity, exact target-certificate hash, approved RiskMandate hash/policy reference, gates/certifications, evidence, bank entry and validity window. The bank must already be PROMOTED when the fallback definition became available, and its target certificate must already exist then. Current activation/validity are checked again. A certificate/approval first appearing at failure time cannot retroactively validate a purported old fallback. The policy must explicitly allow any different preapproved RiskMandate. There is no fallback generation, equal-weight substitution, emergency optimization, beta reduction or cash increment in the router.

The synthetic sequence is explicit: t0 primary target A; t1 robustness failure with valid prior A -> HOLD exact A, original failure retained; t2 A beyond the 2-day age limit -> NO_NEW_TARGET. Another branch selects exact preapproved F. Missing, retired, newly created or retroactively certified fallbacks block. A successful logical fallback does not rewrite primary ROBUSTNESS_GATE_FAIL as PASS.

Only the existing ExposureController's implementation cash is present inside an already-certified target. Router/bank/promotion functions never recompute q, lambda, beta, cash, gross/net or costs. Target objects are deep-frozen copies with exact identity. The original target's research execution convention remains data; no execution function consumes it here.

## Temporal bank, persistence and resume

See `PIPE02_bank_boundary.md` for the full boundary. Definitions preserve research identity, family/underlyings/market/region metadata and optional frozen return/correlation/cluster/diversification references. No correlation, covariance, clustering, pruning or active-set model runs. Activation comes only from explicit external records.

Events form an immutable sequence/previous-hash chain. Both effective and availability clocks determine the visible prefix. Future approval, suspension, retirement, performance, correlation references and fallback replacements cannot change an earlier route. A retired entry remains in historical records and cannot be resumed. Future versions need separate identities rather than overwriting a current definition.

The local journal publishes complete files atomically with exclusive links and validates content, business key, input identity and code identity before reuse. Routing business keys include experiment, context, stream and routing clock; synthetic branches are separate experiments, not conflicting rewrites of one historical decision. Promotion transitions use entry/sequence keys. Conflicting rewrites or corruption are rejected. Failed logical records remain durable.

The final replay pauses after **1 route** with all 36 promotion/activation transitions already committed; resume creates **302 pending routes**, reuses the first and repeats no transition. A completed repeat creates **0 new routes / 0 new journal records**, reusing all **303 routes**. Byte hashes cover consolidated ledgers and all journal envelopes in `reproducibility.json`. This is filesystem-level research persistence, not a distributed transaction store, broker recovery guarantee, WORM archive or identity/authentication service.

## Tests, independent oracle and retained FAIL evidence

**37/37 tests PASS, 0 failed, 0 skipped**; individual cases A–AK are in `test-results.json`. They cover every required A–R fixture plus explicit thresholds/blockers, permission/scope, hold count/health/recertification, future effective/availability clocks, exact fallback identity, missing artifacts, source provenance/underlyings and preapproval causality. Actual functions are used; no financial function or router is mocked to manufacture a PASS.

Independent Python reconstructs promotion threshold outcomes, temporal lifecycle state and **all 303 routing actions/selected targets** from persisted inputs, without importing the original router or promotion functions. It checks frozen-source SHA256 values, exact copied metrics, 96 original PIPE-01 targets, CSV RFC4180 row counts, JSON round-trip and unique routing business keys. An independent Node script separately verifies canonical seals, target IDs and every journal envelope. Counts and statuses are recorded in `independent-verification.json` and `independent-hashes.json`.

Preserved initial evidence:

- Initial typecheck failed on two TypeScript union-inference annotations; fixed in new files only, logs retained.
- `tests-first.log`: 28 PASS / 1 FAIL. A stale-health fixture accidentally retained an old seal; the router correctly blocked the tampered object. The fixture was resealed to test genuinely stale data, and a separate tamper test preserves the required BLOCKED behavior.
- `tests-hardening-before.log`: 29 PASS / 2 FAIL. Unused future-effective fallback records contaminated historical identity, and an empty recertification could pass. The identity now includes only the fallback/recertification actually consumed, and policy-required named checks must pass.
- `tests-provenance-before.log`: 35 PASS / 1 FAIL. The real-source adapter inherited synthetic envelope provenance and incomplete bank underlying labels. Root source hashes/IDs now bind actual frozen references and target files; bank instrument IDs come from frozen targets. No target/action changed.
- `tests-preapproval-before.log`: 36 PASS / 1 FAIL. A purported old fallback could reference a later certificate/approval. Preapproval now verifies certificate availability and promoted bank state at definition availability, independently of current state.

Earlier journals/source/manifests are preserved under `pre-final-scenarios/`, `pre-provenance-fix/` and `pre-preapproval-fix/`. Pre/post comparisons distinguish intentional versioned provenance changes from target/action economics. These were offline classification validations; **no financial experiment/backtest was rerun**. No prior baseline or test was changed to hide a failure.

## Commands, outputs and acceptance matrix

`commands.json` records commands, exit codes and logs, including initial failures. Final build, tests, strict typecheck, replay/resume, independent checks, charts and whitespace checks exit 0:

```bash
./artifacts/api-server/node_modules/.bin/esbuild research/governance/governance.test.ts research/governance/cli.ts --bundle --platform=node --format=esm --packages=external --metafile=reports/pipe02/build-metafile.json --outdir=artifacts/api-server/dist/pipe02 --out-extension:.js=.mjs
./node_modules/.bin/tsc --noEmit --module esnext --moduleResolution bundler --target es2022 --types node --typeRoots artifacts/api-server/node_modules/@types --skipLibCheck --strict research/governance/*.ts
node artifacts/api-server/dist/pipe02/governance.test.mjs reports/pipe02
node artifacts/api-server/dist/pipe02/cli.mjs --certify --max-new-routes 1
node artifacts/api-server/dist/pipe02/cli.mjs --certify
python research/governance/independent.py reports/pipe02
node research/governance/verify-hashes.mjs reports/pipe02
MPLCONFIGDIR=/tmp/pipe02-mpl XDG_CACHE_HOME=/tmp/pipe02-cache python research/governance/render.py
git diff --check
```

All requested promotion/bank/routing/fallback CSV/JSON/JSONL outputs, seven PNG charts, frozen source catalog, compact input snapshots, exact comparisons, journal, pause/resume/reproducibility evidence and machine verification are under `reports/pipe02/`. `routing-ledger.jsonl` wraps each immutable record with its experiment namespace. The package inventory includes all new code, reports and retained evidence; baseline dependencies/data remain referenced by their original hashes.

| Criterion | Status | Evidence |
|---|---|---|
| 1. PROMOTABLE distinct from PROMOTED | PASS | A–C, AG; separate evaluation/decision/transition |
| 2. PROMOTED distinct from ACTIVE | PASS | C, E, Z; explicit activation records |
| 3. Frozen research evidence only | PASS | O, AJ; source catalog and independent copy checks |
| 4. Deterministic/PIT routing | PASS | N, Q, Y, AA, AF; original-date blocks |
| 5. Primary failure preserved | PASS | G–K; failure-summary.csv |
| 6. No dynamic fallback generation | PASS | K, AK; preapproval-time proof |
| 7. No silent equal-weight/cash/beta fallback | PASS | L, M; exact full targets / null outcomes |
| 8. Hold staleness enforced | PASS | H, I, W, X, AE; explicit invalid action |
| 9. Immutable fallback identity | PASS | J, K, AB, AK; hash and temporal approval checks |
| 10. Target/RiskMandate unchanged | PASS | L, M; 96 exact comparisons |
| 11. Future registry changes do not rewrite history | PASS | N, O, Y, AA, AD, AF |
| 12. Bank contract without active-set/pruning | PASS | contracts.ts; bank boundary; static audit |
| 13. No broker/order/live-execution scope | PASS | P; build/import audit; zero runtime financial calls |
| 14. Resume/idempotence | PASS | Q, R, AC; 0 new records on final repeat |
| 15. Strict typecheck | PASS | typecheck-release.log |
| 16. git diff --check | PASS | diff-check.json; added-source checks too |
| 17. Baselines intact | PASS | checkpoint.json / preservation.json, 7,406 SHA256 matches |

Mechanical PASS does not approve any candidate for actual use. Historical governance availability remains blocked, fresh market-data health is unavailable, inherited factor/strategy/legacy Node-3 limitations remain explicit, and no unavailable scalar is fabricated for an economic hurdle. No real promotion, new active-set selection, economic winner, alpha claim, production execution, broker connection, UI or automatic next block follows this closure.
