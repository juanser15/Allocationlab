import {
  CONSTRAINED_OPTIMIZER_VERSION,
  CONSTRAINT_TOLERANCE,
  MIN_ACTIVE_WEIGHT,
  SUPPORT_TOLERANCE,
} from "../../artifacts/api-server/src/lib/workbench/portfolio-numerics";

export { CONSTRAINED_OPTIMIZER_VERSION };
export const SUPPORT_SEARCH_LIMIT = 128;
const MAX_ITERATIONS = 12000;
const STEP_TOLERANCE = 1e-10;
const sum = (x: number[]) => x.reduce((a, b) => a + b, 0);
const dot = (x: number[], y: number[]) => sum(x.map((v, i) => v * y[i]));
const multiply = (s: number[][], w: number[]) => s.map((row) => dot(row, w));
const variance = (w: number[], s: number[][]) => dot(w, multiply(s, w));
export interface HoldingsMandate {
  minimum_positions: number;
  maximum_positions: number;
  minimum_weight: number;
}
export interface ConstrainedOptions {
  cap: number;
  maxWeight: number;
  riskAversion: number;
  cost: number;
  horizon: number;
  volatility: number | null;
  mandate: HoldingsMandate;
}
class SolverError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
  }
}
function fail(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): never {
  throw new SolverError(code, message, {
    category: code,
    methodology_version: CONSTRAINED_OPTIMIZER_VERSION,
    ...details,
  });
}
function checkCovariance(covariance: number[][], n: number) {
  if (
    covariance.length !== n ||
    covariance.some(
      (row) => row.length !== n || row.some((v) => !Number.isFinite(v)),
    )
  )
    fail("NUMERICAL_FAILURE", "Risk matrix dimensions or values are invalid.");
  const scale = Math.max(...covariance.flat().map(Math.abs));
  if (!(scale > 0))
    fail("NUMERICAL_FAILURE", "Risk estimates must be finite and nonzero.");
  const tol = Math.max(1e-14, scale * 1e-10),
    l = covariance.map(() => Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      if (Math.abs(covariance[i][j] - covariance[j][i]) > tol)
        fail(
          "NUMERICAL_FAILURE",
          "Risk matrix is not symmetric; no weights were published.",
        );
      const remainder =
        covariance[i][j] - sum(l[i].slice(0, j).map((v, k) => v * l[j][k]));
      if (i === j) {
        if (remainder < -tol)
          fail(
            "NUMERICAL_FAILURE",
            "Risk matrix is not positive semidefinite; no weights were published.",
          );
        l[i][j] = Math.sqrt(Math.max(0, remainder));
      } else if (l[j][j] > 0) l[i][j] = remainder / l[j][j];
      else if (Math.abs(remainder) > tol)
        fail(
          "NUMERICAL_FAILURE",
          "Risk matrix has an inconsistent zero-variance direction.",
        );
    }
}

/** Exact minimization of the composite first-order model over a box and
 * exposure ceiling. Each asset contributes slopes g-cost up to its prior
 * holding and g+cost thereafter. Filling negative slope segments in ascending
 * order is the continuous-knapsack optimum; no portfolio output is changed. */
export function compositeOptimalityGap(
  weights: number[],
  gradient: number[],
  prior: number[],
  cost: number,
  floor: number,
  upper: number,
  cap: number,
) {
  const baseline = gradient.reduce(
    (value, g, j) => value + g * floor + cost * Math.abs(floor - prior[j]),
    0,
  );
  const segments: Array<{
    slope: number;
    length: number;
    index: number;
    part: number;
  }> = [];
  gradient.forEach((g, j) => {
    const kink = Math.max(floor, Math.min(upper, prior[j]));
    if (kink > floor)
      segments.push({
        slope: g - cost,
        length: kink - floor,
        index: j,
        part: 0,
      });
    if (upper > kink)
      segments.push({
        slope: g + cost,
        length: upper - kink,
        index: j,
        part: 1,
      });
  });
  segments.sort(
    (a, b) => a.slope - b.slope || a.index - b.index || a.part - b.part,
  );
  let remaining = Math.max(0, cap - weights.length * floor),
    minimum = baseline;
  for (const segment of segments) {
    if (segment.slope >= 0 || remaining === 0) break;
    const used = Math.min(remaining, segment.length);
    minimum += used * segment.slope;
    remaining -= used;
  }
  const current =
    dot(gradient, weights) +
    cost * sum(weights.map((w, j) => Math.abs(w - prior[j])));
  return {
    gap: Math.max(0, current - minimum),
    linearized_value: current,
    linearized_minimum: minimum,
  };
}

