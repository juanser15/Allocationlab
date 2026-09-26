// D4 solves the exact mean-uncertainty objective by a one-dimensional
// parametric-QP search.  For fixed lambda, the QP has Hessian H + lambda V;
// the robust KKT condition is lambda = kappa / sqrt(w' V w).
// This preserves the original linear constraints and every auxiliary variable.
// @ts-expect-error quadprog 2.0.0 does not publish TypeScript declarations.
import { solveQP } from "quadprog";

export const D4_SOLVER_VERSION = "D4.2";

export interface RobustLinearConstraint {
  name: string;
  coefficients: number[];
  lower?: number;
  upper?: number;
}

export interface RobustSolveOutput {
  solution: number[];
  nominalSolution: number[];
  robustHaircut: number;
  objectiveTotal: number;
  lambda: number;
  iterations: number;
  primalResidual: number;
  stationarityResidual: number;
  reason?: string;
}

function dot(a: number[], b: number[]): number {
  return a.reduce((sum, value, i) => sum + value * b[i], 0);
}

function quadratic(x: number[], matrix: number[][]): number {
  return dot(x, matrix.map((row) => dot(row, x)));
}

function qp(matrix: number[][], linear: number[], constraints: RobustLinearConstraint[]) {
  const size = linear.length;
  const converted = constraints.flatMap((constraint) => {
    const entries: Array<{ coefficients: number[]; bound: number; equality: boolean }> = [];
    if (constraint.lower !== undefined && constraint.upper !== undefined &&
      Math.abs(constraint.upper - constraint.lower) <= 1e-14) {
      entries.push({ coefficients: constraint.coefficients, bound: constraint.lower, equality: true });
    } else {
      if (constraint.lower !== undefined)
        entries.push({ coefficients: constraint.coefficients, bound: constraint.lower, equality: false });
      if (constraint.upper !== undefined)
        entries.push({ coefficients: constraint.coefficients.map((value) => -value),
          bound: -constraint.upper, equality: false });
    }
    return entries;
  }).sort((a, b) => Number(b.equality) - Number(a.equality));
  const equalityCount = converted.filter((constraint) => constraint.equality).length;
  const qpMatrix = (values: number[][]) => [[0, ...Array(size).fill(0)], ...values.map((row) => [0, ...row])];
  const qpVector = (values: number[]) => [0, ...values];
  const qpConstraints = [[0, ...Array(converted.length).fill(0)],
    ...Array.from({ length: size }, (_, i) => [0, ...converted.map((constraint) => constraint.coefficients[i])])];
  const result = solveQP(qpMatrix(matrix), qpVector(linear.map((value) => -value)),
    qpConstraints, qpVector(converted.map((constraint) => constraint.bound)), equalityCount) as
      { solution?: number[]; iterations?: number[]; message?: string };
  if (!result.solution || result.message) {
    if (!/not positive definite/i.test(result.message ?? ""))
      throw new Error(result.message ?? "QP solver did not return a solution.");
    const scale = Math.max(1, ...matrix.flat().map(Math.abs));
    const lift = scale * 1e-12;
    const lifted = matrix.map((row, i) => row.map((value, j) => value + (i === j ? lift : 0)));
    const retried = solveQP(qpMatrix(lifted), qpVector(linear.map((value) => -value)),
      qpConstraints, qpVector(converted.map((constraint) => constraint.bound)), equalityCount) as
        { solution?: number[]; iterations?: number[]; message?: string };
    if (!retried.solution || retried.message)
      throw new Error(retried.message ?? "QP solver did not return a solution.");
    return { x: retried.solution.slice(1), iterations: retried.iterations?.slice(1).reduce((a, b) => a + b, 0) ?? 0 };
  }
  return { x: result.solution.slice(1), iterations: result.iterations?.slice(1).reduce((a, b) => a + b, 0) ?? 0 };
}

function maxViolation(x: number[], constraints: RobustLinearConstraint[]): number {
  return constraints.reduce((largest, constraint) => {
    const value = dot(constraint.coefficients, x);
    return Math.max(largest, constraint.lower === undefined ? 0 : constraint.lower - value,
      constraint.upper === undefined ? 0 : value - constraint.upper);
  }, 0);
}

