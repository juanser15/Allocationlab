# Audit separation

Audit is a dedicated Capital Exposure tab, never a prerequisite for Run. Every section is collapsed by default: Methodology; Walk-Forward Folds; Model Definition; Candidate Selection; Execution Evidence; PIT / Data Provenance; Hashes / Reproducibility; Diagnostics.

The fold map and table use exact backend-returned intervals and observation counts. Temporal geometry is display-only. Model weights, thresholds, universe and candidate bands come from backend-authoritative metadata. Selected-candidate evidence contains actual scores, constraints, turnover, targets and hashes. Attempt history remains append-only and individually identified.

Normal errors show a title, concise explanation and a concrete next action. Codes, folds, candidate evidence, operational bounds and diagnostic references stay behind Show technical details. Private worker stderr, stacks, absolute paths, secrets and environment values are never returned. No arbitrary-file diagnostic endpoint is introduced.

Audit distinguishes compact interactive evidence from exhaustive certification artifacts. Certification is a future disabled action, not a condition for inspecting results. Legacy records are not removed or reinterpreted. Limitations remain visible outside Audit as well: RESEARCH_ONLY, TEMPORARY_RESEARCH_STORAGE, PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED.
