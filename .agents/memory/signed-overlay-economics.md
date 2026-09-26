---
name: Signed overlay economic boundary
description: Economic invariants that distinguish signed alpha overlays from legacy capital allocations.
---

Signed overlay coefficients express active alpha exposure relative to cash, not fractions of invested capital. Keep historical long-only runs on their original capital budget and gross-return methodology. In signed mode, estimate risk and expected return on aligned alpha excess returns, aggregate signed alpha targets into underlying asset exposures, and set portfolio cash to one minus net asset exposure. Execute and account for the consolidated underlying book, not separate alpha sleeves.

**Why:** Treating a negative coefficient as negative cash capital, or separately carrying an alpha's residual cash sleeve, double-counts cash and misstates the economics of shorts and leverage. Charging trades before netting overlapping alpha targets also overstates external costs.

**How to apply:** Any future optimizer, B3 replay, reporting, or risk-model change involving signed alphas must maintain the excess-return and self-financing identities while preserving frozen legacy capital-long-only snapshots.