function symmetricEigen(matrix: number[][]): { values: number[]; vectors: number[][] } {
  const n = matrix.length;
  const a = matrix.map((row, i) => row.map((value, j) => (value + matrix[j][i]) / 2));
  const vectors: number[][] = a.map((_, i) => a.map((__, j) => i === j ? 1 : 0));
  const scale = Math.max(0, ...a.flat().map(Math.abs));
  for (let iteration = 0; iteration < 100 * n * n; iteration++) {
    let p = 0, q = 0, largest = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
      if (Math.abs(a[i][j]) > largest) { largest = Math.abs(a[i][j]); p = i; q = j; }
    if (largest <= Math.max(Number.MIN_VALUE, scale * Number.EPSILON * n * 8)) break;
    const tau = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const t = tau === 0 ? 1 : Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t), s = t * c;
    const app = a[p][p] - t * a[p][q];
    const aqq = a[q][q] + t * a[p][q];
    for (let k = 0; k < n; k++) if (k !== p && k !== q) {
      const akp = c * a[k][p] - s * a[k][q];
      const akq = s * a[k][p] + c * a[k][q];
      a[k][p] = a[p][k] = akp;
      a[k][q] = a[q][k] = akq;
    }
    for (let k = 0; k < n; k++) {
      const vkp = c * vectors[k][p] - s * vectors[k][q];
      const vkq = s * vectors[k][p] + c * vectors[k][q];
      vectors[k][p] = vkp;
      vectors[k][q] = vkq;
    }
    a[p][p] = app;
    a[q][q] = aqq;
    a[p][q] = a[q][p] = 0;
  }
  const values = a.map((row, i) => row[i]);
  const residualTolerance = Math.max(Number.MIN_VALUE, scale * 1e-10);
  for (let j = 0; j < n; j++) {
    const vector = vectors.map((row) => row[j]);
    const residual = matrix.map((row, i) =>
      dot(row, vector) - values[j] * vector[i]);
    const residualNorm = Math.sqrt(dot(residual, residual));
    if (residualNorm > residualTolerance)
      throw new Error(`Could not certify the forecast-uncertainty eigendecomposition (residual ${residualNorm}, tolerance ${residualTolerance}).`);
  }
  return { values, vectors };
}

