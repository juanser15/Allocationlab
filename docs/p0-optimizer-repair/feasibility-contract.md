# Authoritative feasibility and failure contract

`portfolio-feasibility.ts` is imported by the UI and API. Institutional request parsing invokes it before loading data; the `/runs` route parses before opening the durable service. Normalization repeats the full data-aware plan before any run is created.

## Necessary checks

- Candidate universe is nonempty, unique and uses valid symbols. Selected assets must exist in the pinned dataset and have the required causal price history. Existing quality gates and exclusions are preserved.
- If enabled, a mandate contains exactly three fields: integer `1 <= minimum_positions <= maximum_positions <= selected_candidates` and finite `0 <= minimum_weight <= maximum_etf_weight`.
- Existing exposure, volatility-budget, per-position maximum and capital-policy ranges apply. These inputs are never clamped or automatically repaired.
- For positive exposure, `minimum_positions * effective_minimum_weight <= exposure_ceiling`. The numerical positive-support floor is explicit in `portfolio-numerics.ts` when the economic floor is zero.
- Maximum holding capacity is compared to a fully invested budget only for an explicit exact-budget contract. Ordinary requests retain their existing ceiling semantics and cash residual; the internal exact-budget feasibility test does not add an ordinary API field.
- A known positive full-stress capital ceiling that cannot fund the minimum mandate fails preflight. Explicit zero exposure is valid cash in either monitoring mode.
- Training dates, model-specific causal feature warmup, missing core/candidate observations, evaluation end and earliest supported start are checked without moving dates or expanding training. Unavailable warmup cannot be clamped to the dataset's last row.

Passing preflight certifies necessary conditions, not the future covariance matrix or every possible frozen-composition overlay. Plans state this limitation explicitly. Every invested solve and overlay is audited again with the actual information available at that date.

## Error categories

| Category | Meaning | Next action |
| --- | --- | --- |
| `PORTFOLIO_CONSTRAINT` | Malformed or analytically contradictory mandate/capital controls | Correct the identified fields before submission. |
| `DATA_COVERAGE` | Requested training, features or OOS dates cannot be supplied by the selected immutable data | Review exact required/available dates or symbols; no automatic change. |
| `SOLVER_INFEASIBLE` | Evidenced support/risk infeasibility or a positive overlay incompatible with frozen composition | Inspect the actual decision's risk/exposure/support evidence. |
| `NUMERICAL_FAILURE` | Convergence/certificate failure, bounded search without a proof, invalid risk matrix, or escaped audit breach | Inspect numerical evidence; this is not proof of structural infeasibility. |

Specific codes/reasons remain separate from categories. API preflight uses its existing safe `error.issues` field for actionable evidence. Failed attempts include `error_category`, safe message, next action, decision/fold evidence and a private diagnostic reference. Solver-owned stage identifiers take precedence over stale progress labels. Unknown exceptions do not expose messages, stack paths or forged public-error properties.

The UI shows the actionable message first and keeps the category/code collapsed under technical details. All existing immutable attempt persistence semantics remain intact.
