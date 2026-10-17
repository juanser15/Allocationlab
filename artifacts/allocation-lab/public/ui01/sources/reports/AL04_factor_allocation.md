# AL-04 — Factor Allocation & Implementation Engine v1

**Mechanical certification PASS: 15/15 criteria, 51/51 individual tests, zero skipped.** General constrained FACTORS implementation, 20 synthetic fixtures (18 VALID, two expected INFEASIBLE), 154 deterministic local stresses (136 VALID, 18 expected INFEASIBLE), independent reconstruction and six charts. [Machine verification](al04/verification.json).

**Historical economic replay: BLOCKED_MISSING_CANONICAL_FACTOR_ARTIFACTS.** No backtester executions, factor-model fits, target search, financial forecast/signal generation or production adapter. Missing dated inputs are documented separately; this allowed blocker does not turn mechanical certification into an economic evaluation or alpha claim.

## Canonical semantics and architecture

The core implements **e=Bq**, where B is FACTORS_BY_ASSETS, q is long-only fully invested tradable risky-sleeve weights and e is a vector of factor exposures. Only q sums to one. Factor exposures can be signed, zero, greater than one and need not sum one. Scores, percentile ranks, baseWeight and regimeWeight are neither capital weights nor certified loading coefficients; explicit roles, axis IDs, units, dates and content hashes reject those objects.

`implementFactors(input)` consumes an external versioned target, B, FactorRiskModel, W, constraints, optional previous q and separately supplied AL02-compatible asset market-beta estimates. It never creates a target/view, estimates factor covariance, forecasts factor returns or optimizes cash/market beta/exposure multiplier. Target-beta/cash/multiplier fields are rejected. The two modes cannot be switched implicitly.

The primary result is **factor-implementation-1.0.2 / allocation_mode FACTORS**, with unscaled q, factor target/achieved/residual/risk, explicit mapping/model/target/metric references, source/config hashes and beta values/model separately. Gross/net sleeve exposure remain one and the q budget remains fully invested; no residual is hidden in global cash. Malformed input has INVALID_INPUT and no invented result envelope. A valid input that fails implementation retains its provenance, mode and errors, with no fabricated q.

The frozen AL01 FACTORS detail permits only UNIQUE_SQUARE_EXACT. General constrained methods cannot honestly be labelled that way. A pure research instrument projection therefore carries exactly the same q/beta/vol into AL01's existing ASSETS instrument envelope, with **origin_mode=FACTORS**, origin ID/source link and explicit warning. This is not a D1/scoring or production adapter and does not re-optimize or scale q. Full factor-volatility provenance remains in the origin result; the frozen controller's risk-provenance hash remains bound to its beta source as its legacy validator requires. No baseline contract was changed.

RiskMandate is external and immutable. Two different beta mandates applied to the same factor implementation change only controller lambda/final NAV weights/implied cash. Targets are for the **unscaled risky sleeve**: final instrument weights=lambda*q and final factor exposures=lambda*e. Market beta is q' beta_assets, not sum(q), factor-score sum or a PCA loading. It is not inferred from B, even if a factor name resembles a benchmark. All original RiskMandate/ExposureController code remains frozen.

## Contracts, dimensions and point in time

- FactorExposureTarget: explicit kind, factor IDs, target_exposures, factor_exposure units with per-factor units, target ID/version, as_of/information_cutoff and provenance.
- AssetFactorLoadingMatrix: FACTORS_BY_ASSETS, K factor IDs x N asset IDs, loading units per risk-sleeve capital weight, factor kinds (statistical/economic/tradable portfolio), model ID/version and canonical content hash.
- FactorRiskModel: K x K Phi, N x N full D or N diagonal specific variances; **ZERO_SPECIFIC_RISK** must be explicit. Missing D is INVALID_INPUT. No estimation, floor, imputation or regularization is introduced.
- FactorTrackingMetric: explicitly supplied symmetric PSD K x K W, inverse-factor-exposure-squared units, ID/version/content hash and temporal provenance. W is required even for exact-mode residual diagnostics.
- Sleeve constraints reuse AL03 asset min/max, group/sector caps, max active names and **gross L1 turnover versus previous q**. Previous q must have the same instrument axis and sum one. These are risk-sleeve units, not actual total-NAV trades. No cash constraints or master cash coordinate.

