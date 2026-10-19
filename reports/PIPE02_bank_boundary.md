# PIPE-02 — Signal and Strategy Bank boundary

This is a **temporal research/governance registry**, not a strategy-selection system. Its records describe approval and externally supplied eligibility. They assign no capital, calculate no signals, prune no correlations and create no executable orders. PIPE-02 ends at an immutable certified target choice, HOLD, NO_NEW_TARGET or BLOCKED.

## Three independent concepts

| Concept | Question | Output |
|---|---|---|
| Promotion | Is this frozen research configuration approved for target-generation use? | Versioned lifecycle and explicit authorized decision |
| Activation | Is this already-approved entry currently eligible? | Externally supplied ACTIVE / INACTIVE plus reason |
| Routing | Which already-approved target path may be selected under this declared policy? | Exact existing primary/previous/fallback target, or no target |

PROMOTED does not imply ACTIVE. ACTIVE does not imply allocated capital. A valid research configuration is not automatically promoted. None of these concepts means broker execution.

## Canonical bank entry

`BankDefinition` supports SIGNAL, STRATEGY_INSTANCE, FACTOR_MODEL and ALLOCATION_CONFIGURATION. It preserves immutable research identity/version, candidate/configuration hash, optional strategy family, underlying IDs, market/region tags, frozen evidence hash, validity window, provenance and references for strategy returns, correlations, clusters and marginal diversification. Unknown classifications are not guessed. Real ASSETS entries use the union of instruments in the frozen targets, with source-derived provenance; their unprovided regional tags remain empty.

The definition and `BankState` together supply the canonical BankEntry view. Promotion status, activation status/reason, last transition and explicit PromotionDecision are derived only from the visible immutable event prefix. `bank-registry.csv` is a labelled as-of snapshot; `bank-status-history.csv` and `promotion-ledger.jsonl` preserve history. Code never uses today's snapshot to reconstruct an earlier date.

Every event binds the definition hash, evidence hash, sequence, previous-event hash, effective time and availability time. Both times must be observable at the routing cutoff. Late-recorded suspension/retirement cannot affect an earlier route. RETIRED is terminal for that entry; a future research version needs a separate immutable identity and its own approval. Bank definitions are never overwritten. Duplicate/ambiguous definitions and broken event chains are rejected.

Activation is supplied by an external governance record with an authorized actor reference. Reasons include ACTIVE, REGIME_NOT_APPLICABLE, DATA_UNAVAILABLE, TEMPORARILY_SUSPENDED, REDUNDANCY_POLICY_FUTURE and MANUAL_HOLD. The presence of a future-facing reason does not implement the corresponding active-set algorithm. Suspension or resume preserves the prior research approval but requires a separate activation record before new primary use. Routing also checks the entry validity window. Holds/fallbacks do not bypass suspended, retired or inactive approval state.

## Actual records versus QA simulations

All APPROVE records in this block are **QA_ONLY** with an explicitly synthetic authority. They are not approval by the user and cannot promote a RESEARCH_GOVERNANCE entry. Policies, packets, authorities, bank definitions and target certificates carry scope, and the router validates scope before use. Actual research entries are PROMOTABLE / INACTIVE; there are **zero actual promotions**.

The test registry includes a separately labelled virtual 2027 lifecycle with suspension, resume, external activation and permanent retirement. Rejected and inactive scenarios remain in their separate synthetic snapshots; they do not rewrite that main history. Consumers must preserve the routing record's scope and governance references rather than extracting an unlabelled target from a QA result.

`authorized_by` is an explicit externally supplied actor/reference string, checked against the supplied versioned authority and permissions. This offline core does not authenticate people, issue digital signatures, implement RBAC infrastructure or connect to an identity provider. An authorized governance caller must supply genuine decisions before any real promotion; no such real approval was requested or created here.

## Future active-set module — deliberately absent

A future bank may contain many promoted, correlated strategies on the same underlying. A separate future module may examine PIT strategy-return covariance/correlation, effective rank, underlying/factor concentration, market/region diversification and regime applicability using only information available at t. It must retain strategy-instance identity and preserve correlations rather than aggregating by underlying before allocation.

PIPE-02 computes none of those quantities. It does not run clustering, use full-sample correlations for historical activation, remove correlated strategies, invent a quality score, optimize an active set or choose a better-performing fallback after the fact. The optional reference fields merely retain a place for future certified artifacts. Current BANK/activation tests operate on explicit state records, not inferred market states.

## Non-execution boundary

There is no broker, IBKR, TradeStation, FIX, OMS/EMS, connection, credential, order object, order-generation function or submission API. The inherited frozen target's research execution convention is preserved as data; it is not executed here. PIPE-01 accounting is not rerun. No UI, route/API, production decision store or downstream target consumer is integrated.

`NO_NEW_TARGET` is a null logical target, not a liquidation or an all-cash portfolio. `HOLD_PREVIOUS_CERTIFIED_TARGET` preserves the old target specification subject to explicit age/health/approval/mandate/recertification/hold-count limits; it is not a broker hold instruction or a claim that old positions are indefinitely safe. Signed financing, collateral, stream internal residual and global implementation cash are not combined by this registry/router.
