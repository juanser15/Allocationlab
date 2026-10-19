# BANK-01 methodology

Version: `active-set-bank-1.0.0`. Scope: isolated research/core eligibility and activation. StrategyStream/AlphaStream is an implementation name for a strategy-instance return stream, never a claim of statistical alpha.

## Promotion, activation and allocation

Promotion is immutable upstream governance approval. BANK-01 consumes it; it does not create approval decisions or change lifecycle states. Activation is today's policy-dependent permission to enter the allocator. Allocation is a later AL-05 capital decision. An active strategy may receive zero capital; BANK-01 does not produce capital allocations at all.

`Entry` supports SIGNAL and STRATEGY_INSTANCE separately. Signals carry a model/version, units and frozen artifact hash and produce `active_signal_ids`. Their scores never enter strategy-return covariance or clustering. Strategy instances carry instance/family/version/parameterization identity, underlyings and market/region/sector tags. Same family or underlying does not identify duplicates. A duplicate economic identity consists of type, family, sorted underlyings, version and parameterization hash (plus signal model identity for signals); it is rejected unless distinct execution sleeves are explicitly declared for every duplicate.

## Temporal contracts

Every entry, state and optional artifact has as-of, information-cutoff and availability times. The decision cutoff must not exceed the decision date. An artifact is usable only when its as-of is no later than the decision and both its cutoff and publication time are no later than the decision cutoff. State effective time must also be no later than the decision. Conflicting latest snapshots, invalid visible values and hash tampering are rejected. Future records are filtered before inclusion in the decision's economic hash.

Historical entry/version definitions are immutable: use distinct version-qualified entry IDs, retain old entries and their validity intervals, and never substitute a current definition. Validity is `[valid_from, valid_until)`. Return observations require observation date and publication time at or before the cutoff, publication no earlier than observation, unique dates and explicit membership in the supplied session calendar. Future registry states, forecasts, correlations, regimes or full-file hashes cannot change an earlier information set.

For real research scope a complete PIPE-02 governance registry is required. The read-only adapter calls certified `bankState`, which verifies the visible governance chain and separate authorized promotion evidence/decision. Provided ad-hoc real state rows cannot override that registry. Metadata must match the certified definition's type, version, configuration hash, family, underlyings and validity interval. No production adapter or write is introduced. QA-only externally supplied promotion assertions are accepted solely under `scope=QA_ONLY`; they are not real promotions or user authorizations.

An upstream manual hold, SUSPENDED or RETIRED status prohibits activation. Computed BANK inactivity is an output artifact, not an upstream manual hold: it may disappear when the policy becomes satisfied. Existing PIPE-02 activation records are not rewritten or automatically consumed by its router. Operational consumers must explicitly adopt a certified ActiveSetArtifact in a future integration.

Frozen research scores/PSR/turnover must cite the current promotion-evidence hash and be available no later than the promotion decision. The real adapter copies PSR/turnover from the verified packet and leaves an unavailable research-score definition null; it does not reinterpret CAGR as that score. Missing required selector evidence gives INSUFFICIENT_DATA, never an implicit lexicographic fallback.

## Eligibility and regime

Eligibility requires externally PROMOTED state, valid version/interval, no governance prohibition, sufficient available strategy history, fresh data and PASS from a PIT signal gate where entry metadata or policy requires it. Missing/stale gates, data and regime artifacts remain explicit. No imputation or fallback exists.

Allowed/prohibited regimes come only from a frozen external regime artifact. Prohibited or excluded allowed regimes cause INACTIVE_REGIME; a required missing regime gives INSUFFICIENT_DATA. Preferred regimes are diagnostic, not an undeclared selection score. Without a restriction no regime rule is invented. The bank does not estimate regimes or evaluate new signals.

## Correlation

Method `SAMPLE_PEARSON_COMMON_SESSIONS_V1` consumes NET return or NET P&L per unit beginning stream capital; mixed conventions and signal scores are rejected. It preserves each strategy instance separately, including negatively correlated strategies on the same underlying.

For W = 63, 126 or 252, take the last W supplied benchmark/session-calendar dates at or before the cutoff. A startup window shorter than W is permitted only when it meets explicitly configured minimum observations and minimum strategy history. All strategies entering a covariance matrix must have every observation on exactly that common window. Interior gaps cause exclusion; they are not repaired with pairwise estimates. Sample covariance divides by n−1, and Pearson correlation divides by the product of sample standard deviations. Zero variance makes correlation undefined; no denominator epsilon is used. Numerical rounding outside ±1 is clamped only within the declared numerical tolerance; a larger breach raises NUMERICAL_FAILURE.

The declared reference policy uses W=63, minimum observations/history=63, maximum return age=4 calendar days, required correlation for activation, and no redundancy caps. The engine itself supplies no hidden policy defaults. An explicit optional-correlation policy can retain eligible strategies without a correlation estimate, while reporting diagnostic coverage; correlation-dependent restrictions then cannot be enabled.

