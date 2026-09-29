# D6 — Signal Combination: Ridge Forecasts

## Authorization and boundary

Implement one bounded predictive signal-combination capability in the existing Allocation Lab. This is a new forecast estimator, not another portfolio solver.

D5 SIMPLE was accepted after the real UI replay of Validation Run #489 returned HTTP 200, PASS, zero differences and maximum numeric difference 0. The last read-only inspection found application revision `f283566`, a clean tree and no D6 implementation. Its persistent D5 report still had an old BLOCKED label; do not restart D5 because of that stale label. Historical IDs are evidence, NOT test fixtures.

Keep accepted asset/alpha optimization, D1 risk, D2 signed overlays, D3 existing forecasts, D4 robustness, D5 SIMPLE regularization, B3 execution and A1 accounting unchanged. Inspect current active work before editing; do not overwrite concurrent changes.

**Single deliverable:** selected mathematical signals produce an auditable asset-return forecast using pooled linear ridge regression; the existing asset optimizer consumes it and B3 evaluates the whole procedure through time.

Initial D6 scope is **signals → underlying-asset forecasts → existing capital asset allocation**. Existing tradable-alpha and signed-overlay paths remain available unchanged. Do not silently apply this new estimator to alpha streams or infer their future returns from asset forecasts. Return an explicit unsupported-combination response for that unimplemented extension.

Do not add Elastic Net, nonlinear models, new factors, formula interpreters, automatic feature selection, regime-specific fitting, interactions, hyperparameter searches, new risk models, new execution frequencies, OHLC, liquidity, financing models, reporting redesign or new top-level navigation.

## 1. Distinguish what is being learned

A predictive coefficient is not an ETF weight or alpha capital allocation. Coefficients may be signed and do not sum to one. Negative coefficients change the forecast; portfolio constraints still determine whether the asset can be shorted.

The PM explicitly chooses a frozen asset universe and a common set of supported factor definitions applied to those assets. Canonicalize exact definition aliases before fitting. Keep distinct correlated factors available; do not remove them based on standalone Sharpe, IC or realized portfolio performance.

Use actual B1 point-in-time signal observations. B1 asset-return preparations currently do not contain a consolidated signal panel; construct the aligned date × asset × selected-factor panel from the frozen signal definitions and compatible price history. Do not populate it with scores from the latest portfolio session.

Keep raw calculation, direction, declared cross-sectional transformation and the training-time regression scaler distinguishable. Apply direction exactly once. Preserve each factor's declared peer universe.

## 2. Prediction horizon and information timestamps

Use **one trading-period arithmetic excess return**, in daily decimal units, for the first close-to-close interval AFTER the declared execution close. No monthly-return division, log-return substitution or annualization inside the forecast.

For each historical hypothetical decision:
- `informationCutoff` determines the data available for its features.
- `executionDate` follows the existing A1 same_close or next_close convention.
- `labelStart` is that execution close.
- `labelEnd` is the next trading close.
- The label is the asset's arithmetic return from labelStart to labelEnd minus declared cash return over the SAME interval.

This deliberately predicts a post-execution interval, never the price jump before a fill. Record these timestamps on training rows and predictions. Preserve the existing B1 lag; do not shift features a second time accidentally.

At a model fit cutoff C, admit a historical training row only when its complete features were available at its historical cutoff AND its label end/availability is at or before C. Labels extending beyond C are not training observations, even if the dataset already contains them.

The forecast horizon remains one trading interval even if the portfolio rebalances monthly or quarterly. State this distinction; do not claim a forecast of the entire holding-period return. B3 continues to hold actual positions under its existing schedule.

For validation, no future price VALUES may be used to form a current prediction or choose data coverage. Unobserved outcomes remain pending, not zero. Next-open remains unsupported.

## 3. Exactly one supervised estimator

Add a separately versioned D3 estimator named `SIGNAL_RIDGE` for the supported asset path.

Use one pooled linear model with a shared intercept and shared slopes across the selected assets. It is an explicit model assumption, not a hidden choice of separate models per asset.

Let n denote the number of complete asset-date training rows. Let z be the standardized feature vector and y the one-period excess-return label. Minimize:

