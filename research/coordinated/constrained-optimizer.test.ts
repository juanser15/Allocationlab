/** SOURCE-ONLY MATHEMATICAL FIXTURES. No private historical dataset is consumed. */
import test from "node:test";
import assert from "node:assert/strict";
import { optimize, quadratic, ResearchError } from "./models";
import {
  SUPPORT_SEARCH_LIMIT,
  compositeOptimalityGap,
} from "./constrained-optimizer";
import {
  SUPPORT_TOLERANCE,
  CONSTRAINT_TOLERANCE,
} from "../../artifacts/api-server/src/lib/workbench/portfolio-numerics";
const options = {
  cap: 1,
  maxWeight: 0.3,
  riskAversion: 2,
  cost: 0.001,
  horizon: 1 / 12,
  volatility: null as number | null,
};
const diagonal = (n: number, v = 0.04) =>
  Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? v : 0)),
  );
function audited(
  n: number,
  minimum: number,
  maximum: number,
  floor: number,
  extra = {},
) {
  const o = {
    ...options,
    ...extra,
    mandate: {
      minimum_positions: minimum,
      maximum_positions: maximum,
      minimum_weight: floor,
    },
  };
  const result = optimize(
    Array.from({ length: n }, (_, i) => 0.08 + i * 0.001),
    diagonal(n),
    Array(n).fill(0),
    o,
  );
  const positive = result.weights.filter((w) => w > SUPPORT_TOLERANCE);
  assert.ok(positive.length >= minimum && positive.length <= maximum);
  assert.ok(
    positive.every(
      (w) =>
        w >= floor - CONSTRAINT_TOLERANCE &&
        w <= o.maxWeight + CONSTRAINT_TOLERANCE,
    ),
  );
  assert.ok(result.exposure <= o.cap + CONSTRAINT_TOLERANCE);
  assert.ok(
    "audit" in result &&
      result.audit.support_search.evaluated <= SUPPORT_SEARCH_LIMIT,
  );
  return result;
}
test("Original failure: 11+ eligible assets and maximum ten never publishes eleven holdings", () => {
  const a = audited(14, 1, 10, 0.03),
    b = audited(14, 1, 10, 0.03);
  assert.deepEqual(a, b);
  assert.ok(a.weights.filter((w) => w > SUPPORT_TOLERANCE).length <= 10);
});
test("Original failure: 3% floor is enforced inside each support solve", () => {
  const result = optimize([0.15, 0.001, 0.0001], diagonal(3), [0, 0, 0], {
    ...options,
    mandate: {
      minimum_positions: 2,
      maximum_positions: 3,
      minimum_weight: 0.03,
    },
  });
  const active = result.weights.filter((w) => w > SUPPORT_TOLERANCE);
  assert.equal(active.length, 2);
  assert.ok(active.every((w) => w >= 0.03));
  assert.ok(active.some((w) => w === 0.03));
});
test("Known-answer fixed support respects retained-trade L1 kink and NAV floors", () => {
  const a = optimize([0.04], [[0.04]], [0.1], {
    ...options,
    cap: 1,
    maxWeight: 1,
    riskAversion: 2,
    horizon: 1,
    cost: 0.01,
    mandate: {
      minimum_positions: 1,
      maximum_positions: 1,
      minimum_weight: 0.03,
    },
  });
  assert.ok(Math.abs(a.weights[0] - 0.375) < 1e-9); // mu - 2*var*w - cost = 0
  const b = optimize([0.04], [[0.04]], [0.1], {
    ...options,
    cap: 1,
    maxWeight: 1,
    riskAversion: 2,
    horizon: 1,
    cost: 0.1,
    mandate: {
      minimum_positions: 1,
      maximum_positions: 1,
      minimum_weight: 0.03,
    },
  });
  assert.equal(b.weights[0], 0.1);
});
test("Exposure stays a ceiling: a valid mandate need not consume its entire budget", () => {
  const a = optimize([0.01, 0.01], diagonal(2), [0, 0], {
    ...options,
    cost: 0,
    mandate: {
      minimum_positions: 1,
      maximum_positions: 1,
      minimum_weight: 0.03,
    },
  });
  assert.ok(a.exposure < 0.3);
  assert.ok(a.cash > 0.7);
});
test("Cardinality/floor combinations remain jointly feasible across deterministic fixtures", () => {
  for (let n = 2; n <= 9; n++)
    for (const [lo, hi] of [
      [1, n],
      [2, 2],
      [2, Math.min(4, n)],
    ])
      audited(n, lo, hi, 0.03, { cap: 0.65 });
});
test("Analytic impossible holdings budget is rejected before solving", () => {
  assert.throws(
    () => audited(5, 4, 5, 0.03, { cap: 0.09 }),
    (e) => e instanceof ResearchError && e.code === "PORTFOLIO_CONSTRAINT",
  );
});
test("Explicit zero exposure is all cash despite minimum holdings", () => {
  const a = optimize([0.1, 0.2], diagonal(2), [0.2, 0.3], {
    ...options,
    cap: 0,
    mandate: {
      minimum_positions: 2,
      maximum_positions: 2,
      minimum_weight: 0.03,
    },
  });
  assert.deepEqual(a.weights, [0, 0]);
  assert.equal(a.cash, 1);
  assert.equal(a.audit?.status, "EXPLICIT_ALL_CASH");
  assert.equal(a.audit?.objective, 0.0005);
});
test("Excluded old positions are charged in support objective, not silently forgiven", () => {
  const a = optimize([0.08, 0.08], diagonal(2), [0, 0.3], {
    ...options,
    cost: 0.2,
    mandate: {
      minimum_positions: 1,
      maximum_positions: 1,
      minimum_weight: 0.03,
    },
  });
  assert.equal(a.weights[0], 0);
  assert.equal(a.weights[1], 0.3);
  const w = a.weights;
  const expected =
    0.5 * options.horizon * options.riskAversion * quadratic(w, diagonal(2)) -
    options.horizon * (0.08 * w[0] + 0.08 * w[1]) +
    0.2 * (Math.abs(w[0]) + Math.abs(w[1] - 0.3));
  assert.ok(Math.abs(a.audit!.objective - expected) < 1e-12);
});
test("Volatility binds within the support subproblem without breaking floors", () => {
  const a = audited(3, 2, 3, 0.03, {
    volatility: 0.06,
    maxWeight: 0.8,
    cost: 0,
  });
  assert.ok(a.volatility <= 0.06 + CONSTRAINT_TOLERANCE);
  assert.ok(a.risk_multiplier > 0);
  assert.ok(
    a.weights.filter((w) => w > SUPPORT_TOLERANCE).every((w) => w >= 0.03),
  );
});
test("Correlated risk floors produce an evidenced infeasible status, never scaled weights", () => {
  assert.throws(
    () => audited(2, 2, 2, 0.1, { volatility: 0.01 }),
    (e) =>
      e instanceof ResearchError &&
      e.code === "SOLVER_INFEASIBLE" &&
      e.details.proven_infeasible === true,
  );
});
test("Negative covariance diversification is considered rather than assuming the floor minimizes risk", () => {
  const covariance = [
    [0.04, -0.05],
    [-0.05, 0.09],
  ];
  const a = optimize([0.05, 0.05], covariance, [0, 0], {
    ...options,
    maxWeight: 1,
    cost: 0,
    volatility: 0.025,
    mandate: {
      minimum_positions: 2,
      maximum_positions: 2,
      minimum_weight: 0.1,
    },
  });
  assert.ok(a.volatility <= 0.025 + CONSTRAINT_TOLERANCE);
  assert.ok(a.weights.every((w) => w >= 0.1));
});
test("Invalid numeric inputs and indefinite covariance remain numerical failures", () => {
  for (const covariance of [
    [
      [0.04, 0.08],
      [0.08, 0.04],
    ],
    [
      [0.04, NaN],
      [NaN, 0.04],
    ],
  ])
    assert.throws(
      () =>
        optimize([0.1, 0.1], covariance, [0, 0], {
          ...options,
          mandate: {
            minimum_positions: 1,
            maximum_positions: 2,
            minimum_weight: 0.03,
          },
        }),
      (e) => e instanceof ResearchError && e.code === "NUMERICAL_FAILURE",
    );
});
test("No-mandate analytical golden is unchanged", () => {
  const a = optimize([0.04], [[0.04]], [0], {
    cap: 1,
    maxWeight: 1,
    riskAversion: 2,
    cost: 0,
    horizon: 1,
    volatility: null,
  });
  assert.equal(a.weights[0], 0.5);
  assert.equal(a.volatility, 0.1);
  assert.equal(a.cash, 0.5);
  assert.equal(a.iterations, 2);
  assert.ok(!("audit" in a));
});

