/** Deterministic two-state Gaussian HMM. EM uses training observations only;
 * the returned posterior is a forward filter at the training cutoff. */
export class ResearchError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
const sum = (x: number[]) => x.reduce((a, b) => a + b, 0);
export function filterGaussian(
  x: number[],
  mean: number[],
  variance: number[],
  transition: number[][],
  initial: number[],
) {
  let p = initial.slice(),
    logLikelihood = 0;
  const alpha: number[][] = [],
    emissions: number[][] = [],
    scales: number[] = [];
  for (let t = 0; t < x.length; t++) {
    const prior = t
      ? p.map((_, j) => sum(p.map((q, i) => q * transition[i][j])))
      : p;
    const logs = mean.map(
      (m, j) =>
        -0.5 *
        (Math.log(2 * Math.PI * variance[j]) + (x[t] - m) ** 2 / variance[j]),
    );
    const offset = Math.max(...logs),
      e = logs.map((v) => Math.exp(v - offset));
    const a = prior.map((q, j) => q * e[j]),
      scale = sum(a);
    if (!(scale > 0))
      throw new ResearchError("HMM_NUMERICAL_FAILURE", "HMM filtering failed.");
    p = a.map((v) => v / scale);
    alpha.push(p);
    emissions.push(e);
    scales.push(scale);
    logLikelihood += Math.log(scale) + offset;
  }
  return { posterior: p, alpha, emissions, scales, logLikelihood };
}
export function fitGaussianHMM(returns: number[]) {
  if (returns.length < 120 || returns.some((v) => !Number.isFinite(v)))
    throw new ResearchError(
      "HMM_HISTORY_REQUIRED",
      "HMM requires at least 120 finite daily returns.",
    );
  // Percentage units stabilize likelihood computations. Floors are declared,
  // fixed model parameters, not data replacements.
  const x = returns.map((r) => 100 * r),
    avg = sum(x) / x.length,
    v = sum(x.map((r) => (r - avg) ** 2)) / x.length;
  if (v < 1e-8)
    throw new ResearchError(
      "HMM_DEGENERATE",
      "HMM cannot identify states from constant returns.",
    );
  const fits: any[] = [];
  for (const persistence of [0.85, 0.95, 0.98]) {
    let means = [avg - 0.1 * Math.sqrt(v), avg + 0.1 * Math.sqrt(v)],
      variances = [v * 0.4, v * 1.8],
      a = [
        [persistence, 1 - persistence],
        [1 - persistence, persistence],
      ],
      pi = [0.5, 0.5];
    let previous = -Infinity,
      converged = false,
      iterations = 0;
    for (let it = 0; it < 300; it++) {
      const f = filterGaussian(x, means, variances, a, pi);
      iterations = it + 1;
      if (it > 0 && f.logLikelihood < previous - 1e-6) break;
      if (
        it > 0 &&
        Math.abs(f.logLikelihood - previous) < 1e-6 * (1 + Math.abs(previous))
      ) {
        converged = true;
        break;
      }
      previous = f.logLikelihood;
      const beta = x.map(() => [1, 1]);
      for (let t = x.length - 2; t >= 0; t--)
        for (let i = 0; i < 2; i++)
          beta[t][i] =
            sum(
              a[i].map((q, j) => q * f.emissions[t + 1][j] * beta[t + 1][j]),
            ) / f.scales[t + 1];
      const gamma = f.alpha.map((p, t) => {
        const z = p.map((q, j) => q * beta[t][j]);
        return z.map((q) => q / sum(z));
      });
      const mass = [0, 1].map((j) => sum(gamma.map((g) => g[j])));
      if (Math.min(...mass) < 5) break;
      const counts = [
        [0, 0],
        [0, 0],
      ];
      for (let t = 0; t < x.length - 1; t++) {
        const z = [0, 1].map((i) =>
          [0, 1].map(
            (j) =>
              f.alpha[t][i] * a[i][j] * f.emissions[t + 1][j] * beta[t + 1][j],
          ),
        );
        const total = sum(z.flat());
        for (let i = 0; i < 2; i++)
          for (let j = 0; j < 2; j++) counts[i][j] += z[i][j] / total;
      }
      pi = gamma[0];
      a = counts.map((row) => row.map((q) => q / sum(row)));
      means = [0, 1].map(
        (j) => sum(x.map((r, t) => r * gamma[t][j])) / mass[j],
      );
      variances = [0, 1].map((j) =>
        Math.max(
          1e-6,
          sum(x.map((r, t) => gamma[t][j] * (r - means[j]) ** 2)) / mass[j],
        ),
      );
    }
    const f = filterGaussian(x, means, variances, a, pi);
    if (
      converged &&
      means.every(Number.isFinite) &&
      variances.every(Number.isFinite)
    )
      fits.push({
        means,
        variances,
        a,
        pi,
        posterior: f.posterior,
        logLikelihood: f.logLikelihood,
        iterations,
      });
  }
  if (!fits.length)
    throw new ResearchError(
      "HMM_NOT_CONVERGED",
      "No HMM initialization converged. Change the explicit training window or model; no fallback was used.",
    );
  const best = fits.sort((a, b) => b.logLikelihood - a.logLikelihood)[0],
    order = [0, 1].sort((a, b) => best.variances[a] - best.variances[b]);
  return {
    model: "GAUSSIAN_HMM_2_V1",
    state_labels: ["Lower volatility", "Higher volatility"],
    means: order.map((j) => best.means[j] / 100),
    variances: order.map((j) => best.variances[j] / 10000),
    transition: order.map((i) => order.map((j) => best.a[i][j])),
    probabilities: order.map((j) => best.posterior[j]),
    high_risk_probability: best.posterior[order[1]],
    log_likelihood: best.logLikelihood,
    iterations: best.iterations,
    converged_initializations: fits.length,
    initializations: 3,
    training_returns: returns.length,
    variance_floor_daily: 1e-10,
  };
}

