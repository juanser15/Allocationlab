# AL-06 — Existing Node-3 Signal Gate mapping

**LEGACY_NODE3_SOURCE_NOT_PRESENT_IN_CURRENT_REPOSITORY.** None of the four requested function definitions exists in the inspected local baseline. Their exact formulas, windows, thresholds, missing-data behavior and state transition logic cannot be audited. No prior summaries were substituted and no legacy threshold was guessed. Existing Node 3 was not modified.

Repository: `/workspace/Allocationlab`, `juanser15/Allocationlab`, branch `work`, commit `1163a0b574b573004372a3a2fc8752810dea7ef9`. Checkpoint covers 3,196 pre-existing files. Bounded searches covered API source, research, configs, docs, attached assets and replit.md, plus **1,087 baseline text/source files** (.ts/.tsx/.js/.mjs/.py/.md/.txt/.ipynb/.R/.yaml/.yml). An exact-symbol scan found zero occurrences of all four function names. Full path inventory and machine-readable null fields are preserved in `reports/al06/node3-audit-evidence.json`. No other repository, remote service or indefinite search was used. The user confirmed that the reference comes from an older Seven-Node Portfolio Framework snapshot/ZIP, not a confirmed source in the current Allocationlab. The final exact-name and node3/quality_gate/gate-filename search found only newly added AL-06 gate code/evidence, with no legacy implementation. No further path request or search outside the repository was made.

| Existing function | Classification | Exact formula | Window | Thresholds | Missing data / states |
|---|---|---|---|---|---|
| `compute_pca_concentration()` | UNVERIFIED | Not available | Not available | Not available | Not available |
| `compute_cross_sectional_dispersion()` | UNVERIFIED | Not available | Not available | Not available | Not available |
| `compute_rank_stability()` | UNVERIFIED | Not available | Not available | Not available | Not available |
| `evaluate_gate()` | UNVERIFIED | Not available | Not available | Not available | Not available |

## Related local objects are not the missing gate

| Local evidence | Classification for Node-3 reuse | Reason |
|---|---|---|
| `calculator.ts:619` liquidity proxy: collect each asset's short-period return standard deviation, average and transform into liquidity score | SEMANTIC_CONFLICT | Return/liquidity heuristic, not dispersion of current cross-sectional signal scores; no PCA/rank stability/quality-gate state machine. Not modified or substituted. |
| `prepared-inputs.ts` signalSeries and lineage | ADAPTER_NEEDED | Scores, transformations, peer universe and prior-close availability can help build dated canonical signal artifacts. They do not supply the missing Node-3 implementation or complete gate history. |
| Frozen AL-03 covariance/risk breadth and AL-04/05 risk artifacts | REUSABLE for portfolio observation, not Node-3 certification | Asset/strategy return covariance PCA is not a signal-feature PCA sample; allocation risk bets are not signal-quality concentration. |
| Current scores/factor definitions or a latest snapshot | SEMANTIC_CONFLICT if backdated | Cannot replace historical ranking snapshots, publication times or original gate state. |

## New canonical methodology; legacy compatibility is not certified

`gates/signal.ts` supplies an **new, explicit and versioned canonical signal-structure methodology**, `CANONICAL_SIGNAL_STRUCTURE_1.0.0`, to exercise the contracts, clocks and PIT machinery. Its mathematical definitions are written in `AL06_signal_quality_gate.md` and independently checked, but they are **not a recreation of Node 3**. The policy explicitly records `legacy_node3_certification=LEGACY_NODE3_SOURCE_NOT_PRESENT_IN_CURRENT_REPOSITORY`; outputs retain this distinction. In particular, the reference's ddof, assets-by-feature sample construction, Spearman aggregation and QA thresholds must not be relabelled as legacy behavior.

Legacy historical comparison is **BLOCKED_MISSING_LEGACY_NODE3_SOURCE**: the original source/state logic and dated signal/ranking/gate-state artifacts are not available locally. No legacy diagnostic/state curve was fabricated. Recovering the four functions and their configured callers/version, followed by complete historical information-set/ranking/state snapshots, is necessary before closing acceptance criterion 2. That criterion remains **BLOCKED_SOURCE_NOT_AVAILABLE**. Per the user's explicit clarification, it does not cause a false mechanical FAIL for the remaining certifiable AL-06 implementation. This document does not authorize a different repository, download, production connection or Node-3 replacement.

The canonical formulas and QA thresholds below are new AL-06 definitions, not reconstructed legacy behavior. The mapping remains pending recovery of the original ZIP/source. Overall mechanical certification is scoped to the new canonical gate and frozen portfolio observations.
