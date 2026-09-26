import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateForecast,
  portfolioForecastUncertainty,
  type ForecastInput,
} from "./forecast-d3";

const ids = ["A", "B"];
const sigma = [[4, 1], [1, 9]];
const dates = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"];
const rows = [[1, 2], [3, 4], [5, 6], [7, 8]];
const cutoff = "2024-01-10";
const tol = 1e-8;

function close(actual: number, expected: number, tolerance = tol) {
  assert.ok(Number.isFinite(actual), `expected finite result; got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

function request(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return {
    candidateIds: ids, returns: rows, dates, sigma, dailyCashYield: 0.001,
    mode: "CAPITAL_LONG_ONLY", config: { type: "SAMPLE_MEAN" }, decisionCutoff: cutoff,
    ...overrides,
  };
}

function ok(input: ForecastInput) {
  const result = estimateForecast(input);
  assert.equal(result.status, "OK", result.reason);
  return result;
}

test("D3 T1 — sample mean and Sigma/T uncertainty", () => {
  const result = ok(request());
  assert.deepEqual(result.sampleMeans, [4, 5]);
  assert.equal(result.observationCount, 4);
  assert.equal(result.startDate, dates[0]);
  assert.equal(result.endDate, dates.at(-1));
  assert.deepEqual(result.V_mu, [[1, 0.25], [0.25, 2.25]]);
  close(result.standardErrors[0], 1);
  close(result.standardErrors[1], 1.5);
});

test("D3 covariance validation accepts a correlated three-candidate positive-definite matrix", () => {
  // L Lᵀ for L = [[1,0,0],[0.7,1.1,0],[0.5,-0.2,0.8]]:
  // the nonzero triangular pivots independently establish strict positive definiteness.
  const correlated = [[1, 0.7, 0.5], [0.7, 1.7, 0.13], [0.5, 0.13, 0.93]];
  const input = request({
    candidateIds: ["A", "B", "C"],
    returns: rows.map((row) => [...row, row[0] - row[1]]),
    sigma: correlated,
  });
  const result = ok(input);
  close(result.V_mu[1][2], 0.13 / 4);
  const bayesian = ok({
    ...input,
    config: {
      type: "BAYESIAN_VIEWS",
      priorMean: { source: "SAMPLE_PRIOR" },
      priorUncertainty: { type: "USER_DEFINED", candidateIds: ["A", "B", "C"], matrix: correlated },
      views: [{
        type: "ABSOLUTE", candidateId: "A", q: 0.3, variance: 0.5,
        effectiveTimestamp: "2024-01-01", availabilityTimestamp: "2024-01-02",
      }],
    },
  });
  assert.equal(bayesian.status, "OK");
  assert.ok(bayesian.V_mu.every((row) => row.every(Number.isFinite)));
  const unordered = estimateForecast({
    ...input, config: {
      type: "BAYESIAN_VIEWS", priorUncertainty: { type: "USER_DEFINED", matrix: correlated },
      views: [{
        type: "ABSOLUTE", candidateId: "A", q: 0.3, variance: 0.5,
        effectiveTimestamp: "2024-01-01", availabilityTimestamp: "2024-01-02",
      }],
    },
  });
  assert.equal(unordered.status, "INVALID_FORECAST_MODEL");
  assert.match(unordered.reason ?? "", /candidate ordering/);
});

test("D3 T2 — deterministic linear shrinkage, including zero and full shrinkage", () => {
  const config = {
    type: "SHRUNK_MEAN" as const, shrinkage: 0.25,
    shrinkagePrior: { source: "USER_DEFINED" as const, values: { A: 2, B: 10 } },
  };
  const result = ok(request({ config }));
  close(result.muHat[0], 3.5);
  close(result.muHat[1], 6.25);
  assert.deepEqual(result.priorMean, [2, 10]);
  assert.deepEqual(result.V_mu, [[0.5625, 0.140625], [0.140625, 1.265625]]);
  const noShrinkage = ok(request({ config: { ...config, shrinkage: 0 } }));
  assert.deepEqual(noShrinkage.muHat, [4, 5]);
  assert.deepEqual(noShrinkage.V_mu, [[1, 0.25], [0.25, 2.25]]);
  const fullShrinkage = ok(request({ config: { ...config, shrinkage: 1 } }));
  assert.deepEqual(fullShrinkage.muHat, [2, 10]);
  assert.deepEqual(fullShrinkage.V_mu, [[0, 0], [0, 0]]);
  assert.equal(fullShrinkage.signalToNoise[0], null);
  assert.match(fullShrinkage.uncertaintyAssumption, /not certainty/);
});

test("D3 T3 — analytic Gaussian update for one absolute view", () => {
  const result = ok(request({
    config: {
      type: "BAYESIAN_VIEWS",
      priorMean: { source: "USER_DEFINED_PRIOR", values: { A: 1, B: 2 } },
      priorUncertainty: { type: "USER_DEFINED", matrix: [[4, 0], [0, 9]], candidateIds: ids },
      views: [{
        type: "ABSOLUTE", candidateId: "A", q: 5, variance: 1,
        effectiveTimestamp: "2024-01-01", availabilityTimestamp: "2024-01-02",
      }],
    },
  }));
  close(result.muHat[0], 4.2);
  close(result.muHat[1], 2);
  close(result.V_mu[0][0], 0.8);
  close(result.V_mu[1][1], 9);
  close(result.V_mu[0][1], 0);
  assert.deepEqual(result.P, [[1, 0]]);
  assert.deepEqual(result.q, [5]);
  assert.deepEqual(result.Omega, [[1]]);
  assert.equal(result.viewSetStatus, "AVAILABLE");
});

test("D3 T4 — analytic independent relative and absolute view updates", () => {
  const result = ok(request({
    candidateIds: ["A", "B", "C"],
    returns: rows.map((row) => [...row, row[0] - row[1]]),
    sigma: [[4, 0, 0], [0, 9, 0], [0, 0, 16]],
    config: {
      type: "BAYESIAN_VIEWS",
      priorMean: { source: "USER_DEFINED_PRIOR", values: { A: 0, B: 0, C: 0 } },
      priorUncertainty: {
        type: "USER_DEFINED", matrix: [[4, 0, 0], [0, 9, 0], [0, 0, 16]],
        candidateIds: ["A", "B", "C"],
      },
      views: [
        {
          type: "RELATIVE", candidateId: "A", relativeCandidateId: "B", q: 2, variance: 1,
          effectiveTimestamp: "2024-01-01", availabilityTimestamp: "2024-01-02",
        },
        {
          type: "ABSOLUTE", candidateId: "C", q: -1, variance: 4,
          effectiveTimestamp: "2024-01-01", availabilityTimestamp: "2024-01-02",
        },
      ],
    },
  }));
  close(result.muHat[0], 4 / 7);
  close(result.muHat[1], -9 / 7);
  close(result.muHat[2], -0.8);
  close(result.V_mu[0][0], 20 / 7);
  close(result.V_mu[0][1], 18 / 7);
  close(result.V_mu[1][0], 18 / 7);
  close(result.V_mu[1][1], 45 / 14);
  close(result.V_mu[2][2], 3.2);
  assert.deepEqual(result.P, [[1, -1, 0], [0, 0, 1]]);
});

test("D3 T5 — sample SE scales as 1/sqrt(T), portfolio forecast SE is w'V_mu w", () => {
  const shortRows = rows;
  const longRows = [...rows, ...rows];
  const longDates = [...dates, "2024-01-05", "2024-01-06", "2024-01-07", "2024-01-08"];
  const short = ok(request());
  const long = ok(request({ returns: longRows, dates: longDates }));
  close(long.standardErrors[0] / short.standardErrors[0], 1 / Math.sqrt(2));
  close(long.standardErrors[1] / short.standardErrors[1], 1 / Math.sqrt(2));
  const portfolio = portfolioForecastUncertainty(short, [0.5, 0.5]);
  assert.ok(!("status" in portfolio));
  close(portfolio.expectedReturn, 4.5);
  close(portfolio.varianceOfExpectedReturn, 0.9375);
  close(portfolio.standardError, Math.sqrt(0.9375));
});

test("historical Bayesian forecast marks views unavailable until point-in-time eligible", () => {
  const base = request({
    config: {
      type: "BAYESIAN_VIEWS",
      priorMean: { source: "SAMPLE_PRIOR" },
      priorUncertainty: { type: "USER_DEFINED", matrix: [[4, 0], [0, 9]], candidateIds: ids },
      views: [{
        type: "ABSOLUTE", candidateId: "A", q: 9, variance: 1,
        effectiveTimestamp: "2024-01-01", availabilityTimestamp: "2024-02-01",
      }],
    },
  });
  const result = estimateForecast(base);
  assert.equal(result.status, "HISTORICAL_FORECAST_UNAVAILABLE", result.reason);
  assert.equal(result.status, "HISTORICAL_FORECAST_UNAVAILABLE");
  assert.equal(result.viewSetStatus, "UNAVAILABLE_NO_ELIGIBLE_VIEWS");
  assert.equal(result.views.length, 1);
  assert.equal(result.views[0].status, "NOT_YET_AVAILABLE");
  assert.equal(result.views[0].availabilityTimestamp, "2024-02-01");
  assert.deepEqual(result.muHat, result.sampleMeans);
});

test("singular PSD prior covariance is supported without ridge regularization", () => {
  const result = estimateForecast(request({
    config: {
      type: "BAYESIAN_VIEWS",
      priorMean: { source: "USER_DEFINED_PRIOR", values: { A: 0, B: 0 } },
      priorUncertainty: { type: "USER_DEFINED", matrix: [[1, 1], [1, 1]], candidateIds: ids },
      views: [{
        type: "ABSOLUTE", candidateId: "A", q: 1, variance: 1,
        effectiveTimestamp: "2024-01-01", availabilityTimestamp: "2024-01-01",
      }],
    },
  }));
  assert.equal(result.status, "OK", result.reason);
  close(result.muHat[0], 0.5);
  close(result.muHat[1], 0.5);
  close(result.V_mu[0][0], 0.5);
  close(result.V_mu[1][1], 0.5);
  close(result.V_mu[0][1], 0.5);
});