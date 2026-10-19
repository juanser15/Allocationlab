# AL-06 — Portfolio Robustness Gate

**AL-06 mechanical certification: PASS.** Fourteen criteria are certified; criterion 2 remains **BLOCKED_SOURCE_NOT_AVAILABLE** because the legacy Node-3 source is absent. This explicit source blocker does not cause a mechanical FAIL, per the user's clarification. The isolated observer mechanics pass **52/52 tests**, with 0 skipped, and independent verification is recorded separately. Version `allocation-gates-1.0.3`. No AL-07.

The gate reads already-computed ASSETS, FACTORS and STRATEGY_STREAMS results. It does not call an allocator, create perturbations, change q/a/H·a, mutate RiskMandate, choose target risk/cash, generate forecasts/strategies, route fallback, promote or execute. All sources, including previously failed/infeasible allocations, remain in the output. `eligible_for_promotion` is a diagnostic boolean, not a production action.

## Contracts, policy and hard checks

The signal and portfolio entry points have separate input contracts and purposes; they share only the status/component taxonomy and explicit policy envelope. Policies are versioned, hashed and dated, with mandatory/warning diagnostics, threshold operators **and units**, minimum observations, numerical tolerances, RETURN_RESULT_ONLY and declared evaluation dates/clocks. Policies are frozen in the manifest before observation. QA thresholds were not tuned using subsequent portfolio performance.

Hard checks are never averaged against good scores: valid allocator status, certified native input semantics, unique decision IDs, complete decision axis, finite weights/exposures, canonical producer/source hashes, PIT consistency of inputs/results/projections/sensitivities/mandate, fully-funded decision convention, all original constraints, convergence/reported KKT/iteration bounds, mapping reconciliation, required risk artifacts, independent beta/vol reconciliation, no allocator fallback and controller compatibility/feasibility. Missing required data is explicit. Mandatory checks absent for a mode cannot disappear and produce PASS.

Native validators and pure diagnostics are reused from frozen AL-01/03/04/05; their optimizers are never invoked. Producer identities are checked using their exact canonicalization/ID recipes. Source byte hashes are separately preserved in the manifest and checkpoint. A valid controller projection must refer to **the same source snapshot, unscaled weights and current risk**; another valid portfolio cannot silently be substituted. Correlation does not determine duplicate identity. AL-05 canonical identity/configuration and explicitly separate execution sleeves govern true duplicate rejection.

Fallback detection examines the allocation **result**, not an external strategy's internal execution configuration. An existing strategy may have declared internal behavior; that is not a fallback invented by this gate. Gate policy cannot authorize an allocator fallback. Source provenance/vendor integrity still depends on the declared source artifact; a hash is not independent historical-publication authentication.

## Concentration and risk breadth

Asset diagnostics: nominal instruments, largest exposure share, top-3 share, HHI and `1/HHI`. Signed/non-net-one concentration uses normalized absolute x, with the explicit label **NOT_CAPITAL_DIVERSIFICATION**; all-zero x has undefined concentration/count, not fabricated zero diversification. Long-only net-one uses the fully-funded capital convention. Strategy allocation concentration is a different object.

With supplied covariance, reuse AL-03 eigendecomposition conventions: entropy covariance effective rank, PC1 variance share and portfolio PCA entropy risk bets, with smallest eigenvalue/condition number. PCA bets are not minimum-torsion ENB. Nominal assets, effective weights, covariance rank and portfolio PCA bets remain distinct. Repeated eigenvalues can make portfolio PCA bets basis-dependent; no robustness claim rests on that number alone.

For strategy allocation, strategy-return covariance rank/PCA bets and current mapped-asset risk breadth are separate. Solution covariance conditioning uses the strategy-return covariance for STRATEGY_STREAMS, and asset/implied asset covariance otherwise. A singular covariance has explicit undefined/infinite condition status; no fake finite cap value. Conditioning alone does not fail unless an explicit required policy threshold applies. KKT/iterations are reported by the certified solver and checked against its declared tolerance/limit; no new optimization is done. The gate reports original asset/group/cardinality/turnover and post-map instrument/group/gross/net constraint slacks and active counts, not a full newly solved KKT-system condition estimate.