export function moments(prices: number[][], shrinkage: number) {
  const n = prices[0].length,
    r = prices.slice(1).map((p, t) => p.map((v, j) => v / prices[t][j] - 1));
  const mean = Array.from(
    { length: n },
    (_, j) => sum(r.map((x) => x[j])) / r.length,
  );
  const covariance = mean.map((_, i) =>
    mean.map(
      (__, j) =>
        ((252 * sum(r.map((x) => (x[i] - mean[i]) * (x[j] - mean[j])))) /
          (r.length - 1)) *
        (i === j ? 1 : 1 - shrinkage),
    ),
  );
  return { mean: mean.map((x) => 252 * x), covariance, observations: r.length };
}
export const quadratic = (w: number[], s: number[][]) =>
  sum(w.map((v, i) => v * sum(w.map((q, j) => s[i][j] * q))));

/** Proximal gradient for convex mean-variance + one-rebalance L1 trading cost.
 * Cash has zero return/variance. The volatility ceiling is enforced by a dual
 * multiplier; each inner problem uses the same boxes and exposure ceiling. */
export function optimize(
  mean: number[],
  covariance: number[][],
  prior: number[],
  options: {
    cap: number;
    maxWeight: number;
    riskAversion: number;
    cost: number;
    horizon: number;
    volatility: number | null;
  },
) {
  const n = mean.length,
    rowNorm = Math.max(...covariance.map((row) => sum(row.map(Math.abs))));
  if (
    mean.some((x) => !Number.isFinite(x)) ||
    covariance.flat().some((x) => !Number.isFinite(x)) ||
    !(rowNorm > 0)
  )
    throw new ResearchError(
      "OPTIMIZATION_INVALID_RISK",
      "Risk estimates must be finite and nonzero.",
    );
  let totalIterations = 0;
  function solve(multiplier: number) {
    const risk = options.horizon * options.riskAversion + multiplier,
      L = Math.max(1e-12, risk * rowNorm),
      step = 1 / L,
      penalty = step * options.cost;
    let w = Array(n).fill(0),
      residual = Infinity;
    const prox = (z: number[], lambda: number) =>
      z.map((v, j) => {
        const d = v - lambda - prior[j];
        return Math.min(
          options.maxWeight,
          Math.max(
            0,
            prior[j] + Math.sign(d) * Math.max(0, Math.abs(d) - penalty),
          ),
        );
      });
    for (let k = 0; k < 12000; k++) {
      const z = w.map(
        (v, i) =>
          v -
          step *
            (risk * sum(covariance[i].map((q, j) => q * w[j])) -
              options.horizon * mean[i]),
      );
      let next = prox(z, 0);
      if (sum(next) > options.cap) {
        let lo = 0,
          hi = Math.max(1, ...z.map(Math.abs)) + Math.max(...prior) + penalty;
        for (let b = 0; b < 55; b++) {
          const mid = (lo + hi) / 2;
          if (sum(prox(z, mid)) > options.cap) lo = mid;
          else hi = mid;
        }
        next = prox(z, hi);
      }
      residual = Math.max(...next.map((v, j) => Math.abs(v - w[j])));
      w = next;
      totalIterations++;
      if (residual < 1e-9) return { weights: w, residual };
    }
    throw new ResearchError(
      "OPTIMIZER_NOT_CONVERGED",
      "The portfolio optimizer did not converge; no weights were published.",
    );
  }
  let multiplier = 0,
    solution = solve(0);
  if (
    options.volatility !== null &&
    Math.sqrt(quadratic(solution.weights, covariance)) > options.volatility
  ) {
    let lo = 0,
      hi = 1;
    for (
      let k = 0;
      k < 60 &&
      Math.sqrt(quadratic(solve(hi).weights, covariance)) > options.volatility;
      k++
    )
      hi *= 2;
    for (let k = 0; k < 45; k++) {
      const mid = (lo + hi) / 2,
        s = solve(mid);
      if (Math.sqrt(quadratic(s.weights, covariance)) > options.volatility)
        lo = mid;
      else hi = mid;
    }
    multiplier = hi;
    solution = solve(hi);
  }
  const volatility = Math.sqrt(
      Math.max(0, quadratic(solution.weights, covariance)),
    ),
    exposure = sum(solution.weights);
  if (
    exposure > options.cap + 1e-7 ||
    solution.weights.some((w) => w < 0 || w > options.maxWeight + 1e-7) ||
    (options.volatility !== null && volatility > options.volatility + 1e-7)
  )
    throw new ResearchError(
      "OPTIMIZATION_INFEASIBLE",
      "The solved portfolio violates its constraints.",
    );
  return {
    ...solution,
    volatility,
    exposure,
    cash: 1 - exposure,
    risk_multiplier: multiplier,
    iterations: totalIterations,
  };
}