/** Each support is solved with its box floors, exposure inequality and volatility
 * constraint INSIDE the optimization. Selection of a different support always
 * invokes a new constrained solve; no output pruning, uplift or renormalization. */
export function solveCardinalityPortfolio(
  mean: number[],
  covariance: number[][],
  prior: number[],
  options: ConstrainedOptions,
) {
  const n = mean.length,
    m = options.mandate;
  if (
    !n ||
    prior.length !== n ||
    mean.some((x) => !Number.isFinite(x)) ||
    prior.some((x) => !Number.isFinite(x) || x < 0)
  )
    fail(
      "NUMERICAL_FAILURE",
      "Expected returns or prior holdings have invalid values or dimensions.",
    );
  checkCovariance(covariance, n);
  if (
    ![
      options.cap,
      options.maxWeight,
      options.riskAversion,
      options.cost,
      options.horizon,
    ].every(Number.isFinite) ||
    options.cap < 0 ||
    options.cap > 1 ||
    options.maxWeight <= 0 ||
    options.maxWeight > 1 ||
    options.riskAversion < 0 ||
    options.cost < 0 ||
    options.horizon <= 0 ||
    (options.volatility !== null &&
      (!Number.isFinite(options.volatility) || options.volatility < 0))
  )
    fail(
      "PORTFOLIO_CONSTRAINT",
      "Optimizer bounds, risk aversion, costs and horizon must be finite and valid.",
    );
  if (
    !Number.isSafeInteger(m.minimum_positions) ||
    !Number.isSafeInteger(m.maximum_positions) ||
    m.minimum_positions < 1 ||
    m.maximum_positions < m.minimum_positions ||
    m.maximum_positions > n ||
    !Number.isFinite(m.minimum_weight) ||
    m.minimum_weight < 0 ||
    m.minimum_weight > options.maxWeight
  )
    fail(
      "PORTFOLIO_CONSTRAINT",
      "Holdings counts and minimum/maximum position weights are inconsistent.",
    );
  const floor = Math.max(m.minimum_weight, MIN_ACTIVE_WEIGHT),
    risk = options.horizon * options.riskAversion;
  const objective = (w: number[]) =>
    0.5 * risk * variance(w, covariance) -
    options.horizon * dot(mean, w) +
    options.cost * sum(w.map((v, i) => Math.abs(v - prior[i])));
  const empty = Array(n).fill(0) as number[];
  const emptyAudit = {
    methodology_version: CONSTRAINED_OPTIMIZER_VERSION,
    status: "EXPLICIT_ALL_CASH",
    converged: true,
    selected_support: [] as number[],
    support_size: 0,
    minimum_positive_weight: null as number | null,
    support_tolerance: SUPPORT_TOLERANCE,
    constraint_tolerance: CONSTRAINT_TOLERANCE,
    numerical_support_floor: MIN_ACTIVE_WEIGHT,
    effective_minimum_weight: floor,
    objective: objective(empty),
    objective_direction: "MINIMIZE",
    optimality_gap_tolerance:
      1e-9 *
      Math.max(
        1,
        options.cost,
        ...mean.map((x) => Math.abs(options.horizon * x)),
      ),
    support_search: {
      evaluated: 0,
      limit: SUPPORT_SEARCH_LIMIT,
      exhaustive: true,
      global_optimality_claim: false,
    },
    residuals: {
      exposure: 0,
      lower_bound: 0,
      upper_bound: 0,
      volatility: 0,
      cardinality: 0,
      proximal_step: 0,
      composite_optimality_gap: 0,
      volatility_dual_complementarity: 0,
    },
    constraints: {
      ...options,
      support_semantics: "NAV_WEIGHT_GREATER_THAN_SUPPORT_TOLERANCE",
      exposure_semantics: "CEILING",
    },
  };
  if (options.cap === 0)
    return {
      weights: empty,
      residual: 0,
      volatility: 0,
      exposure: 0,
      cash: 1,
      risk_multiplier: 0,
      iterations: 0,
      audit: emptyAudit,
    };
  if (floor > options.maxWeight)
    fail(
      "PORTFOLIO_CONSTRAINT",
      "The maximum position weight is below the numerical positive-support floor.",
      { numerical_support_floor: MIN_ACTIVE_WEIGHT },
    );
  if (m.minimum_positions * floor > options.cap + Number.EPSILON)
    fail(
      "PORTFOLIO_CONSTRAINT",
      "Minimum holdings and positive-weight floors exceed the invested exposure ceiling.",
      {
        minimum_positions: m.minimum_positions,
        effective_minimum_weight: floor,
        exposure_ceiling: options.cap,
      },
    );
  const maxK = Math.min(
    m.maximum_positions,
    Math.floor((options.cap + Number.EPSILON) / floor),
  );
  let totalIterations = 0;
  type ConvexSolution = {
    weights: number[];
    residual: number;
    iterations: number;
    multiplier: number;
    optimality_gap: number;
    optimality_gap_tolerance: number;
  };
  type Candidate = ConvexSolution & {
    support: number[];
    full: number[];
    objective: number;
  };
  const cache = new Map<string, Candidate | null>(),
    failures: Array<{ support: number[]; reason: string }> = [];
  let numericalFailures = 0;
  function supportSolve(support: number[]): Candidate | null {
    const key = support.join(",");
    if (cache.has(key)) return cache.get(key)!;
    if (cache.size >= SUPPORT_SEARCH_LIMIT) return null;
    cache.set(key, null);
    const s = support.map((i) => support.map((j) => covariance[i][j])),
      mu = support.map((i) => mean[i]),
      old = support.map((i) => prior[i]);
    const rowNorm = Math.max(...s.map((row) => sum(row.map(Math.abs))));
    const prox = (z: number[], stepPenalty: number) => {
      const at = (lambda: number) =>
        z.map((value, j) => {
          const difference = value - lambda - old[j];
          return Math.min(
            options.maxWeight,
            Math.max(
              floor,
              old[j] +
                Math.sign(difference) *
                  Math.max(0, Math.abs(difference) - stepPenalty),
            ),
          );
        });
      let result = at(0);
      if (sum(result) > options.cap) {
        let lo = 0,
          hi =
            Math.max(1, ...z.map(Math.abs)) +
            Math.max(...old) +
            stepPenalty +
            options.maxWeight;
        for (let b = 0; b < 60; b++) {
          const mid = (lo + hi) / 2;
          if (sum(at(mid)) > options.cap) lo = mid;
          else hi = mid;
        }
        result = at(hi);
      }
      return result;
    };
    function solve(
      multiplier: number,
      varianceOnly = false,
      initial?: number[],
    ): ConvexSolution {
      const coefficient = varianceOnly ? 1 : risk + multiplier;
      // A nonzero majorizer also covers a zero-risk linear objective.
      const L = Math.max(coefficient * rowNorm, 1e-6),
        step = 1 / L;
      let w = initial?.slice() ?? prox(old, 0),
        residual = Infinity;
      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const product = multiply(s, w);
        const z = w.map(
          (v, i) =>
            v -
            step *
              (coefficient * product[i] -
                (varianceOnly ? 0 : options.horizon * mu[i])),
        );
        const next = prox(z, varianceOnly ? 0 : step * options.cost);
        residual = Math.max(...next.map((v, i) => Math.abs(v - w[i])));
        w = next;
        totalIterations++;
        if (residual <= STEP_TOLERANCE) {
          const gradient = multiply(s, w).map(
            (v, j) =>
              coefficient * v - (varianceOnly ? 0 : options.horizon * mu[j]),
          );
          const certificate = compositeOptimalityGap(
            w,
            gradient,
            old,
            varianceOnly ? 0 : options.cost,
            floor,
            options.maxWeight,
            options.cap,
          );
          const tolerance = varianceOnly
            ? 1e-10
            : emptyAudit.optimality_gap_tolerance;
          if (Number.isFinite(certificate.gap) && certificate.gap <= tolerance)
            return {
              weights: w,
              residual,
              iterations: iteration + 1,
              multiplier,
              optimality_gap: certificate.gap,
              optimality_gap_tolerance: tolerance,
            };
        }
      }
      throw Error("CONTINUOUS_SUBPROBLEM_NOT_CONVERGED");
    }
    try {
      let solution = solve(0);
      if (
        options.volatility !== null &&
        variance(solution.weights, s) > options.volatility ** 2
      ) {
        // A minimum-variance point establishes support-specific feasibility,
        // without assuming the lower-bound vector minimizes correlated risk.
        const minRisk = solve(0, true);
        if (
          Math.sqrt(Math.max(0, variance(minRisk.weights, s))) >
          options.volatility + CONSTRAINT_TOLERANCE
        ) {
          // Convex tangent lower bound, minimized exactly over the box/ceiling
          // polytope. Nonconvergence is never called a proof of infeasibility.
          const g = multiply(s, minRisk.weights),
            vertex = support.map(() => floor);
          let remaining = options.cap - support.length * floor;
          for (const j of g
            .map((_, i) => i)
            .sort((a, b) => g[a] - g[b] || a - b)) {
            if (g[j] >= 0) break;
            const addition = Math.min(
              options.maxWeight - floor,
              Math.max(0, remaining),
            );
            vertex[j] += addition;
            remaining -= addition;
          }
          const lowerVariance =
            variance(minRisk.weights, s) +
            2 *
              dot(
                g,
                vertex.map((v, i) => v - minRisk.weights[i]),
              );
          if (lowerVariance > options.volatility ** 2 + 1e-12) {
            failures.push({
              support,
              reason: "MINIMUM_VARIANCE_EXCEEDS_LIMIT",
            });
            return null;
          }
          throw Error("MINIMUM_VARIANCE_NOT_CERTIFIED");
        }
        let lo = 0,
          hi = 1,
          high = solve(hi),
          bracketed = variance(high.weights, s) <= options.volatility ** 2;
        for (let i = 0; i < 55 && !bracketed; i++) {
          hi *= 2;
          high = solve(hi, false, high.weights);
          bracketed = variance(high.weights, s) <= options.volatility ** 2;
        }
        if (!bracketed) {
          // At a zero-width feasible risk boundary the dual multiplier can be
          // unbounded. Fail explicitly; do not substitute a different objective.
          throw Error("VOLATILITY_DUAL_BOUNDARY_NOT_CERTIFIED");
        }
        for (let i = 0; i < 42; i++) {
          const mid = (lo + hi) / 2,
            candidate = solve(mid, false, high.weights);
          if (variance(candidate.weights, s) > options.volatility ** 2)
            lo = mid;
          else {
            hi = mid;
            high = candidate;
          }
        }
        solution = high;
      }
      const full = Array(n).fill(0) as number[];
      support.forEach((j, i) => {
        full[j] = solution.weights[i];
      });
      const v = Math.sqrt(Math.max(0, variance(full, covariance))),
        exposure = sum(full);
      if (
        full.some(
          (w, i) =>
            !Number.isFinite(w) ||
            (support.includes(i)
              ? w < floor || w > options.maxWeight + CONSTRAINT_TOLERANCE
              : w !== 0),
        ) ||
        exposure > options.cap + CONSTRAINT_TOLERANCE ||
        (options.volatility !== null &&
          v > options.volatility + CONSTRAINT_TOLERANCE)
      )
        throw Error("CONTINUOUS_CONSTRAINT_CERTIFICATE_FAILED");
      const complementarity =
        options.volatility === null
          ? 0
          : Math.abs(
              0.5 *
                solution.multiplier *
                (variance(full, covariance) - options.volatility ** 2),
            );
      if (
        !Number.isFinite(complementarity) ||
        complementarity > 10 * solution.optimality_gap_tolerance
      )
        throw Error("VOLATILITY_DUAL_COMPLEMENTARITY_NOT_CERTIFIED");
      const candidate = {
        ...solution,
        support,
        full,
        objective: objective(full),
      };
      cache.set(key, candidate);
      return candidate;
    } catch (error) {
      numericalFailures++;
      failures.push({ support, reason: (error as Error).message });
      return null;
    }
  }
  const choose = (
    a: Candidate | null,
    b: Candidate | null,
  ): Candidate | null => {
    if (!b) return a;
    if (!a) return b;
    const tolerance =
      1e-12 * Math.max(1, Math.abs(a.objective), Math.abs(b.objective));
    if (b.objective < a.objective - tolerance) return b;
    if (
      Math.abs(a.objective - b.objective) <= tolerance &&
      b.support.join(",").localeCompare(a.support.join(","), "en") < 0
    )
      return b;
    return a;
  };
  const countCombinations = () => {
    let total = 0,
      c = 1;
    for (let k = 1; k <= maxK; k++) {
      c = (c * (n - k + 1)) / k;
      if (k >= m.minimum_positions) total += c;
      if (total > SUPPORT_SEARCH_LIMIT) return SUPPORT_SEARCH_LIMIT + 1;
    }
    return Math.round(total);
  };
  const exhaustive = countCombinations() <= SUPPORT_SEARCH_LIMIT;
  let best: Candidate | null = null;
  const visit = (support: number[]) => {
    const ordered = support.slice().sort((a, b) => a - b);
    best = choose(best, supportSolve(ordered));
  };
  if (exhaustive) {
    function enumerate(k: number, start = 0, selected: number[] = []) {
      if (selected.length === k) {
        visit(selected);
        return;
      }
      for (let i = start; i <= n - (k - selected.length); i++)
        enumerate(k, i + 1, [...selected, i]);
    }
    for (let k = m.minimum_positions; k <= maxK; k++) enumerate(k);
  } else {
    const indices = mean.map((_, i) => i);
    const rank = (score: (i: number) => number) =>
      indices.slice().sort((a, b) => score(b) - score(a) || a - b);
    const ranks = [
      rank(
        (i) =>
          (options.horizon * mean[i]) /
          Math.max(1e-12, Math.sqrt(Math.max(0, covariance[i][i]))),
      ),
      rank((i) => -covariance[i][i]),
      rank((i) => prior[i]),
    ];
    // Seed increasing allowed cardinalities within the fixed search budget,
    // including retained-holdings and risk-ranked supports. Economic ranking is only exploration;
    // every published candidate comes from its own constrained full solve.
    for (const order of ranks)
      for (let k = m.minimum_positions; k <= maxK; k++) visit(order.slice(0, k));
    if (!best)
      for (
        let offset = 1;
        offset < n && cache.size < SUPPORT_SEARCH_LIMIT;
        offset++
      )
        for (
          let k = m.minimum_positions;
          k <= maxK && cache.size < SUPPORT_SEARCH_LIMIT;
          k++
        )
          visit(
            Array.from({ length: k }, (_, i) => ranks[0][(offset + i) % n]),
          );
    let improved = true;
    while (best && improved && cache.size < SUPPORT_SEARCH_LIMIT) {
      const incumbent = best as Candidate,
        support = incumbent.support,
        outside = ranks[0].filter((i) => !support.includes(i));
      for (const incoming of outside) {
        if (support.length < maxK) visit([...support, incoming]);
        for (const outgoing of support) {
          if (cache.size >= SUPPORT_SEARCH_LIMIT) break;
          visit([...support.filter((i) => i !== outgoing), incoming]);
        }
      }
      if (support.length > m.minimum_positions)
        for (const outgoing of support)
          visit(support.filter((i) => i !== outgoing));
      improved =
        !!best &&
        (best as Candidate).support.join(",") !== incumbent.support.join(",");
    }
  }
  if (!best) {
    const proven = exhaustive && numericalFailures === 0;
    fail(
      proven ? "SOLVER_INFEASIBLE" : "NUMERICAL_FAILURE",
      proven
        ? "No allowed holdings support satisfies the model's risk and exposure constraints."
        : "The bounded optimizer could not certify a feasible portfolio. No weights were published and no mandate was relaxed.",
      {
        solver_status: proven
          ? "INFEASIBLE"
          : numericalFailures
            ? "SUBPROBLEM_FAILURE"
            : "SEARCH_LIMIT",
        proven_infeasible: proven,
        supports_evaluated: cache.size,
        support_search_limit: SUPPORT_SEARCH_LIMIT,
        exhaustive,
        failures,
      },
    );
  }
  const selected = best as Candidate,
    weights = selected.full,
    exposure = sum(weights),
    vol = Math.sqrt(Math.max(0, variance(weights, covariance)));
  const audit = {
    ...emptyAudit,
    status: "CONVERGED_FEASIBLE_SUPPORT",
    selected_support: selected.support,
    support_size: selected.support.length,
    minimum_positive_weight: Math.min(
      ...selected.support.map((i) => weights[i]),
    ),
    objective: selected.objective,
    support_search: {
      evaluated: cache.size,
      limit: SUPPORT_SEARCH_LIMIT,
      exhaustive,
      global_optimality_claim: false,
      numerical_failures: numericalFailures,
      failures,
    },
    residuals: {
      exposure: Math.max(0, exposure - options.cap),
      lower_bound: Math.max(
        0,
        ...selected.support.map((i) => floor - weights[i]),
      ),
      upper_bound: Math.max(0, ...weights.map((v) => v - options.maxWeight)),
      volatility:
        options.volatility === null ? 0 : Math.max(0, vol - options.volatility),
      cardinality: Math.max(
        0,
        m.minimum_positions - selected.support.length,
        selected.support.length - m.maximum_positions,
      ),
      proximal_step: selected.residual,
      composite_optimality_gap: selected.optimality_gap,
      volatility_dual_complementarity:
        options.volatility === null
          ? 0
          : Math.abs(
              0.5 *
                selected.multiplier *
                (variance(weights, covariance) - options.volatility ** 2),
            ),
    },
  };
  return {
    weights,
    residual: selected.residual,
    volatility: vol,
    exposure,
    cash: 1 - exposure,
    risk_multiplier: selected.multiplier,
    iterations: totalIterations,
    audit,
  };
}