function zeroRiskDualCertificate(
  x: number[],
  hessian: number[][],
  linear: number[],
  uncertainty: number[][],
  constraints: RobustLinearConstraint[],
  kappa: number,
  n: number,
): { violation: number; dualNorm: number; gradientResidual: number } | null {
  const riskVariance = Math.max(0, quadratic(x.slice(0, n), uncertainty));
  const riskScale = Math.max(0, ...uncertainty.flat().map(Math.abs));
  const weightNormSquared = dot(x.slice(0, n), x.slice(0, n));
  if (riskVariance > Math.max(Number.MIN_VALUE, riskScale * weightNormSquared * 1e-24)) return null;
  const violation = maxViolation(x, constraints);
  if (violation > 1e-8) return null;

  // At V^(1/2)w=0, stationarity allows both a robust-norm subgradient and
  // active-constraint normals: grad - A'lambda must be in range(V), with
  // sqrt((grad-A'lambda)'V^+(grad-A'lambda)) <= kappa.
  const gradient = hessian.map((row, i) => dot(row, x) + linear[i]);
  const { values, vectors } = symmetricEigen(uncertainty);
  const scale = Math.max(0, ...uncertainty.flat().map(Math.abs));
  const eigenTolerance = Math.max(Number.MIN_VALUE, scale * Number.EPSILON * n * 32);
  const positive = Array.from({ length: n }, (_, j) => j).filter((j) => values[j] > eigenTolerance);
  const nullspace = Array.from({ length: n }, (_, j) => j).filter((j) => values[j] <= eigenTolerance);
  const eigenCoordinate = (vector: number[], j: number) =>
    vectors.reduce((sum, row, i) => sum + row[j] * vector[i], 0);
  const inverseImage = (vector: number[]) => {
    const output = Array(n).fill(0);
    for (const j of positive) {
      const coordinate = eigenCoordinate(vector, j) / values[j];
      for (let i = 0; i < n; i++) output[i] += vectors[i][j] * coordinate;
    }
    return output;
  };

  const active = constraints.flatMap((constraint) => {
    const value = dot(constraint.coefficients, x);
    const normals: Array<{ vector: number[]; equality: boolean }> = [];
    if (constraint.lower !== undefined && constraint.upper !== undefined &&
      Math.abs(constraint.upper - constraint.lower) <= 1e-12 &&
      Math.abs(value - constraint.lower) <= 2e-7)
      normals.push({ vector: constraint.coefficients, equality: true });
    else {
      if (constraint.lower !== undefined && Math.abs(value - constraint.lower) <= 2e-7)
        normals.push({ vector: constraint.coefficients, equality: false });
      if (constraint.upper !== undefined && Math.abs(value - constraint.upper) <= 2e-7)
        normals.push({ vector: constraint.coefficients.map((coefficient) => -coefficient), equality: false });
    }
    return normals;
  });
  const measure = (normalSet: typeof active, multipliers: number[]) => {
    const residual = gradient.map((value, i) => value - normalSet.reduce((sum, item, j) =>
      sum + item.vector[i] * multipliers[j], 0));
    const candidateResidual = residual.slice(0, n);
    let dualSquared = 0;
    const reconstruction = Array(n).fill(0);
    for (const j of positive) {
      const coordinate = eigenCoordinate(candidateResidual, j);
      dualSquared += coordinate * coordinate / values[j];
      for (let i = 0; i < n; i++) reconstruction[i] += vectors[i][j] * coordinate;
    }
    const rangeResidual = Math.sqrt(candidateResidual.reduce((sum, value, i) =>
      sum + (value - reconstruction[i]) ** 2, 0));
    const auxiliaryResidual = Math.sqrt(dot(residual.slice(n), residual.slice(n)));
    const gradientScale = Math.max(1, Math.sqrt(dot(gradient, gradient)));
    return {
      gradientResidual: Math.max(rangeResidual, auxiliaryResidual) / gradientScale,
      dualNorm: Math.sqrt(Math.max(0, dualSquared)),
    };
  };
  const acceptable = (candidate: { gradientResidual: number; dualNorm: number }) =>
    candidate.gradientResidual <= 1e-9 &&
    candidate.dualNorm <= kappa + 1e-10 * Math.max(1, kappa);
  const direct = measure([], []);
  if (acceptable(direct)) return { violation, ...direct };

  const solveForActive = (normalSet: typeof active): number[] | null => {
    if (!normalSet.length) return [];
    const candidateNormals = normalSet.map((item) => item.vector.slice(0, n));
    const inverseGradient = inverseImage(gradient.slice(0, n));
    const metric = candidateNormals.map((left) => candidateNormals.map((right) =>
      dot(left, inverseImage(right))));
    const objectiveLinear = candidateNormals.map((normal) => -dot(normal, inverseGradient));
    const qpConstraints: RobustLinearConstraint[] = normalSet.flatMap((item, j) =>
      item.equality ? [] : [{ name: `active_normal_nonnegative:${j}`,
        coefficients: normalSet.map((_, k) => j === k ? 1 : 0), lower: 0 }]);
    const equations: Array<{ coefficients: number[]; rhs: number }> = [];
    for (const j of nullspace) {
      const normal = vectors.map((row) => row[j]);
      equations.push({ coefficients: normalSet.map((item) => dot(normal, item.vector.slice(0, n))),
        rhs: dot(normal, gradient.slice(0, n)) });
    }
    for (let i = n; i < gradient.length; i++)
      equations.push({ coefficients: normalSet.map((item) => item.vector[i]), rhs: gradient[i] });
    const basis: Array<{ vector: number[]; rhs: number }> = [];
    for (const equation of equations) {
      let row = equation.coefficients.slice(), rhs = equation.rhs;
      for (const item of basis) {
        const projection = dot(row, item.vector);
        row = row.map((value, i) => value - projection * item.vector[i]);
        rhs -= projection * item.rhs;
      }
      const norm = Math.sqrt(dot(row, row));
      if (norm <= 1e-10) {
        if (Math.abs(rhs) > 1e-9 * Math.max(1, Math.abs(equation.rhs))) return null;
        continue;
      }
      basis.push({ vector: row.map((value) => value / norm), rhs: rhs / norm });
    }
    for (const [index, equation] of basis.entries())
      qpConstraints.push({ name: `nullspace_stationarity:${index}`,
        coefficients: equation.vector, lower: equation.rhs, upper: equation.rhs });
    try {
      return qp(metric, objectiveLinear, qpConstraints).x;
    } catch {
      return null;
    }
  };

  // First certify using active normals that do not touch auxiliary variables.
  // This avoids degeneracy from redundant D2 absolute-value epigraph normals
  // when their optimal multipliers are zero; the full joint system is still
  // attempted if that simpler valid certificate is insufficient.
  const candidateOnly = active.filter((item) => item.vector.slice(n).every((value) => Math.abs(value) <= 1e-14));
  const uniqueCandidateNormals = candidateOnly.filter((item, index) =>
    candidateOnly.findIndex((other) => other.equality === item.equality &&
      other.vector.every((value, i) => Math.abs(value - item.vector[i]) <= 1e-12)) === index);
  const candidateMultipliers = solveForActive(uniqueCandidateNormals);
  if (candidateMultipliers) {
    const candidate = measure(uniqueCandidateNormals, candidateMultipliers);
    if (acceptable(candidate)) return { violation, ...candidate };
  }
  const jointMultipliers = solveForActive(active);
  if (jointMultipliers) {
    const joint = measure(active, jointMultipliers);
    if (acceptable(joint)) return { violation, ...joint };
  }
  return null;
}

