# Structural Quality Control

## Scope and activation

The persistent `/workbench` portfolio engine supports an explicit
`quality_control: { enabled: boolean, policy_version: "STRUCTURAL_V1" }`.
Missing settings are rejected on new portfolio submissions rather than
silently selecting a policy. The independent SPY/cash capital study rejects
this portfolio setting and does not consume a ranking, allocation optimizer
or Quality Gate. Certified legacy and B2/B3 engines are not changed by this
adapter; their historical evidence must not be relabeled as this policy.

Policy and code hashes, mode, immutable dataset identity and the original
request are part of the new run identity. Historical results stay on their
original methodology; absent gate evidence is not a failed or passing gate.

## Causal execution

Evaluate once per actual portfolio rebalance, after forecast construction
and before optimization. Both modes use the exact configured rolling or
expanding training window. All observations must be within that window,
at or before its information cutoff, strictly before the decision date.
Execution remains the existing next-observed-close ledger.

Manual signal features and Ridge fitting use that same training window.
Ridge labels must have matured by its cutoff; pending labels cannot enter
the scaler or fit. Fixed-lookback regime features retain their separately
declared causal feature history, not an implicit learned-fit window.
This is a session-cutoff guarantee, not a claim that current adjusted Yahoo
snapshots reconstruct every historical vendor publication vintage.

## Fixed policy

- Require complete finite positive selected-asset prices in the training
  window and a unique nonempty universe.
- Require valid current scores or return estimates with explicit units.
- Block a constant multiasset cross-sectional signal ranking in ON mode.
  Direct-return estimation and single-asset allocation do not invent a
  ranking discrimination requirement.
- Record sample dispersion, history/coverage/freshness and mean Spearman
  against up to three prior rebalance rankings whose score dependencies
  (including Ridge fit feature history) are wholly inside the current
  training window. Record their source intervals and include their actual
  scores in the per-decision input hash. Missing eligible history stays null.
  Negative rank
  stability is a warning, not an automatic rejection.
- PCA is diagnostic only, using cross-sectional z-scores of current
  selected signal features, sample covariance and the existing eigen
  routine. Record PC1 and entropy effective rank. A constant feature has
  zero variance, not invented noise; unidentifiable metrics are null with
  reasons. No economic PCA threshold is tuned or enforced.
- Do not compute predictive IC or performance alpha using future labels.
  Performance alpha (Jensen/CAPM or specified multifactor regression) is
  distinct from the alpha streams consumed by other construction paths.

OFF records would-block reasons and available diagnostics without optional
filtering. It does not disable necessary forecast/math validation,
accounting reconciliation or investment mandate constraints.

## Failure and evidence

ON rejection returns `QUALITY_GATE_BLOCKED` with the failed decision,
cutoff, window, policy/input hash, diagnostic metrics and completed gate
decisions. It produces no alternative allocation, silent cash transfer,
rebalanced fallback or complete-period performance. Such a stopped attempt
is not a strategy track record; an investable rejection action would need
a separately approved and versioned policy.

Successful runs must have exactly one gate record per planned rebalance.
The UI exposes mode, policy hash, counts, each cutoff and window, metrics,
warnings and rejection reasons. Results remain bound to their saved
attempt, not the current editable draft.

## Reproducible checks

- `node scripts/test-institutional.mjs`: independent arithmetic oracles,
  missing/nonfinite inputs, ON/OFF semantics, PCA/rank known answers,
  window boundaries, expanding/quarterly cadence, and future-only
  perturbations of manual and Ridge decisions.
- `node scripts/test-coordinated.mjs`: existing coordinated, causal,
  protected-ledger and frontend regressions.
- `node scripts/verify-quality.mjs`: five deliberately bounded API
  submissions using the already saved Yahoo SPY/SGOV dataset, without
  changing the active dataset. The fixed-SPY/cash accounting check runs
  first. A deliberately canceled momentum/reversal score verifies
  blocking ON and observe-only OFF with genuine saved observations.
  These are functional checks, not proposed investment allocations.

No claim of performance improvement follows from these correctness checks.