## Sensitivities, modes and costs

The offline adapters read the already-certified sensitivity artifacts from AL-03/04/05, retain failed stresses and their families, attach base-allocation hash and PIT research envelopes, and never generate new perturbations. Required missing families/metrics yield INSUFFICIENT_DATA. A required failed stress or a failed stress making a mandatory maximum unavailable yields POLICY FAIL, not an average over survivors. Optional failed stresses can remain warnings **only when the policy explicitly makes them optional**, without weakening a primary mechanical failure.

ASSETS: concentration, covariance/PCA risk breadth, bounds/slacks, covariance and μ/gamma sensitivity when relevant, turnover and source solver diagnostics. μ requirements are not imposed on objectives that do not consume μ. A mandatory turnover-sensitivity family unavailable in frozen artifacts stays insufficient-data rather than being invented.

FACTORS: independently reconstruct B·q−target and its declared W objective. EXACT_FACTOR_TARGET residual beyond the **producer's certified tolerance** is a hard failure. Approximate mode is accepted only if explicitly allowed by the gate policy, and residual remains visible. Independently reconstruct `B′Phi B + D`, systematic/specific/total variance, and current asset beta/vol. Loading, external target, Phi and D perturbations are retained. No factor signal/target generation or pseudoinverse.

STRATEGY_STREAMS: retain every distinct instance, strategy HHI/effective capital count, covariance/PCA breadth, family shares, underlying-strategy group shares (groups can overlap), H·a contributions/netting, current instrument concentration, pre/post gross, internal residual and different return/position betas. Max/median pairwise correlation are raw correlations; pairs/connected-component clusters use the **explicit absolute-correlation threshold** (QA 0.90). Redundancy is diagnostic unless a policy makes a threshold mandatory; no pruning. Signed/financing or internal-residual/non-net-one maps are not silently normalized into a long-only sleeve.

Sensitivity beta basis is explicit: generic beta change is **current-position beta** for strategy artifacts, with `return_beta_change` separately retained. AL-05's available vol-change artifact describes **strategy-return volatility**, not an invented current-position vol stress; its basis is labelled. Existing factor/asset vol changes describe unscaled asset volatility. Objective degradation for assets is computed from the original-objective change with its declared min/max direction; missing factor/strategy objective comparisons stay unavailable.

Turnover separates sleeve L1, strategy-allocation L1 and mapped-instrument L1. These are not actual executed notional. Incremental execution costs are only consumed if an external basis/amount/units is supplied; historical strategy costs already embedded in NET history are not recharged. Currency cost thresholds cannot be compared to risk-capital fractions without an external conversion; mandatory unit mismatch is INVALID_INPUT. No fees, cost sensitivity, execution book or financing costs were invented.

## Target risk compatibility, no second cash decision

RiskMandate is upstream. The gate uses frozen `composeMandatedPortfolio` purely to observe feasibility and retains only diagnostics: sleeve beta/vol, requested target/multiplier, feasible scalar interval, achieved multiplier, expected final beta/vol, implied implementation cash, requested-versus-achieved/clipping and constraint failures. It does not return a newly promoted portfolio or overwrite the source weights.

Authorized clipping requires **both** explicit mandate CLIP and gate permission. Requested/achieved risk remains prominent, with an explicit warning. Unauthorized clipping or an inconsistent reported controller outcome fails. Compatible strategy exposures lacking beta/covariance projection data are INSUFFICIENT_DATA; signed/non-net-one/financing scope is a compatibility failure and promotion false. No `1-net(signed x)` cash inference. Internal stream residual remains internal.

## Frozen observation replay — no optimizer/backtest rerun