test("A bounded search without a feasible support does not claim mathematical infeasibility", () => {
  assert.throws(
    () => audited(20, 2, 10, 0.03, { volatility: 0.001 }),
    (e) =>
      e instanceof ResearchError &&
      e.code === "NUMERICAL_FAILURE" &&
      e.details.proven_infeasible === false &&
      e.details.solver_status === "SEARCH_LIMIT",
  );
});
test("Zero economic floor still satisfies the single positive-support convention", () => {
  const a = optimize([-0.1, -0.2], diagonal(2), [0, 0], {
    ...options,
    cost: 0,
    mandate: { minimum_positions: 1, maximum_positions: 2, minimum_weight: 0 },
  });
  assert.equal(a.weights.filter((w) => w > SUPPORT_TOLERANCE).length, 1);
  assert.ok(a.audit!.effective_minimum_weight > SUPPORT_TOLERANCE);
});
test("Small exhaustive mathematical problem matches independently enumerated one-asset optima", () => {
  const mean = [0.02, 0.1, 0.05],
    covariance = diagonal(3),
    prior = [0, 0.1, 0.05];
  const o = {
    ...options,
    horizon: 1,
    cost: 0.003,
    mandate: {
      minimum_positions: 1,
      maximum_positions: 1,
      minimum_weight: 0.03,
    },
  };
  const candidates = mean
    .map((mu, j) => {
      // Independent scalar convex solution, including the full liquidation cost.
      const old = prior[j],
        raw = mu / (0.04 * o.riskAversion),
        delta = raw - old;
      const w = Math.max(
        0.03,
        Math.min(
          o.maxWeight,
          old +
            Math.sign(delta) *
              Math.max(0, Math.abs(delta) - o.cost / (0.04 * o.riskAversion)),
        ),
      );
      const objective =
        0.5 * o.riskAversion * 0.04 * w * w -
        mu * w +
        o.cost *
          (Math.abs(w - old) +
            prior.filter((_, i) => i !== j).reduce((a, b) => a + b, 0));
      return { j, w, objective };
    })
    .sort((a, b) => a.objective - b.objective);
  const result = optimize(mean, covariance, prior, o);
  assert.equal(result.audit!.selected_support[0], candidates[0].j);
  assert.ok(
    Math.abs(result.audit!.objective - candidates[0].objective) < 1e-12,
  );
  assert.ok(
    Math.abs(result.weights[candidates[0].j] - candidates[0].w) < 1e-12,
  );
});

