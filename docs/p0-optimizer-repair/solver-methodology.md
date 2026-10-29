# Cardinality-aware optimizer methodology

Authority: `research/coordinated/constrained-optimizer.ts`, called by the mandate-aware branch of `research/coordinated/models.ts::optimize`. Version: `cardinality-active-support-1.0.0`, defined with the shared numerical constants in `artifacts/api-server/src/lib/workbench/portfolio-numerics.ts`.

This repair uses deterministic support exploration with constrained continuous re-optimization. It does not introduce an external MIQP solver, dependency, license or network service. The small and medium eligible universes can be searched under an explicit support budget, using the existing mean–variance and trading-cost objective. The result is a certified feasible solution on the selected support, not a claim of global optimality over a large discrete universe.

## Financial objective and constraints

Let `x` be risky-asset weights on **total NAV**, `p` the prior actual NAV weights, `mu` annualized expected returns, `Sigma` annualized covariance, `h` the existing rebalance horizon, `a` the existing risk-aversion coefficient and `c` the existing one-rebalance proportional trading-cost assumption. The unchanged objective is minimized:

```text
F(x) = 0.5 h a x' Sigma x - h mu' x + c sum_i |x_i - p_i|
```

The cost sum includes every eligible asset, including the liquidation cost of a prior position absent from a proposed support. Omitting an asset from the new support does not make its liquidation free. This is the existing optimizer's cost penalty; realized ledger fees, slippage, turnover and next-close accounting remain separate unchanged authorities.

For a selected support `S`, the continuous subproblem enforces:

```text
x_i = 0                             for i outside S
max(w_min, numerical_floor) <= x_i <= w_max   for i in S
K_min <= |S| <= K_max
sum_i x_i <= E
x' Sigma x <= volatility_limit^2    when the risk ceiling is configured
```

`sum(x) <= E` remains a **ceiling**, not an equality. A solution can retain residual cash even when more exposure is allowed. The repair does not infer or force a fully invested mandate. The general requirement `K_max*w_max >= E` is therefore not applied to this ceiling contract. If exact investment is introduced later, it needs an explicit contract and equality-constrained subproblem.

An explicit zero capital-exposure decision is all cash and exempt from positive minimum holdings. Positive investment budgets still require coherent mandate bounds. The optimizer does not select the global risk-off policy.

The shared support definition is `x_i > 1e-10`. When the economic minimum is zero or below this threshold, a declared `2e-10` numerical floor keeps selected positions strictly inside that support definition. The effective lower bound is recorded in the audit. It is enforced inside the solve; it is not an afterward adjustment of a returned portfolio. Static feasibility checks account for this representational floor at tiny positive exposure budgets. Financially meaningful floors such as 3% are unchanged.

## Deterministic support search

For feasible cardinalities, if the total number of supports is at most **128**, every support is enumerated. Larger spaces use deterministic seeds based on expected-return/risk ranking, low individual variance and prior holdings. Allowed cardinalities are visited in increasing order within each ranking and the fixed budget. If no feasible seed exists, additional rotated supports are explored. A feasible incumbent is improved through support additions, deletions and single-asset swaps, subject to the same cardinality and search bounds.

Every new support receives a complete constrained continuous solve. Cached results avoid repeated work. The chosen objective is compared with a declared relative tie tolerance of `1e-12`; deterministic support ordering breaks objective ties. A seed ranking is a search heuristic, not an alternative allocation formula.

The algorithm never solves an unconstrained portfolio and then prunes names, raises weights, rescales weights or renormalizes the result to pass a validator. Changing support requires re-solving. The final constraint audit only checks the candidate that the optimizer constructed.

A maximum of **128 distinct supports** is evaluated. The audit states whether enumeration was exhaustive, how many supports were evaluated and which supports failed numerically or on proved risk infeasibility. `global_optimality_claim` is false, including for small numerically enumerated cases; the report does not turn a floating-point certificate into an exact global proof.

## Continuous support solve

For a nonnegative volatility dual multiplier `nu`, the smooth quadratic coefficient is `h*a + nu`. Proximal gradient uses the covariance row-sum norm as a Lipschitz majorizer, with a small positive lower bound for a zero-risk linear objective. Its proximal map includes the L1 trading-cost kink at the prior weight, the support's lower/upper boxes and the exposure ceiling.

If the ceiling binds, a deterministic scalar multiplier is found with **60 bisection steps** inside the proximal map. These are intermediate optimization iterates, not modifications to a completed result.

A continuous solve allows at most **12,000 iterations**. Small weight changes alone do not establish convergence. A candidate must satisfy both:

- Maximum absolute consecutive-weight change at most `1e-10`.
- A convex composite first-order gap at most `1e-9 * max(1, c, max_i |h*mu_i|)`.

For gradient `g = (h*a + nu) Sigma x - h*mu`, the gap is:

```text
G = g'x + c sum |x-p|
    - min_{v in support boxes, sum(v)<=E} (g'v + c sum |v-p|)
```