Dimensions/axes/finite values/symmetry/PSD/units/hash/model identity are checked. DIMENSIONLESS exposure pairs with DAILY_DECIMAL_RETURN factor returns; DAILY_RETURN_LOADING pairs with STANDARDIZED_DAILY_SHOCK. Both combinations imply asset covariance in daily decimal return squared units. A statistical fixture with B=[.01,.02], standardized-shock Phi=2 and target .015 has q=[.5,.5], systematic variance .00045 and specific .000125, total .000575. No silent reinterpretation as dimensionless beta.

All artifact as_of/publication/cutoff dates must be available by the decision information cutoff, and the decision cutoff is strictly before as_of. A complete-snapshot PIT selector uses the latest supplied as_of no later than decision, ignores future observations before reading their values and rejects ambiguous same-as-of snapshots. Future mutations to B/Phi/D/target do not alter historical selected inputs, q, IDs or diagnostics; direct future artifact availability is rejected. The engine **consumes**, not fits, producer artifacts. This verifies timestamp filtering/consistency of supplied envelopes, not historical vintages, return-model quality or automatic statistical-basis alignment.

## Constrained implementation and lexicographic rule

**EXACT_FACTOR_TARGET** imposes Bq=external target, sum(q)=1, q>=0 and declared bounds/groups/cardinality/turnover. Secondary SPECIFIC_VARIANCE, TOTAL_VARIANCE or TURNOVER is mandatory. It selects among feasible exact q; no portfolio-risk penalty trades away a factor constraint. With exact e, systematic variance is constant, so total/specific variance secondaries coincide except numerical tolerance. TURNOVER is a linear-program epigraph of gross L1 distance to supplied previous q. Infeasible exact targets return INFEASIBLE, never an approximate replacement.

**MIN_FACTOR_TRACKING_ERROR** minimizes (Bq-target)'W(Bq-target). Secondary may be null or explicitly declared with EXACT_LEXICOGRAPHIC_ARGMIN. First solve tracking, then lock **W B q = W B q_primary** and solve the secondary on that argmin face; no hidden lambda combines tracking and portfolio risk. For PSD W, zero quadratic curvature between tracking minimizers implies W B delta_q=0, preserving primary objective. Singular W intentionally leaves some exposure directions unpenalized; weighted error zero does not imply exact e. Residual/L2/max miss remain explicit and mode remains approximate even when the target happens to be reached.

Cardinality is a deterministic union of supports. All certified support candidates are compared with declared tracking/secondary numerical tie tolerances; the primary objective cannot exceed the global certified minimum beyond that explicitly supplied tolerance. No partial winner is claimed if a support encounters numerical failure. Deterministic q lexicographic ordering breaks equivalent objective ties, not an invented economic objective.

Multi-equality rank detection identifies independent equations, including consistent redundant/overdetermined rows, followed by constrained KKT active-face solves. N>K and rank-deficient B are supported. No B inverse, pseudoinverse, unconstrained least-squares fallback, random start, target normalization or equal-weight fallback is used. Singular KKT systems are skipped in favor of other constrained faces; feasible but uncertified systems return NUMERICAL_FAILURE. Workload is bounded explicitly and never truncated.

Declared defaults: primal 1e-10; factor miss 1e-9 in each declared exposure unit; normalized stationarity 1e-9; rank 1e-12 after row scaling; symmetry/PSD absolute 1e-12; tracking/secondary objective tie tolerance 1e-12; max_faces100000, max_supports4096, eigensolver max_iterations10000. These are recorded in each full input and manifest; not increased after a failure. This is a small-problem exact-face v1 solver, not certified as a large-universe platform.

Within-tolerance asymmetry uses the explicitly documented **symmetric part** of Phi/D/W for the objective, Euler risk and spectra; warnings identify affected matrices and raw content hashes/provenance remain intact. No eigenvalue lift/PSD regularization occurs. Roundoff canonicalization zeros only numerical negative weights or explicitly excluded support coordinates, preserves all positive active weights and makes an additive simplex correction bounded by the declared tolerance. Original/applied q and max adjustment are recorded, all constraints/tracking/exactness rechecked and a normalized stationarity bound enforced. This is numerical cleanup, not exposure scaling or a cash adjustment.

## Risk, contributions and diversification

For achieved e: var_factor=e'Phi e; var_specific=q'Dq; var_total=their sum; Sigma_asset=B'Phi B+D; independent q'Sigma_asset q must reconcile. Annualized vol=sqrt(252*var_total). Factor MRC=Phi e; signed RC=e*(Phi e), normalized signed shares when systematic variance is positive. Negative contributions remain negative. If shares are signed or systematic variance is zero, entropy/effective factor bets and probability-style concentration are undefined with a reason, not fabricated or normalized using absolute values.