| Source | Observations | PASS under fixed QA policy | FAIL under fixed QA policy |
|---|---:|---:|---:|
| AL-03 historical ASSETS | 531 at 177 declared allocation dates | 531 | 0 |
| AL-04 SYNTHETIC FACTORS | 20 | 13 | 7 |
| AL-05 SYNTHETIC STRATEGY_STREAMS | 22 | 14 | 8 |
| Total | 573 | 558 | 15 |

These are **QA classifications**, not claims of economic robustness or recommendations. The base campaign uses largest mapped normalized exposure MAX 1, HHI MAX 1 and maximum stress allocation L1 MAX 2, plus hard checks and declared required families; these permissive values test plumbing. ASSETS requires covariance stresses; FACTORS requires external-target/loading/factor-covariance/specific-risk stresses; STRATEGY_STREAMS requires covariance/bounds/H stresses and μ only where consumed. Correlation >0.95 is a configured warning for strategy replay. Negative-test policies deliberately exercise stricter thresholds without altering campaign policy.

Factor FAILs include two original infeasible results and five cases whose exact-target stress neighborhoods are infeasible. For example, a unique square target can be feasible while an independently moved target plus sum(q)=1 becomes incompatible. The gate closes under the required sensitivity policy; it does not switch to approximate mapping. Strategy FAILs include failed required bounds stresses, original infeasible/missing-μ outputs and signed/non-net-one/internal-residual controller scope. All reasons remain in components/results. PASS does not prove profitability or future stability.

The replay reads the original AL-03 mandates unchanged. Factor/strategy fixtures use one explicitly supplied **synthetic QA beta target 0.30**, constructed upstream before observing the gates; no allocation is adjusted to it. Historical observations use declared historical information-set metadata, **retrospectively replayed research**, not authenticated contemporaneous publication or new OOS/holdout evidence. Frozen source limitations, adjusted-data vintage assumptions and unresolved actual signal history remain explicit.

## Verification, retained failures and preservation

Final **52 PASS, 0 FAIL, 0 skipped** JS cases cover A–W and additional boundary checks. Independent NumPy/SciPy verification checks **590 items**: separate covariance/eigen/concentration/constraint/H·a/risk-feasibility/sensitivity/decision reconstruction, five new canonical signal mathematical oracles, RFC4180/counts and source hashes. It never calls either gate, an optimizer or the controller. Legacy Node-3 equivalence remains NOT VERIFIED. Absolute oracle tolerance is 2e-8, with tighter 1e-12 mapping checks.

Retained evidence: first run **40 PASS / 1 FAIL** exposed an incorrect `!==` date-selector predicate; corrected to `===`, expectation unchanged (v1.0.1). Three independent hardening regressions then yielded **44 PASS / 3 FAIL**: a backdated current ranking evaded age checks; an old matrix could certify current PCA; fallback scanning wrongly included external strategy configuration. Corrected age reference/matrix freshness/result-only fallback detection (v1.0.2), preserved reproductions and added projection/beta/compatibility checks. A strict TypeScript narrowing error during hardening is retained; a const beta-vector binding resolved it without changing arithmetic. Final strict typecheck and `git diff --check` pass.

The checkpoint preserves **3,196 files** byte-for-byte: CL-01/02/03/04, CRE, AL-01/02/03/04/05, Node-3-related local baseline files, calculator including pending correction, B1/B2/B3, production optimizers/routes/API/UI/DB, manifests/lockfiles and all earlier reports/ZIPs. No reset/checkout/staging/push/merge/deploy/install or production connection. Only new `gates/` source/tests, three requested Markdown reports, `reports/al06/` artifacts and an AL-06 ZIP/sidecar. Strict typecheck covers the isolated research module and transitive TypeScript dependencies; no unrelated project audit.

## Files, reproducibility and commands

New core files (10): `contracts.ts`, `common.ts`, `signal.ts`, `portfolio.ts`, `adapters.ts`, `fixtures.ts`, `gates.test.ts`, `replay.ts`, `independent.py`, `render.py`. New requested CSVs/verification/manifest/logs, frozen observation bundles and seven charts are under `reports/al06/`. Full new-source patch and original FAIL evidence are included. Source byte lineage is separated from economic gate identity so key/asset/strategy permutation preserves economics and canonical gate ID while retaining changed raw source lineage.