The inner piecewise-linear problem is minimized exactly up to floating-point arithmetic. Each asset has slope `g_i-c` before its prior holding and `g_i+c` afterward. Starting from the lower bounds, negative-slope segments are filled in ascending slope order until the ceiling binds or all remaining slopes are nonnegative. This certificate calculation does not change the portfolio. The tolerance is scaled by economic linear units, not by a potentially enormous dual Lipschitz coefficient, so tiny steps caused by ill-conditioning cannot masquerade as convergence.

## Risk feasibility and volatility dual

First solve with `nu=0`. If the volatility constraint binds, a separate minimum-variance support problem tests risk feasibility. The minimum-variance solve uses a `1e-10` composite-gap tolerance. It does **not** assume that the vector of minimum weights minimizes variance; negative covariances can make extra exposure reduce risk.

To certify a support impossible, the implementation constructs a convex tangent lower bound:

```text
q_lower = x' Sigma x + 2 min_{v in boxes, sum(v)<=E} (Sigma x)'(v-x)
```

The linear minimization is solved over the same box/ceiling polytope. Only a lower bound exceeding the variance limit by more than `1e-12` proves risk infeasibility. An uncertain bound or failed numerical convergence is reported as a numerical failure, not as mathematical infeasibility.

The volatility multiplier is bracketed with up to **55 doublings** after its initial trial and then refined with **42 bisections**. The accepted point must satisfy primal bounds/risk tolerance and dual complementarity:

```text
|0.5 nu (x' Sigma x - volatility_limit^2)| <= 10 * gap_tolerance
```

The published audit includes the actual composite gap, tolerance, multiplier and dual-complementarity residual. Extremely tight boundaries can require an unbounded multiplier or exceed numerical resolution. Those cases return an explicit uncertified numerical status; the code does not replace the financial objective with the minimum-variance objective to manufacture success.

## Audit and failure semantics

Successful mandated solves report support indices/size, minimum positive NAV weight, exposure, residual cash, volatility, objective, iterations, convergence status, support search coverage and residuals for cardinality, lower/upper bounds, exposure, risk, proximal step, composite optimality and dual complementarity. The engine additionally associates indices with the frozen source universe and decision metadata.

| Result | Meaning |
|---|---|
| `CONVERGED_FEASIBLE_SUPPORT` | Published support satisfies construction and numerical certificates. Other supports may remain unexplored. |
| `EXPLICIT_ALL_CASH` | Zero exposure is an explicit capital-policy case. |
| `PORTFOLIO_CONSTRAINT` | Invalid or analytically impossible configured bounds. Authoritative preflight should catch these before run creation. |
| `SOLVER_INFEASIBLE`, `proven_infeasible=true` | All supports were exhaustively searched and each was proved infeasible without a numerical failure. |
| `NUMERICAL_FAILURE`, `solver_status=SEARCH_LIMIT` | Bounded exploration found no certified feasible support; infeasibility is **not** proved. |
| `NUMERICAL_FAILURE`, `solver_status=SUBPROBLEM_FAILURE` | A required continuous, risk or certificate calculation failed to converge or certify. No illegal weights are returned. |

Invalid/nonfinite/asymmetric risk matrices and covariance matrices failing the positive-semidefinite check within its declared scaled numerical tolerance fail closed. Singular positive-semidefinite matrices are allowed where arithmetic and convergence can be certified. Ill-conditioned matrices may reach the iteration bound. No diagonal loading, covariance repair or model substitution is silently introduced.

## Complexity and operational limits

For `n` eligible assets, support size `k`, at most `B=128` support solves, at most `I=12,000` proximal iterations per continuous solve and at most `D=100` continuous solves for a risk-constrained support, a conservative bound is:

```text
O(n^3 + B * (D*I*(k^2 + 60*k + k*log(k)) + n^2))
```

The `n^3` term is the risk-matrix check; `k^2` is a covariance product; `60*k` bounds the exposure proximal bisection; `k*log(k)` is certificate segment sorting. Full-vector objective/audit costs contribute `n^2`. Storage is approximately `O(n^2 + B*n)`, excluding result ledgers managed elsewhere. A nonbinding volatility constraint needs only the initial continuous support solve. These are worst-case bounds, not latency promises. Existing worker timeout/output limits remain authoritative, and private-data runtime capacity still needs validation in Replit.

## Preservation and evidence boundary

Without a holdings mandate, `models.ts::optimize` retains the original continuous solver body and runtime return shape. The repair does not change HMM fitting/filtering, expected-return models, covariance estimation, cash yield, ledger fills or transaction-cost mathematics.

The daily capital layer retains its independent clock and frozen intramonth ETF composition. A positive daily exposure that cannot support the frozen composition's NAV floors is an explicit dynamic constraint failure; it is not repaired by rerunning allocation intramonth. Explicit all-cash risk-off remains valid. The engine integration documents these behaviors separately.

`constrained-optimizer.test.ts` uses labelled source-only mathematical fixtures. It checks the two post-solve mandate defects, multiple cardinalities, analytical scalar L1 solutions, retained-holding kinks, liquidated prior holdings, a correlated analytical optimum, binding volatility, convex infeasibility evidence, an exact certificate oracle, deterministic bounded search and ill-conditioned false-step rejection. The legacy analytical no-mandate result remains exact. These tests do not use or replace the excluded private historical dataset and do not establish full empirical/runtime certification.
