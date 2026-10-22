# Coordinated research v1

Capital Exposure produces a constraint. Portfolio Construction receives that
constraint, the eligible ETFs, shared training data, covariance and carried
holdings. ETF Selection is an eligibility subtab, not an independent backtest.
The result is one continuous long-only ETF/cash ledger. The original SPY/cash
model, candidate selection, independent-fold methodology and UI remain available
through **Baseline reference**, with their original contract and identities.

## Section ownership and independent capital research

Data & Universe, Signals, Capital Exposure and Portfolio Construction own their
configuration controls. Full-portfolio execution, calendar, progress, results,
history and audit belong to **Backtesting**. They are not repeated in the
configuration sections. ETF Selection remains inside Portfolio Construction.

Capital Exposure has an explicit, optional **Independent study · SPY/cash** view.
It snapshots the chosen capital policy and has its own calendar, execution state,
results and history. `research_scope: CAPITAL_EXPOSURE` requests exclude all ETF
selection and optimizer fields. Portfolio requests use `research_scope: PORTFOLIO`
(the default for older stored requests). Scope is part of immutable run identity.

An independent study does not call the portfolio optimizer. In exposure mode it
invests the regime-adjusted allowed exposure directly in SPY and holds the rest
in cash. In risk mode SPY weight is `min(1, adjusted_budget / estimated_SPY_vol)`.
The scalar volatility estimate uses the selected training window. Passive SPY
starts in cash, buys once at the same first next-close fill, incurs the same
transaction cost rate and then holds. Both books use zero cash yield and the same
observation dates. They have separate self-financing ledgers and cost totals.
Study results are never presented as full-portfolio backtests or mixed into their
history. A background completion updates only its own execution workspace.

## Explicit scope

- Exposure mode: sum of all selected ETF weights is at most the exposure ceiling.
- Risk mode: `sqrt(w' Sigma w)` is at most the annualized volatility budget;
  ETF weights also sum to at most one. No leverage or short positions.
- Both modes allow cash and impose an individual ETF weight maximum. These are
  decision-target constraints. Subsequent price movement can cause drift.
- Fixed regime response keeps the ceiling unchanged. Adaptive response multiplies
  it by `1 - (1 - defensive_multiplier) * defensive_score`.
- Cash earns zero. The reference baseline retains its own cash assumptions.
- No daily risk-triggered trading, stress campaign, promotion, or automatic ETF
  screening is claimed by this implementation. Historical data vintage remains
  unverified even though decision cutoffs are enforced.

## Classifiers

The current composite regime calculation is reused without editing its source.
Its defensive score is `1 - composite/100`; this new mapping is separate from the
original candidate-selected exposure policy. Trend uses SPY below its 200-price
simple moving average. Trend + volatility averages that indicator and the
indicator that 21-return volatility exceeds 252-return volatility.

HMM is an in-repository two-state univariate Gaussian implementation, not a call
to hmmlearn. Inputs are daily SPY log returns inside each training window.
Baum–Welch EM uses scaled forward/backward probabilities; three deterministic
initializations start with transition persistence 0.85, 0.95 and 0.98. Fits require
likelihood convergence within 300 iterations, tolerance `1e-6*(1+abs(previous))`;
a material likelihood decrease or undefined EM arithmetic rejects that
initialization. There is no fixed minimum return count or per-state sample quota.
Daily emission variance floor is
`1e-10`. Highest training likelihood among converged fits is selected. States are
ordered by training variance, never future returns. The last forward-filtered
probability of the higher-volatility state is the defensive score. No future
smoothing or full-sample state relabeling enters decisions. Failure is explicit;
no simpler model is silently substituted.

## Portfolio objective

For decision weights `w` and strict prior-close carried weights `w0`, minimize

`0.5 * h * gamma * w' Sigma w - h * mu' w + c * sum(abs(w - w0))`

subject to the selected capital/risk constraint and weight boxes. `h` is 1/12
for monthly and 1/4 for quarterly decisions; gamma is the user-entered risk
aversion; c is one-way transaction cost in decimal units. Historical arithmetic
mean returns and sample covariance are annualized at 252 sessions. Fixed diagonal
shrinkage preserves the diagonal and multiplies off-diagonal entries by
`1 - shrinkage`. This is not the data-estimated Ledoit–Wolf estimator.

The proximal-gradient solver handles the L1 cost, box constraints and exposure
ceiling together. A nonnegative covariance multiplier, found by bisection,
enforces a binding volatility ceiling. Solutions must converge and satisfy their
constraints; no constraint is relaxed on failure. Cost in the objective is an
estimate based on prior-close weights. Actual next-close execution uses the
existing self-financing ledger with costs on absolute filled notionals, charged
once. Prices can move between the information cutoff and fill.

## Time, identity and execution

The user selects the training window. There is no fixed statistical minimum,
including for HMM; windows are never extended automatically. Historical means,
covariance and HMM use exactly that window. Fixed-lookback indicators retain their
own causal feature history (200-price moving average / 252-return volatility),
separately recorded in decision evidence. Undefined calculations or an actual
failure to converge remain explicit errors, without changing the selected window.
Rolling/expanding windows and
monthly/quarterly dates use the existing anchor-relative calendar; a non-trading
anchor moves to the next observed session. Inputs stop before the decision date;
fills occur at the next observed close. All subsequent holdings carry forward.
Changes to models, costs, universe, parameters, source, runtime or data create
distinct run identities. Temporary attempts, worker timeout/output bounds and
the single shared execution lease reuse existing storage infrastructure. Failed
attempts remain inspectable; reruns require an explicit action.

Run the numerical and real-data regression suite from the repository root:

`node scripts/test-coordinated.mjs`

Tests include exhaustive hidden-path filtering, synthetic HMM identification,
analytic one-asset optimization, correlated risk constraints, eight real-data
model/control combinations, accounting continuity, exact costs and future-data
perturbation. Existing `interactive.test.ts` protects baseline ledger arithmetic.

Method references: [MOSEK portfolio cookbook](https://docs.mosek.com/portfolio-cookbook/markowitz.html),
[hmmlearn HMM/EM tutorial](https://hmmlearn.readthedocs.io/en/stable/tutorial.html),
[Boyd et al., Multi-Period Trading via Convex Optimization](https://web.stanford.edu/~boyd/papers/cvx_portfolio.html).
These motivate the explicit methods; they do not certify this implementation or
establish that any classifier outperforms the reference model.