/**
 * Solve 0.5 x'Hx + c'x + kappa*sqrt(w'Vw), where w is the first n
 * coordinates and all remaining variables are the caller's existing auxiliaries.
 * The final acceptance diagnostics are computed against the exact square-root
 * objective, not the QP surrogate.
 */
export function solveRobustMeanUncertainty(
  hessian: number[][],
  linear: number[],
  uncertainty: number[][],
  constraints: RobustLinearConstraint[],
  kappa: number,
  variableCount: number,
): RobustSolveOutput {
  const n = uncertainty.length;
  const solveAt = (lambda: number) => {
    const matrix = hessian.map((row, i) => row.map((value, j) =>
      value + (i < n && j < n ? lambda * uncertainty[i][j] : 0)));
    return qp(matrix, linear, constraints);
  };
  const nominal = solveAt(0);
  const zeroUncertainty = uncertainty.every((row) => row.every((value) => value === 0));
  let best = nominal, lambda = 0, iterations = nominal.iterations;
  if (kappa > 0 && !zeroUncertainty) {
    const { values, vectors } = symmetricEigen(uncertainty);
    const eigenScale = Math.max(0, ...uncertainty.flat().map(Math.abs));
    const eigenTolerance = Math.max(Number.MIN_VALUE, eigenScale * Number.EPSILON * n * 32);
    if (values.some((value) => value < -eigenTolerance))
      throw new Error("Forecast mean-uncertainty covariance is not positive semidefinite.");
    const nullObjectiveConstraints = values.flatMap((value, j) => value > eigenTolerance ? [{
      name: `robust-nullspace:${j}`,
      coefficients: [...vectors.map((row) => row[j]), ...Array(variableCount - n).fill(0)],
      lower: 0, upper: 0,
    }] : []);
    try {
      const nullCandidate = nullObjectiveConstraints.length
        ? qp(hessian, linear, [...constraints, ...nullObjectiveConstraints])
        : nominal;
      const nullCertificate = zeroRiskDualCertificate(nullCandidate.x, hessian, linear,
        uncertainty, constraints, kappa, n);
      if (nullCertificate) {
        const objectiveTotal = 0.5 * quadratic(nullCandidate.x, hessian) + dot(linear, nullCandidate.x);
        return { solution: nullCandidate.x, nominalSolution: nominal.x, robustHaircut: 0,
          objectiveTotal, lambda: 0, iterations: nominal.iterations + nullCandidate.iterations,
          primalResidual: nullCertificate.violation, stationarityResidual: nullCertificate.gradientResidual };
      }
    } catch {
      // The zero-risk face may be infeasible; continue to the positive-risk root.
    }
    const nominalMuVariance = Math.max(0, quadratic(nominal.x.slice(0, n), uncertainty));
    let low = 0;
    let high = nominalMuVariance > 0 ? kappa / Math.sqrt(nominalMuVariance) : 1;
    if (!Number.isFinite(high) || high <= 0) high = 1;
    let highSolve = solveAt(high);
    iterations += highSolve.iterations;
    const equation = (at: number, x: number[]) =>
      at * Math.sqrt(Math.max(0, quadratic(x.slice(0, n), uncertainty))) / kappa - 1;
    let highValue = equation(high, highSolve.x);
    for (let bracket = 0; highValue < 0 && bracket < 100; bracket++) {
      const highWeights = highSolve.x.slice(0, n);
      const highRiskVariance = Math.max(0, quadratic(highWeights, uncertainty));
      const highWeightNormSquared = dot(highWeights, highWeights);
      if (highRiskVariance <= Math.max(Number.MIN_VALUE,
        Math.max(0, ...uncertainty.flat().map(Math.abs)) * highWeightNormSquared * 1e-24)) {
        const certificate = zeroRiskDualCertificate(highSolve.x, hessian, linear, uncertainty,
          constraints, kappa, n);
        if (certificate) {
          const objectiveTotal = 0.5 * quadratic(highSolve.x, hessian) + dot(linear, highSolve.x);
          return { solution: highSolve.x, nominalSolution: nominal.x, robustHaircut: 0, objectiveTotal,
            lambda: high, iterations, primalResidual: certificate.violation,
            stationarityResidual: certificate.gradientResidual };
        }
        // A high-penalty QP can enter the nullspace before the exact robust
        // multiplier root. Search downward for the first positive root crossing
        // instead of mistaking that surrogate null solution for the robust optimum.
        let positive: { lambda: number; solve: ReturnType<typeof solveAt> } | null = null;
        const lowerEdge = low;
        let negativeEdge = lowerEdge;
        if (lowerEdge > 0) {
          for (let step = 1; step <= 256; step++) {
            const probe = lowerEdge + (high - lowerEdge) * step / 256;
            const probeSolve = solveAt(probe);
            iterations += probeSolve.iterations;
            const probeValue = equation(probe, probeSolve.x);
            if (probeValue > 0) {
              low = negativeEdge;
              high = probe;
              highSolve = probeSolve;
              highValue = probeValue;
              positive = { lambda: probe, solve: probeSolve };
              break;
            }
            negativeEdge = probe;
          }
        }
        if (!positive) {
          let probe = (lowerEdge > 0 ? lowerEdge : high) * 0.8;
          for (let step = 0; step < 256 && probe > 0; step++, probe *= 0.8) {
            const probeSolve = solveAt(probe);
            iterations += probeSolve.iterations;
            const probeValue = equation(probe, probeSolve.x);
            if (probeValue > 0) {
              positive = { lambda: probe, solve: probeSolve };
              break;
            }
          }
        }
        if (positive && highValue < 0) {
          let probe = positive.lambda * 0.8;
          for (let step = 0; step < 256 && probe > 0; step++, probe *= 0.8) {
            const probeSolve = solveAt(probe);
            iterations += probeSolve.iterations;
            if (equation(probe, probeSolve.x) <= 0) {
              low = probe;
              high = positive.lambda;
              highSolve = positive.solve;
              highValue = equation(high, highSolve.x);
              break;
            }
          }
        }
        if (!positive || highValue < 0)
          throw new Error("Robust optimum reached the nullspace of V_mu but failed the independent dual-norm subgradient certificate, and no positive-risk multiplier root was found below it.");
        break;
      }
      low = high;
      high *= 2;
      if (!Number.isFinite(high)) break;
      highSolve = solveAt(high);
      iterations += highSolve.iterations;
      highValue = equation(high, highSolve.x);
      if (!Number.isFinite(highValue)) throw new Error("Robust multiplier bracket became nonfinite.");
    }
    if (highValue < 0)
      throw new Error("Could not bracket exact robust square-root KKT multiplier.");
    best = highSolve;
    lambda = high;
    for (let step = 0; step < 120; step++) {
      lambda = (low + high) / 2;
      best = solveAt(lambda);
      iterations += best.iterations;
      const value = equation(lambda, best.x);
      if (value > 0) high = lambda;
      else low = lambda;
      if (Math.abs(value) <= 1e-12 ||
        high - low <= 1e-12 * Math.max(Number.MIN_VALUE, Math.abs(lambda))) break;
    }
  }
  const x = best.x;
  const varianceMu = Math.max(0, quadratic(x.slice(0, n), uncertainty));
  const robustHaircut = kappa * Math.sqrt(varianceMu);
  const objectiveTotal = 0.5 * quadratic(x, hessian) + dot(linear, x) + robustHaircut;
  const violation = maxViolation(x, constraints);
  const rootResidual = kappa === 0 || zeroUncertainty ? 0 :
    Math.abs(lambda * Math.sqrt(varianceMu) / kappa - 1);
  // Independent first-order residual including the analytic square-root
  // gradient and active linear-constraint normals.
  const gradient = hessian.map((row, i) => dot(row, x) + linear[i] +
    (i < n && varianceMu > 0
      ? kappa * uncertainty[i].reduce((sum, value, j) => sum + value * x[j], 0) / Math.sqrt(varianceMu)
      : 0));
  const active = constraints.flatMap((constraint) => {
    const value = dot(constraint.coefficients, x);
    const normals: Array<{ vector: number[]; equality: boolean }> = [];
    if (constraint.lower !== undefined && constraint.upper !== undefined &&
      Math.abs(constraint.upper - constraint.lower) <= 1e-12 &&
      Math.abs(value - constraint.lower) <= 2e-7)
      normals.push({ vector: constraint.coefficients, equality: true });
    else {
      if (constraint.lower !== undefined && Math.abs(value - constraint.lower) <= 2e-7)
        normals.push({ vector: constraint.coefficients, equality: false });
      if (constraint.upper !== undefined && Math.abs(value - constraint.upper) <= 2e-7)
        normals.push({ vector: constraint.coefficients.map((value) => -value), equality: false });
    }
    return normals;
  });
  const multipliers = active.map(() => 0);
  const lipschitz = Math.max(1e-20, active.reduce((sum, item) => sum + dot(item.vector, item.vector), 0));
  for (let step = 0; step < 30000; step++) {
    let movement = 0;
    for (let j = 0; j < active.length; j++) {
      const residual = gradient.map((value, i) => value - active.reduce((sum, item, k) =>
        sum + item.vector[i] * multipliers[k], 0));
      const nextRaw = multipliers[j] + dot(active[j].vector, residual) / lipschitz;
      const next = active[j].equality ? nextRaw : Math.max(0, nextRaw);
      movement = Math.max(movement, Math.abs(next - multipliers[j]));
      multipliers[j] = next;
    }
    if (movement < 1e-14) break;
  }
  const residual = gradient.map((value, i) => value - active.reduce((sum, item, j) =>
    sum + item.vector[i] * multipliers[j], 0));
  const scaledResidual = Math.sqrt(dot(residual, residual)) /
    Math.max(1e-12, Math.sqrt(dot(gradient, gradient)), ...hessian.map((row) => Math.sqrt(dot(row, row))));
  const stationarityResidual = Math.max(scaledResidual, rootResidual);
  if (violation > 1e-8)
    throw new Error(`Independent robust feasibility residual ${violation} exceeds 1e-8.`);
  if (!Number.isFinite(stationarityResidual) || stationarityResidual > 1e-8)
    throw new Error(`Independent exact robust KKT residual ${stationarityResidual} exceeds 1e-8.`);
  if (x.length !== variableCount) throw new Error("Robust solver returned an invalid decision dimension.");
  return { solution: x, nominalSolution: nominal.x, robustHaircut, objectiveTotal, lambda,
    iterations, primalResidual: violation, stationarityResidual };
}