## Deterministic hierarchical clustering

Distance is `sqrt((1-rho)/2)`, using signed rho rather than absolute rho. Linkage must explicitly be SINGLE (minimum cross-cluster distance), COMPLETE (maximum) or AVERAGE (mean). Merge the closest pair while distance is at most `sqrt((1-threshold)/2)`. Exact distance ties resolve by lexicographic sorted member-ID lists. Initial and merged groups are sorted, making memberships/merge history invariant to input ordering.

Cluster IDs hash sorted membership. A cluster artifact additionally binds the entire PIT correlation model and policy. Persist size, membership, within-cluster mean correlation and all between-cluster mean correlations. Singleton within-correlation is undefined/null. A COMPLETE/AVERAGE cluster threshold is a linkage rule, not a claim that every cross-cluster pair lies below the threshold; SINGLE can chain clusters.

## Explicit active-set policy

Reference behavior retains all basically eligible strategies, even with very high correlation. Optional total/family/underlying/cluster cardinality caps, pairwise-rho limits and minimum marginal covariance-rank gain apply only when explicitly declared. No short-term correlation retires or deletes a strategy. Negative correlation is not automatically redundancy.

A deterministic greedy eligibility pass orders candidates using exactly the declared representative selector: frozen research score descending, frozen PSR descending, frozen turnover ascending, mean correlation to the already active set ascending, or lexicographic strategy ID. The last selector also breaks all other ties. With no current active strategies, the correlation selector begins lexicographically; an average is then defined over actual selected strategies. Restriction precedence is total, family, underlying, cluster, pairwise rho, marginal rank. This is a documented policy rule, not covariance optimization or a claim of global optimality. All constraints are counts/eligibility diagnostics; capital weights remain absent.

Each output distinguishes basic `eligible` from final activation `status`. An otherwise eligible strategy can be INACTIVE_CLUSTER_LIMIT/REDUNDANCY/POLICY_LIMIT without losing approval. Missing frozen selector evidence is data insufficiency, not a weak performance classification.

## Marginal and diversification diagnostics

Covariance effective rank is entropy effective rank `exp(-sum(p log p))` of nonnegative covariance eigenvalue shares. PCA risk bets use the certified AL-03 Jacobi eigendecomposition and its methodology: component variance is `eigenvalue*(eigenvector' probe)^2`, followed by entropy effective count. These are PCA metrics, not minimum-torsion ENB. Repeated eigenvalues make individual PCA risk-bet attribution basis-dependent; report that caveat explicitly.

The probe is always `EQUAL_UNIT_REFERENCE_NOT_ALLOCATION`. Its component values 1/N define a reproducible diagnostic reference, not an allocator output or proposed capital decision. Before/after adding each candidate persist covariance rank, PCA bets, mean pair correlation and predicted reference variance. No optimizer, objective or investment weights are produced. If a rank-gain limit is explicit, it operates on this reference-independent covariance-rank diagnostic.

Report nominal strategy count and the equal-unit effective count separately from covariance rank and PCA bets. Actual strategy allocation HHI/effective count remain null because no capital allocation exists yet. Nominal underlyings and strategies per underlying/family are separate. Optional unit maps give a labelled equal-unit implementation probe; its concentration is HHI of normalized absolute aggregate exposures, not signed capital diversification. Algebraic cancellation and internal residual capital remain explicit. Internal residual is never global cash; BANK-01 has no global cash or financing contract. Asset-risk PCA bets are available only with a matching supplied PIT asset covariance. Optional benchmark/factor/region/sector similarity does not affect selection.

## AL-05 handoff and persistence

The adapter returns only active strategy IDs and a content-bound handoff reference. A consumer must reconstruct a canonical AL-05 PIT bundle on exactly that axis. Certified AL-05 input validation rejects stale/inactive covariance or forecast axes, invalid maps and incomplete constraints; the bank never slices risk matrices, renormalizes prior holdings or drops constraints silently. No allocation function is imported/called by the runtime.

ActiveSetArtifacts are recursively immutable with canonical SHA-256 identity. Decisions are evaluated only at explicitly supplied decision dates; there is no implicit daily scheduler. Each record binds decision/cutoff, policy and bank snapshots, selected/inactive IDs and reasons, correlation/clusters, regime and diagnostic input hashes. Durable records atomically publish to an immutable journal. Identical retries reuse the old record; changed code/inputs at the same business key cause an explicit conflict. Historical failures are preserved in certification logs. No history is overwritten to accommodate new data.

These are content hashes and verified supplied governance chains, not digital signatures or authentication of an external actor/data vendor. Data authenticity and source availability must be supplied by the eventual caller. Parameters were declared before QA; no windows, correlations or caps were chosen against subsequent financial performance. Future policy research must use AL-07 nested walk-forward.
