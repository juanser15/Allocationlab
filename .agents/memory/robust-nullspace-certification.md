---
name: Robust optimization at zero forecast uncertainty
description: Why parametric quadratic search for an exact square-root penalty needs a separate constrained nullspace certificate.
---

For a convex square-root forecast-uncertainty penalty, the parametric-QP multiplier equation does not necessarily have a finite root when the optimum has zero forecast variance. At that boundary, certify the norm subgradient **jointly with active constraint normals** (including signed-overlay auxiliary constraints); requiring the unconstrained gradient to lie in the uncertainty matrix's range rejects valid portfolios. Distinguish mathematical zero from tiny positive daily uncertainty using scale-relative thresholds, not a fixed absolute variance floor.

**Why:** Real historical portfolio decisions and signed overlays failed numerical certification despite valid frozen inputs. A multidimensional symmetric eigensolver error and an overly large fixed zero-risk floor compounded the issue; small synthetic two-asset tests did not reveal it.

**How to apply:** Any future change to robust optimization should test correlated uncertainty dimensions beyond two, bound-active nullspace optima, signed auxiliaries, and replayed point-in-time decisions. Verify eigendecomposition reconstruction/PSD and never silently substitute a quadratic penalty or an uncertified nullspace point.