test("Composite certificate solves L1 kink/ceiling linearization exactly", () => {
  const a = compositeOptimalityGap(
    [0.4, 0.1],
    [-0.3, 0.1],
    [0.2, 0.4],
    0.15,
    0.1,
    0.6,
    0.5,
  );
  assert.ok(Math.abs(a.linearized_minimum + 0.035) < 1e-12);
  assert.ok(a.gap < 1e-12);
  const b = compositeOptimalityGap(
    [0.1, 0.1],
    [-0.3, 0.1],
    [0.2, 0.4],
    0.15,
    0.1,
    0.6,
    0.5,
  );
  assert.ok(Math.abs(b.gap - 0.075) < 1e-12);
});
test("Correlated continuous support agrees with an independent analytical optimum", () => {
  const covariance = [
      [0.04, 0.039],
      [0.039, 0.04],
    ],
    expected = [0.1, 0.3];
  const mean = covariance.map(
    (row) => 2 * row.reduce((s, v, i) => s + v * expected[i], 0),
  );
  const a = optimize(mean, covariance, [0, 0], {
    ...options,
    horizon: 1,
    cost: 0,
    maxWeight: 0.8,
    mandate: {
      minimum_positions: 2,
      maximum_positions: 2,
      minimum_weight: 0.03,
    },
  });
  assert.ok(a.weights.every((w, i) => Math.abs(w - expected[i]) < 1e-7));
  assert.ok(
    a.audit!.residuals.composite_optimality_gap <=
      a.audit!.optimality_gap_tolerance,
  );
  assert.equal(a.audit!.residuals.volatility_dual_complementarity, 0);
});
test("Tiny steps caused by ill-conditioning cannot masquerade as convergence", () => {
  assert.throws(
    () =>
      optimize(
        [0, 0.001],
        [
          [1e10, 0],
          [0, 0.0001],
        ],
        [0, 0],
        {
          ...options,
          horizon: 1,
          cost: 0,
          maxWeight: 0.8,
          mandate: {
            minimum_positions: 2,
            maximum_positions: 2,
            minimum_weight: 0.03,
          },
        },
      ),
    (e) =>
      e instanceof ResearchError &&
      e.code === "NUMERICAL_FAILURE" &&
      (e.details.failures as any[]).some(
        (f) => f.reason === "CONTINUOUS_SUBPROBLEM_NOT_CONVERGED",
      ),
  );
});
