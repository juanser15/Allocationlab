# Authoritative feasibility and failure contract

`portfolio-feasibility.ts` is imported by the UI and API. Institutional request parsing invokes it before loading data; the `/runs` route parses before opening the durable service. Normalization repeats the full data-aware plan before any run is created.

## Necessary checks

- Candidate universe is nonempty, unique and uses valid symbols. Selected assets must exist in the pinned dataset and have the required causal price history. Existing quality gates and exclusions are preserved.
- If enabled, a mandate contains exactly three fields: integer `1 <= minimum_positions <= maximum_positions <= selected_candidates` and finite `0 <= minimum_weight <= maximum_etf_weight`.
- Existing exposure, volatility-budget, per-position maximum and capital-policy ranges apply. These inputs are never clamped or automatically repaired.
- For positive strategic construction exposure, `minimum_positions * effective_minimum_weight <= baseline_exposure_ceiling`. The numerical positive-support floor is explicit in `portfolio-numerics.ts` when the economic floor is zero.
- Maximum holding capacity is compared to a fully invested budget only for an explicit exact-budget contract. Ordinary requests retain their existing ceiling semantics and cash residual; the internal exact-budget feasibility test does not add an ordinary API field.
- A smaller post-construction HMM exposure does not make the strategic mandate infeasible. Its effective weights may fall below construction floors. Explicit zero exposure is valid cash in either monitoring mode.
- Training dates, model-specific causal feature warmup, missing core/candidate observations, evaluation end and earliest supported start are checked without moving dates or expanding training. Unavailable warmup cannot be clamped to the dataset's last row.

Passing preflight certifies necessary conditions, not future covariance or solver convergence. Strategic construction is audited at scheduled allocation dates. A separate effective-policy safety audit excludes construction floors/cardinality/per-asset caps and does not force drift rebalancing.

## Error categories

| Category | Meaning | Next action |
| --- | --- | --- |
| `PORTFOLIO_CONSTRAINT` | Malformed or analytically contradictory mandate/capital controls | Correct the identified fields before submission. |
| `DATA_COVERAGE` | Requested training, features or OOS dates cannot be supplied by the selected immutable data | Review exact required/available dates or symbols; no automatic change. |
| `SOLVER_INFEASIBLE` | Evidenced support/risk infeasibility during a genuine scheduled construction solve | Inspect the actual decision's risk/exposure/support evidence. |
| `NUMERICAL_FAILURE` | Convergence/certificate failure, bounded search without a proof, invalid risk matrix, or escaped audit breach | Inspect numerical evidence; this is not proof of structural infeasibility. |

Specific codes/reasons remain separate from categories. API preflight uses its existing safe `error.issues` field for actionable evidence. Failed attempts include `error_category`, safe message, next action, decision/fold evidence and a private diagnostic reference. Solver-owned stage identifiers take precedence over stale progress labels. Unknown exceptions do not expose messages, stack paths or forged public-error properties.

The UI shows the actionable message first and keeps the category/code collapsed under technical details. All existing immutable attempt persistence semantics remain intact.
