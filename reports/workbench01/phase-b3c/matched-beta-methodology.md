# Retrospective matched-beta diagnostic

The target is the certified AL-02 full-sample beta of the actual net dynamic returns against raw adjusted-close SPY returns on the exact OOS sample. The control's net return is its beginning SPY exposure times SPY return plus beginning cash times cash yield, less actual simulated notional cost divided by beginning NAV. Initial cash/next-close entry observations are included.

Find lambda in [0,1] such that control beta equals dynamic beta within absolute tolerance `1e-9`. This is an explicitly retrospective diagnostic built after observing the complete OOS sample, not an ex-ante investable strategy. Lambda is never supplied to the dynamic engine or used in policy selection.

For a cost rate k below one, the declared constant-weight accounting makes beta `N(lambda) / (1 - k² * lambda²)`, where N is a cubic. Entry lag, cost-adjusted entry, maintenance and terminal non-maintenance are all represented in its coefficients. Each coefficient's covariance/variance is evaluated by the certified AL-02 beta implementation.

The deterministic solver isolates every real derivative root on [0,1] recursively, using critical points and 80 bisection iterations per sign-changing interval. The quartic derivative identifies all attainable beta extrema, including endpoints. A cubic equation identifies every matching lambda. Choose the smallest feasible matching root deterministically; if beta is constant and already matches, choose zero. The realized control track is then independently evaluated with AL-02 beta and must meet tolerance.

If matching is infeasible, return `MATCHED_BETA_CONTROL_INFEASIBLE`, the dynamic beta, global minimum/maximum attainable control betas, closest attainable lambda and remaining difference. The nearest track is labelled a closest retrospective diagnostic; timing attribution is NOT_SUPPORTED. The target is never silently clamped. Undefined market beta returns an explicit undefined diagnostic. The bounded daily-maintenance family is not certified for cost rates of 100% or higher and returns `MATCHED_BETA_MAINTENANCE_COST_UNSUPPORTED`; the original dynamic result remains available and the V2 input is never rounded or replaced.

Synthetic unit known answers are explicitly labelled tests. Empirical acceptance uses only the committed historical snapshot, real selected jobs and actual authenticated API execution. Property tests independently evaluate a grid of lambda values against certified extrema, reconcile every NAV/cost identity and verify determinism and infeasibility.
