# Additive V2 exposure attribution

Ordinary V2 capabilities add `model_definition` and `benchmark_methodology_version`. Successful run-detail results add `model_definition`, `selected_policy_by_fold`, `benchmark_tracks`, `benchmark_metrics`, `matched_beta_diagnostic`, `attribution`, `accounting_convention`, `benchmark_reproducibility`, code identity and artifact reference. Existing financial fields, engine artifacts, run identity, attempt status and original reproducibility remain unchanged. V1 certification routes are untouched.

Each track contains a label, availability status, exact fold boundaries, aligned point observations and deterministic hash. Metrics come from existing certified implementations. Unsupported outputs and failed diagnostics remain explicit. A post-processing failure preserves the successful dynamic result and returns blocked benchmark fields with a safe code; it never substitutes another attempt's result. A latest failed attempt remains distinct from an earlier successful attempt.

Comparisons are differences of separately compounded total returns and CAGRs, not the return of a new tradable portfolio:

- Total dynamic effect = dynamic minus passive SPY.
- Exposure-level effect = matched-beta diagnostic minus passive SPY.
- Timing residual = dynamic minus matched-beta diagnostic.

Total effect equals exposure-level effect plus timing residual within numerical tolerance, in both reported units. Dynamic versus passive combines exposure reduction and timing; matching beta provides a comparable-exposure diagnostic. A positive residual is not automatically statistical alpha. No winner or recommended configuration is generated.

The original `financial_result_hash` is retained. Passive, matched-beta and attribution hashes bind the methodology version, SHA identity of the three post-processing source modules, original financial hash, data-snapshot SHA and financial payloads. Runtime timestamps, memory counters and execution-attempt IDs are excluded. Changing post-processing code does not change the experiment identity, but creates a separately versioned immutable attribution artifact.

Sidecars live only under the existing external temporary store:
`runs/<run_id>/attempts/<attempt_id>/attribution/<methodology_version>/<code_sha>.json`.
The original `result.json`, sealed engine tree and manifests are never rewritten. Reads verify bounded regular files, ancestor symlinks, containment, manifest SHA and job/result hashes. Sidecars use exclusive writes and hard-link publication; concurrent readers must produce identical bytes. Corrupt existing evidence fails closed rather than being replaced.

All responses preserve RESEARCH_ONLY, TEMPORARY_RESEARCH_STORAGE and PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED. There is no promotion, activation, allocation or capital authorization.