\[
\frac{1}{2n}\sum_{i,t}(y_{i,t}-\beta_0-z_{i,t}^{\top}\beta)^2
+\frac{\lambda_{\mathrm{signal}}}{2}\|\beta\|_2^2.
\]

The intercept is not penalized. Require finite, positive `lambda_signal`, explicitly selected and frozen; suggested UI starting value 1.0 is not a performance recommendation. It is distinct from portfolio gamma/eta, D3 Bayesian tau and D5 rebalance regularization.

Fit each feature's mean and population standard deviation on TRAINING rows only. Store them; reuse them for prediction. A training-constant column is recorded as such, gets zero slope and is centered to zero for this fit and its predictions; do not discover constancy using evaluation data. A materially invalid/nonfinite input is an error, not a reason to invent values.

Use a rolling window of fully observed historical decision dates, not a random split. Default window: 252 dates. Default minimum: at least max(60, 5 × (number of fitted slopes + 1)) complete distinct dates. These are explicit readiness settings, not a guarantee of statistical adequacy. Never lower them silently. The small analytical unit tests may exercise the mathematical fitter directly without pretending their fixtures satisfy production readiness.

Use a balanced panel on the declared universe: missing training inputs exclude the whole affected historical decision date from fitting and must be reported with a reason. Do not remove assets or factors silently. At prediction time, a missing required feature for a requested asset blocks that fit/prediction; no zero forecast or mean-return fallback. Held-price failures in B3 retain their existing stricter behavior.

No random shuffling, automatic lambda selection, parameter grids, feature search or tuning against validation performance.

## 4. Forecast uncertainty: one declared approximation

Do NOT reuse Sigma/T as if it were the uncertainty of a fitted ridge prediction. Do NOT set V_mu to zero merely to satisfy D4. Return volatility and forecast-estimation uncertainty remain distinct.

For this pooled model, use a **date-aggregated Bartlett HAC sandwich approximation** for coefficient sampling covariance, conditional on the fitted feature transformation and fixed penalty. Its purpose is to account for common same-date residual shocks and short-lag score dependence without treating N assets on the same date as N independent dates.