For the signed fixture e=[1,-.5], Phi=[[.0004,.0003],[.0003,.0004]], RC=[.00025,-.00005], systematic variance .0002 and normalized shares [1.25,-.25]. Factor entropy is undefined. This is hedging in factor coordinates with long-only asset q, not negative capital weights or an alpha claim.

Report factor dimension count, Phi entropy effective rank, dominant eigenvalue share, systematic contribution concentration where meaningful, asset HHI/effective weight count and portfolio entropy PCA-ENB using unchanged AL03 methodology on total asset covariance. **Factor dimensions != asset PCA risk bets; PCA-ENB != minimum-torsion ENB.** Spectra depend on declared units/basis; degenerate eigenvectors can affect PCA risk shares. No diversification/robustness gate or aggregate score is created.

## Synthetic known-answer results

All rows below are **SYNTHETIC**, not historical strategies. q vectors follow sorted ASSET IDs. INFEASIBLE cases are expected oracle outcomes and retain their target/mode/reason; they are not omitted tests.

| Fixture | Explicit mode | Status | q | Maximum factor miss | Systematic daily variance | Specific daily variance |
|---|---|---|---|---:|---:|---:|
| square-exact | EXACT_FACTOR_TARGET | VALID | 0.250000 / 0.750000 | 0 | 0.000325 | 0.00023125 |
| underdetermined-specific | EXACT_FACTOR_TARGET | VALID | 0.480000 / 0.120000 / 0.400000 | 0 | 0.000144 | 6.08e-05 |
| underdetermined-total | EXACT_FACTOR_TARGET | VALID | 0.480000 / 0.120000 / 0.400000 | 0 | 0.000144 | 6.08e-05 |
| underdetermined-turnover | EXACT_FACTOR_TARGET | VALID | 0.480000 / 0.120000 / 0.400000 | 0 | 0.000144 | 6.08e-05 |
| impossible-exact | EXACT_FACTOR_TARGET | INFEASIBLE | — | — | — | — |
| explicit-approximate | MIN_FACTOR_TRACKING_ERROR | VALID | 1.000000 / 0.000000 | 0.5 | 0.0004 | 0.0001 |
| approximate-lexicographic | MIN_FACTOR_TRACKING_ERROR | VALID | 0.400000 / 0.480000 / 0.120000 | 0 | 6.4e-05 | 0.1600288 |
| singular-W-explicit-unpenalized-factor | MIN_FACTOR_TRACKING_ERROR | VALID | 0.400000 / 0.480000 / 0.120000 | 0.42 | 0.00015616 | 4.48e-05 |
| negative-risk-contribution | EXACT_FACTOR_TARGET | VALID | 0.800000 / 0.200000 | 0 | 0.0002 | 8e-05 |
| rank-deficient-B-no-inverse | EXACT_FACTOR_TARGET | VALID | 0.800000 / 0.200000 | 0 | 0.002 | 8e-05 |
| overdetermined-inconsistent | EXACT_FACTOR_TARGET | INFEASIBLE | — | — | — | — |
| asset-bound-active | EXACT_FACTOR_TARGET | VALID | 0.300000 / 0.300000 / 0.400000 | 0 | 0.000144 | 7.7e-05 |
| group-cap-active | EXACT_FACTOR_TARGET | VALID | 0.300000 / 0.300000 / 0.400000 | 0 | 0.000144 | 7.7e-05 |
| cardinality-two | EXACT_FACTOR_TARGET | VALID | 0.600000 / 0.000000 / 0.400000 | 0 | 0.000144 | 6.8e-05 |
| turnover-cap-active | EXACT_FACTOR_TARGET | VALID | 0.350000 / 0.250000 / 0.400000 | 0 | 0.000144 | 6.925e-05 |
| explicit-zero-specific | EXACT_FACTOR_TARGET | VALID | 0.000000 / 1.000000 | 0 | 0.0004 | 0 |
| full-specific-covariance | EXACT_FACTOR_TARGET | VALID | 0.495652 / 0.104348 / 0.400000 | 0 | 0.000144 | 6.29913e-05 |
| unequal-W-tracking | MIN_FACTOR_TRACKING_ERROR | VALID | 0.740000 / 0.260000 / 0.000000 | 0.64 | 0.00024608 | 6.828e-05 |
| statistical-standardized-shock-units | EXACT_FACTOR_TARGET | VALID | 0.500000 / 0.500000 | 0 | 0.00045 | 0.000125 |
| within-tolerance-symmetric-specific-model | EXACT_FACTOR_TARGET | VALID | 0.812500 / 0.187500 | 0 | 0.0004 | 8.3125e-05 |

