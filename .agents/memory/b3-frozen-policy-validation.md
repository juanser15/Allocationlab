---
name: B3 frozen policy validation
description: The separate identities and time boundaries required for historical B2-policy evaluation
---

Historical validation of an as-of B2 allocation freezes the policy definition and a separately selected immutable evaluation preparation. The B2 allocation's current weights, exposure mapping, and estimates are not historical inputs; recompute them at each scheduled decision using only information available then. Do not assume canonical candidate IDs are portable across datasets: preserve the policy IDs while resolving a unique compatible candidate definition in the evaluation dataset.

**Why:** A candidate's identity includes its source dataset. Equating that identity with a dataset ID, substituting current working data, or reusing the terminal B2 exposure silently changes the policy or leaks future information.

**How to apply:** A saved validation or replay must retain both frozen identities, verify their content, and record the point-in-time mapping and solver inputs per decision. Keep its ledger separate from the legacy constructor and never treat target exposures as already-executed holdings.