---
name: Dynamic factor-set contract
description: Non-negotiable optimizer behavior for configurable factors and reproducible runs.
---

The optimizer and every validation path must consume only the explicitly persisted Active Factor Set. Disabled, candidate, and removed factors cannot affect composites, regime weighting, or allocation inputs. Remaining active weights are normalized explicitly and both configured and effective weights are evidence.

**Why:** Portfolio managers must be able to change the model without code changes, while every historical result remains reproducible and auditable.

**How to apply:** Snapshot the full factor-set version and parameters into every run/validation result. Never synthesize missing inputs; keep the factor definition visible and report exactly “Factor unavailable: required input data is missing.”