The square example has target [.5,-.75], sum=-.25 and q=[.25,.75]. The underdetermined one-factor target .6 with D diagonal [.0001,.0004,.0002] yields q=[.48,.12,.4] by inverse specific variances on q0+q1=.6. A supplied previous q equal to that allocation has optimal turnover0. Impossible target1.5 against B=[1,0] is INFEASIBLE in exact mode; explicitly approximate mode returns q=[1,0], residual-.5 and weighted error.25. With singular W, the [.4,.9] target reaches [.4,.48], weighted error0 but miss.42: the free target is not falsely called exact.

## Sensitivity, independent oracles and evidence

Every valid certification fixture receives deterministic declared stresses: per-factor target +/-0.02*unit scale; first canonical loading +/-0.01*unit scale; Phi and specific-risk scales0.95/1.05. Unit scale is1 for dimensionless exposures and max absolute row loading for daily-return loading units; a zero row is explicitly labelled no nonzero loading scale, not assigned an epsilon. Explicit ZERO_SPECIFIC_RISK remains zero and the no-op is labelled. Stress hashes/configs/inputs persist along with q L1/max change, residual changes, beta/vol changes and failures. No stress result chooses a target, model or winner.

There are **154 stresses: 136 VALID, 18 expected INFEASIBLE, zero unexpected numerical failures**. Exact square/redundant constraints can legitimately become infeasible when a single target changes. No approximate fallback masks that boundary.