Specify the calculation completely:
- Z includes the intercept column. Let L be diagonal with zero for the intercept and one for fitted slopes.
- A = Z'Z/n + lambda_signal × L.
- For each chronological training date t, form g_t = sum over assets of z_augmented(i,t) × fitted_residual(i,t).
- Center these date score vectors by their training-date average, giving g_t_centered.
- Set S_l = sum over valid date pairs separated by l declared trading-calendar observations of g_t_centered × g_(t-l)_centered'. Do not compress missing dates into adjacent days.
- M = S_0 + sum for l=1..q of [1-l/(q+1)] × (S_l + S_l').
- C_theta = A^(-1) × (M/n^2) × A^(-1)'. Use stable solves rather than avoidable explicit inversions.
- For the current asset feature matrix Z_star, V_mu = Z_star × C_theta × Z_star'.

Use one explicit, frozen nonnegative integer bandwidth q; default 5, with sufficient training-date coverage. No automatic bandwidth search and no finite-sample multiplier hidden in the result. Report the selected q and distinct-date count. A zero-lag setting is the date-clustered special case, not an iid per-row calculation.

Validate finite values, candidate order, symmetry and PSD under existing numerical conventions. Preserve semidefinite matrices and their cross-asset forecast covariances; D4 already accepts PSD uncertainty. Do not inject an undeclared diagonal floor. Materially invalid uncertainty blocks robust use explicitly, not silently switches to nominal.

Label this **approximate sampling uncertainty of the penalized fitted forecast**. It excludes ridge shrinkage bias, omitted-model/regime uncertainty and future residual return noise; it is not a calibrated confidence guarantee or proof of alpha. Do not label forecast ± 1.96 SE a future-return prediction interval. This is a bounded, specified uncertainty method, not an invitation to build more estimators.

## 5. Forecast-provider integration

D6 produces predicted daily EXCESS returns from the fitted model. For the supported capital asset optimizer, D3 publishes gross mu by adding the declared daily cash yield exactly once. V_mu is unchanged by adding deterministic cash. Keep candidate IDs and matrix ordering exact.

D6 must expose intercept, standardized feature contributions and their sum; contributions must reconcile to the excess forecast, then to gross mu after adding cash. Do not additionally apply the old mean-shrinkage strength or blend the new forecast with an old score unless explicitly part of a future specification.

The risk estimator continues to provide the same independently computed asset covariance. Do not replace it with regression residual covariance. B2/D4 consume the resulting mu and V_mu, and D5 SIMPLE remains an independent optional rebalance penalty.

In B3, at EVERY scheduled decision, reconstruct eligible training rows, fit the scaler and ridge, calculate current forecasts/uncertainty, optimize and execute through A1. Refit coefficients as time advances, but keep the chosen feature set, lambda, bandwidth, readiness rules and lookback frozen.

Do not introduce a second backtester, portfolio solver or trading rule. No retroactive use of terminal coefficients or training scalers. Previously observed evaluation outcomes may enter later rolling training once genuinely available; identify this as sequential refitting, not training once on the full evaluation period.

## 6. Evaluation and interpretation

Maintain separate training fit and sequentially unseen prediction records. Assess a prediction only when its declared outcome has matured.

Show:
- Training row/date counts, fitted coefficients and their history.
- Each asset's forecast, feature contributions, forecast SE and actual matured label.
- Evaluation RMSE and MAE.
- Cross-sectional Pearson/rank IC by decision date only when at least three assets and nonconstant values are available; ties and insufficient cases remain explicit.
- B3 net returns, risk, drawdown, trading costs and exposure history, retaining existing formulas.

A signal's signed coefficient is a conditional model relationship, not causal P&L attribution or a portfolio recommendation by itself. Do not rank features as winners automatically.

Allow comparison of this forecast versus one existing SHRUNK_MEAN policy using identical validation data, dates, risk, constraints, initial holdings, D4/D5 settings and execution charges. Clearly identify the changed forecast specification. No automatic model promotion and no performance superiority required for acceptance.

These are fixed-policy sequential evaluation results. Data leakage tests do not make prior analyst model selection disappear. Do not claim multiple-testing corrections, nested hyperparameter selection or statistically proven profitability; none is implemented here.

## 7. UI and immutable results

Use existing Portfolio Lab, Factors and Forecast surfaces. Add one forecast option: **Signal Combination — Ridge**. Display a clear feature selector, training window, lambda_signal and advanced uncertainty bandwidth. Keep the existing Optimize and Validate actions.

Group outputs as **Definition → Coefficients & Forecasts → Validation** within existing surfaces, without adding a main navigation tab. Show formulas, sample sizes, forecast horizon and timestamps where used. Disabled/unsupported combinations must be explicit.

Use existing snapshots and Validation Runs, extending their versioned content with feature definitions/order, peer universe, actual training row/date identities, label timing, scaler values, lambda, coefficient vector, HAC inputs/assumptions, C_theta, mu, V_mu, cutoff and data/engine versions. At every B3 decision preserve the fitted forecast identity.

Current settings must never reinterpret old snapshots. Old paths remain replayable with their original semantics. Use identical live/as-of and B3 forecast calculations. A saved retrievable run is not regenerated silently on page reload.

## 8. Eight fixed acceptance gates

**T1 — Ridge mathematics.** On an independently calculated fixture with one standardized feature having equal observations at -1/+1, y=-0.02/+0.02, and lambda_signal=1, the fitted intercept is zero and slope is 0.01 under the declared average-loss objective. Verify multifeature collinear cases with an independent reference, unpenalized intercept and objective/normal-equation residuals. Numeric agreement within 1e-8; no grid search.

**T2 — Label timing and leakage.** Verify historical same_close and next_close training-label start/end dates. Immature labels cannot enter fitting. Mutating future prices, outcomes, feature values or working factor definitions cannot change earlier fitted scalers, coefficients, forecasts, uncertainty or trades. Exercise actual B1/B3 paths, not a disconnected feature helper.

**T3 — Preprocessing, identity and missing inputs.** Train-only standardization reproduces independently; constant features contribute zero without being misidentified using future data. Aliases do not add model columns. Distinct correlated signals remain selectable. Missing historical dates and missing current features follow the declared policies, with no invented forecasts or silent candidate-set change.

**T4 — Forecast uncertainty.** Independently calculate date scores, Bartlett covariance, penalized sandwich and full cross-asset V_mu on a deterministic small fixture with shared date shocks; match within 1e-8 and verify PSD. Replicating the same information across assets on the same dates must not create iid-per-row uncertainty reduction. Verify nonzero cross-asset forecast covariance and distinguish it from return risk. No Sigma/T substitution.

**T5 — End-to-end forecast separation.** Feature contributions plus intercept equal predicted excess returns, and adding cash once equals the exact mu received by B2/D4. Independently verify forecast-risk dimensions and D4 objective contribution. Toggling D5 does not refit or change mu/V_mu. Unsupported new-estimator/alpha-stream combinations fail explicitly while existing alpha/signed forecasts remain functional.

**T6 — Historical sequential refitting.** Across at least three decisions, compare the B3 forecast with isolated fits at the same historical cutoffs. Require nonzero risky exposure and actual executions in the declared feasible fixture, valid known labels, independent evaluation metrics and A1 reconciliation within 1e-8. Do not require higher returns or better IC to pass.

**T7 — Saved identity and old-run safety.** Save the fit, allocation and validation; change working data/features/lambda and use a fresh client. Retrieve and replay with identical metadata and max numerical difference <=1e-8. Test an existing pre-D6 run remains reproducible. No overwriting saved models or parameter selection after viewing results.

**T8 — Real browser journey.** Create fresh, dynamically identified fixtures with at least five assets and three executable selected signals, enough warmup and evaluation history. Through the UI select Ridge, explicit lambda, a supported risk estimator, positive D4 kappa with nonzero valid uncertainty, and D5 regularization with explicit holdings. Optimize; inspect coefficients/contribution/formula; Validate and save; change drafts; fresh-browser retrieve and press the actual Replay button. Require observed HTTP success, visible PASS, unchanged frozen identities, zero unexpected differing fields and max numeric replay difference <=1e-8. Synthetic fixtures are test-only, not market evidence. Retain fixtures through the browser test.

## 9. Bounded verification and stopping

Use the proven database-test runner and dynamically created fixture IDs; never rely on historical database IDs or the user's latest uploaded dataset.

One implementation pass, at most one targeted in-scope repair pass, then one final verification on a frozen revision. Run the eight gates, persistence and directly affected A1/A2/A2.1/B1/B2/B3/D3/D4/D5 SIMPLE and D1/D2 compatibility regressions once, plus typecheck. Run C1–C3 when shared forecast/snapshot contracts they consume change. Finish safe independent suites after another failure; report executed, failed, cancelled and skipped cases separately. Required skipped tests are not PASS. No retries until green or expanding the scope to repair unrelated legacy fixtures.

Save and return **D6 COMPLETION REPORT**: revision, actual estimator/target/uncertainty assumptions, supported mode, analytical example, T1–T8 expected/observed status, executed regression evidence, browser-created IDs, maximum ledger/replay differences and exact blocker if any. No claims of superior performance or institutional certification.

All gates pass: **D6 CLOSED**, STOP.
Any required gate unresolved: **D6 BLOCKED**, state the specific cause and STOP.
Do not start OHLC, costs, nonlinear forecasting or another research stage.

## Method references and boundaries

- Ridge regression and explicit penalty conventions: official scikit-learn Ridge documentation, https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.Ridge.html
- Train-only transformations and avoiding leakage: https://scikit-learn.org/stable/common_pitfalls.html
- Newey and West, *A Simple, Positive Semi-Definite, Heteroskedasticity and Autocorrelation Consistent Covariance Matrix*, NBER Technical Working Paper 55 / Econometrica: https://www.nber.org/papers/t0055

The pooled asset model, post-execution label, ridge-sandwich approximation, defaults and integration scope above are explicit product specifications. The references do not establish that this combination will produce trading alpha or guarantee finite-sample coverage.
