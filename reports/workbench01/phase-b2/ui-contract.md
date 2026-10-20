# Workbench Phase B2 UI contract

## Workflow

The `/workbench` route is one coherent page with Configure, Run / Status, Results, Compare and secondary Temporary Run History sections. It starts behind preview access, validates live capabilities, and enables `RUN RESEARCH` only when the single editable input is valid and no submission conflicts.

The strict request body is:

```json
{
  "research_mode": "CAPITAL_MARKET_EXPOSURE",
  "execution_scope": "EMPIRICAL",
  "universe": "SPY",
  "validation_protocol": "TRADITIONAL_WALK_FORWARD",
  "transaction_cost_bps": 0
}
```

The last value may be `5`; no other key or value is emitted.

## Display authority

Capabilities, run status, result metrics, time series, walk-forward folds, immutable attempts and comparisons come from the Phase B1 API. The frontend does not derive hashes, metrics, costs, identities, winners, selections, or financial conclusions.

The primary successful result includes only out-of-sample observations, final research index, realized simulated cost, selected assumption and status. The one primary chart plots the returned out-of-sample series without smoothing or an invented benchmark. Walk-forward evidence shows actual intervals, selected candidate, fit key and observation count.

## Mandatory limitations

Plain-language labels are always visible for research-only use, temporary storage and unverified independent data vintage. Their exact terms are available in expandable help:

- `RESEARCH_ONLY`
- `TEMPORARY_RESEARCH_STORAGE`
- `PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED`

No successful result implies promotion, activation, allocation, authorization, an order, or an investment recommendation.

## Attempts and comparison

`RERUN SAME CONFIGURATION` sends an empty object to the backend rerun route. The API keeps the `run_id` and creates a new immutable attempt. The UI lists attempts separately, including failures. A prior attempt's financial hash is shown as `NOT_SUPPORTED` when Phase B1 does not expose that attempt's result rather than being inferred.

Comparison requires exactly two successful runs, calls the read-only compare endpoint, renders the exact differences and actual returned series, and uses neutral A/B labels. It contains no winner field, ranking, recommendation, or client-side recalculation.