**51/51 individual tests PASS, zero skipped.** Known independent arithmetic/derivative answers, grid endpoint, expanded risk identity and statistical-unit calculations compare actual implementations. Python independently uses NumPy identities/eigh, SciPy HiGHS primal feasibility/turnover LP with N separate absolute auxiliaries (different from the engine's sign epigraph), pivoted QR equality selection and SLSQP constrained quadratic optimization. It verifies all20 base outcomes, unique base q, all154 stress feasibility/objectives/risk diagnostics and RFC4180 row counts without calling engine/controller/model fitting. Default synthetic abs1e-9; boundary-D q abs1e-12 and Phi Euler abs1e-15; external oracle abs1e-9+rel1e-7 and unique SLSQP q abs3e-7, declared before comparisons.

Pre/post evidence is preserved. First 46PASS/2FAIL reproduced tiny negative boundary q rejected by AL01; bounded explicit canonicalization fixed it without dropping a positive weight or changing tolerance. Additional 49PASS/2FAIL reproduced use of raw within-tolerance asymmetric covariance: D q=.8124999998046875 instead of symmetric oracle .8125000003255208, and incorrect Phi Euler contribution. Correcting Phi/D/W symmetric parts produced final51PASS. Original source/manifests/results/logs remain under pre-roundoff-fix and pre-symmetry-fix. Provenance extension and unit-aware stress manifest revisions are separately archived. No test expectations were relaxed to hide either demonstrated failure.

Manifest freezes synthetic data/config/code before output evaluation; a final identical-manifest rerun reproduces nine output hashes byte-for-byte. Source hashes, full fixture/stress inputs, numerical canonicalization and independent verification are persisted. All code is deterministic. No historical financial performance was calculated.

## Historical blocker and current-system mapping

**BLOCKED_MISSING_CANONICAL_FACTOR_ARTIFACTS**: no dated external targets + tradable B + compatible Phi/explicit D + W stream for every decision date. Existing CL02 adjusted prices do not supply that model, and the frozen factor-library response contains seven percentile-rank feature configurations. D1 is genuine statistical risk math but on alpha-stream candidates, not certified tradable asset columns; omega is alpha x factor, Phi is standardized-shock correlation-eigenvalue covariance, Xi/Gamma are alpha covariance. `factorExposure` is omega' times alpha capital coefficients. Several D1 diagnostics called factorCovariance refer to Gamma's candidate covariance spectrum, not Phi. No unsafe relabelling, inversion or producer adapter is built. [Detailed mapping](AL04_factor_mapping.md).

External producers remain responsible for economic meaning, coordinate/basis identity, historical availability and quality of targets/loadings/risk estimates. The engine checks supplied roles/axes/units/dates/content hashes and implements the mathematical contract. No signal/model fitting, macro-view choice, forecast, alpha discovery or economic robustness claim follows this certification. No repeated searches/download retries or other repositories were inspected.

## Files, verification and download

Only new research/core files under `artifacts/api-server/src/lib/allocation-core/factors-engine/`: contracts.ts, validation.ts, solver.ts, engine.ts, fixtures.ts, sensitivity.ts, certify.ts, engine.test.ts, independent.py and render.py. No baseline source, routes/UI/API/DB/production optimizer changed. [Review patch](al04/new-core.patch), [commands with exit codes](al04/commands.json), [individual cases](al04/test-cases.json), [independent verification](al04/independent-verification.json).

Required CSVs: factor-implementation-results.csv, factor-risk-diagnostics.csv, factor-residuals.csv, factor-diversification.csv, factor-sensitivity.csv; plus verification.json, synthetic-fixtures.json and six charts. Extra complete stress inputs, manifests/source hashes, PIT classification/mapping evidence, reproducibility checks and initial FAIL evidence support audit. CSV RFC4180/CRLF and finite JSON round-trip verified.

Strict TypeScript --strict/--noEmit over every new .ts plus transitive imports PASS; no dependency install or manifest/lockfile changes. git diff --check PASS; untracked source/reports are whitespace-checked separately. **3063/3063 pre-existing files are byte-identical**, including CL01-04/CRE/AL01/AL02/AL03/production/calculator/B1/B2/B3/manifests/lockfiles and prior ZIPs. Branch work / commit1163a0b574b573004372a3a2fc8752810dea7ef9; previous pending changes preserved. No reset/checkout/commit/push/merge/deploy/service access.

`AL04_reports.zip` bundles report/mapping, all results/evidence/charts and the new research sources in one downloadable package; reproduction requires the preserved repo baseline and existing dependencies. Certify Node runner and independent Python/charts/typecheck/diff checks all exit0. The two initial regression runs exit1 are retained, not replaced with a summary-only PASS.

## Charts (all synthetic)

![Target achieved](al04/charts/target-vs-achieved-factor-exposures.png)
![Systematic specific](al04/charts/systematic-vs-specific-risk.png)
![Signed contributions](al04/charts/factor-risk-contributions.png)
![q](al04/charts/asset-implementation-weights.png)
![Factor spectrum](al04/charts/factor-covariance-eigen-spectrum.png)
![Sensitivity](al04/charts/sensitivity-diagnostics.png)

## Acceptance matrix

| Criterion | Status | Evidence |
|---|---|---|
| 1. Factor exposure != capital weight | PASS | Square/negative exposure tests; role/unit validators; no sum(e)=1 constraint |
| 2. Exact implementation | PASS | Square/unique/bound/overdetermined fixture oracles |
| 3. Underdetermined, no pseudoinverse | PASS | Rank-deficient/multiple feasible q with explicit specific/total/turnover secondary; constrained KKT faces |
| 4. Explicit approximate mode | PASS | Residual endpoint, unequal W and singular W oracles; exact never falls back |
| 5. Systematic/specific/total reconcile | PASS | Expanded known-answer identity + NumPy B transpose Phi B +D for all valid cases |
| 6. Signed factor exposure | PASS | Negative B/e and signed Euler contribution fixtures; entropy undefined for signed shares |
| 7. PIT/no lookahead | PASS | Future B/Phi/D/target snapshot mutations; future input availability rejection |
| 8. Scoring/factor semantics | PASS | FactorDefinition-like and percentile/capital units rejected; classification CSV |
| 9. Independent risk diagnostics | PASS | Independent NumPy covariance/eigensystem/risk identities and SciPy optimization oracle |
| 10. Reproducible sensitivity | PASS | 154 declared stress rows, 136 VALID/18 expected INFEASIBLE; same-manifest hashes |
| 11. RiskMandate untouched | PASS | Two mandates preserve factor q/result; explicit origin projection; no mandate parameter in engine |
| 12. Old D1/factor mapping | PASS | AL04_factor_mapping.md + mapping-evidence.json + classification CSV |
| 13. Strict typecheck | PASS | typecheck.txt exit0 (all new .ts plus transitive imports, --strict --noEmit) |
| 14. git diff --check | PASS | diff-check.txt exit0 + new-source/report whitespace scan |
| 15. Baselines intact | PASS | preservation.json: 3063 files unchanged, including prior ZIPs |

Certification ends at AL04. Economic replay remains explicitly blocked; no AL05 is opened.