Exact commands/exit codes are in `reports/al06/commands.json`. Main commands, root unless noted:

```bash
# cwd artifacts/api-server
./node_modules/.bin/esbuild src/lib/allocation-core/gates/gates.test.ts src/lib/allocation-core/gates/replay.ts --bundle --platform=node --format=esm --packages=external --outdir=dist/al06 --out-extension:.js=.mjs
# cwd repository root
node artifacts/api-server/dist/al06/gates.test.mjs reports/al06
node artifacts/api-server/dist/al06/replay.mjs reports/al06
python artifacts/api-server/src/lib/allocation-core/gates/independent.py reports/al06
./node_modules/.bin/tsc --noEmit --module esnext --moduleResolution bundler --target es2022 --types node --typeRoots artifacts/api-server/node_modules/@types --skipLibCheck --strict artifacts/api-server/src/lib/allocation-core/gates/*.ts
MPLCONFIGDIR=/tmp/al06-mpl XDG_CACHE_HOME=/tmp/al06-cache python artifacts/api-server/src/lib/allocation-core/gates/render.py reports/al06
git diff --check
```

All final commands exit 0. New untracked text files also receive `git diff --no-index --check` (exit 1 means a file differs from /dev/null; empty check output means no whitespace error). A repeat observation run checks byte-identical hashes of 17 manifest/bundle/diagnostic CSV/JSON outputs (no optimizer/backtest rerun). No original results are overwritten. The single download is `reports/AL06_reports.zip`.

## Acceptance matrix — mechanical PASS, legacy audit blocked

| Criterion | Status | Evidence / limit |
|---|---|---|
| 1. Two separate gate contracts | PASS | Different inputs/entrypoints; no combined score |
| 2. Exact existing Node-3 formulas/thresholds audited | **BLOCKED_SOURCE_NOT_AVAILABLE** | Four legacy functions absent; original ZIP/source recovery pending, user-authorized mechanical-certification exception |
| 3. No allocation mutation | PASS | W, observer hashes, frozen replay |
| 4. Signal causal/PIT | PASS, new canonical scope | H/U, availability/freshness tests; not legacy equivalence |
| 5. Explicit rebalance gate clock | PASS | Undeclared date rejected; 177 historical allocation dates |
| 6. Mechanical failures cannot be averaged away | PASS | M/N/S/T, mandatory checks, failed stresses |
| 7. Concentration/risk breadth distinct | PASS | Separate asset/strategy/PCA definitions and outputs |
| 8. Supplied sensitivity consumed | PASS | Frozen AL03/04/05, missing/failed metrics explicit |
| 9. All three allocation modes | PASS | 573 observed results |
| 10. Mandate/controller compatibility, target unchanged | PASS | Projection/beta/feasibility/reject/clip tests |
| 11. No fallback in gates | PASS | J, W, result flags, no routing/optimizer calls |
| 12. Independent known-answer verification | PASS, new canonical scope | 52 JS / 590 independent; Node3 identity unverified |
| 13. Strict typecheck | PASS | final exit 0 |
| 14. git diff --check | PASS | final exit 0 + untracked text checks |
| 15. Baselines unchanged | PASS | 3,196 SHA256 matches |

`reports/al06/verification.json` is the machine-readable closure. The legacy audit remains blocked and is excluded from the mechanical PASS only under the user's explicit clarification; its exact formulas, thresholds and 1:1 compatibility are not certified. No legacy state/history, institutional economic robustness, market-timing skill, alpha or significance is fabricated.

Version 1.0.3 applies the user-confirmed source-availability labels and versions the new signal methodology as CANONICAL_SIGNAL_STRUCTURE_1.0.0. Provisional pre-clarification reports are retained under `reports/al06/pre-clarification/`; they are superseded, not the final certification.
