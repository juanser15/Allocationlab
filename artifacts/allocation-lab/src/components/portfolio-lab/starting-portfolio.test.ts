import assert from "node:assert/strict";
import test from "node:test";
import {
  applyStartingPortfolioSelection,
  loadSavedActualBook,
  makeCashOnlyBook,
  startingPortfolioMode,
  type StartingPortfolioContext,
} from "./starting-portfolio.ts";

const context: StartingPortfolioContext = {
  informationCutoff: "2025-01-31",
  lambdaR: 0.25,
  holdings: { asOf: "2025-01-31", quantities: { SPY: 2 }, cash: 10, nav: 100 },
  objectiveType: "regularized_mean_variance",
  allocationMode: "CAPITAL_LONG_ONLY",
  nav: 250,
};

test("undefined selection inherits configured B2 settings without emitting an override", () => {
  const request = {
    rebalanceRegularization: { lambdaR: 0.25, holdings: context.holdings },
    objective: { type: "regularized_mean_variance" },
    constraints: { cashMin: 0.1 },
  };
  assert.equal(startingPortfolioMode(undefined, context), "manual");
  assert.equal(applyStartingPortfolioSelection(request, undefined, context), request);
  assert.equal(startingPortfolioMode(undefined, { ...context, lambdaR: 0 }), "ignore");
});

test("explicit Ignore omits only this run's rebalance regularization", () => {
  const request = {
    rebalanceRegularization: { lambdaR: 0.25, holdings: context.holdings },
    objective: { type: "regularized_mean_variance" },
    constraints: { cashMin: 0.1 },
  };
  const ignored = applyStartingPortfolioSelection(request, { mode: "ignore" }, context);
  assert.deepEqual(ignored, { objective: request.objective, constraints: request.constraints });
  assert.deepEqual(request.rebalanceRegularization, { lambdaR: 0.25, holdings: context.holdings });
});

test("Ignore bypasses cached positive lambdaR objective/book validation and omits only the reference", () => {
  const request = {
    rebalanceRegularization: { lambdaR: 0.75, holdings: { stale: true } as any },
    objective: { type: "minimum_variance" },
    constraints: { cashMin: 0.1 },
    covarianceDiagonalShrinkage: 0.4,
  };
  const ignored = applyStartingPortfolioSelection(request, { mode: "ignore" }, {
    ...context,
    lambdaR: 0.75,
    objectiveType: "minimum_variance",
    holdings: undefined,
  });

  assert.deepEqual(ignored, {
    objective: request.objective,
    constraints: request.constraints,
    covarianceDiagonalShrinkage: 0.4,
  });
  assert.equal(request.rebalanceRegularization.lambdaR, 0.75);
});

test("explicit non-Ignore mode validates its actual book even when lambdaR is zero", () => {
  const noReference = { objective: { type: "minimum_variance" }, rebalanceRegularization: { lambdaR: 0 } };
  const zeroLambdaContext = { ...context, lambdaR: 0, objectiveType: "minimum_variance" };
  assert.throws(() => applyStartingPortfolioSelection(
    noReference,
    { mode: "manual", holdings: { asOf: context.informationCutoff } as any },
    zeroLambdaContext,
  ), /Actual quantities must map/);

  const explicitZero = applyStartingPortfolioSelection(
    noReference,
    { mode: "manual", holdings: context.holdings },
    zeroLambdaContext,
  );
  assert.deepEqual(explicitZero.rebalanceRegularization, {
    lambdaR: 0,
    holdings: context.holdings,
  });
});

test("Cash only is an explicit actual book and differs from inherited settings", () => {
  assert.deepEqual(makeCashOnlyBook(context), {
    asOf: "2025-01-31", quantities: {}, cash: 250, nav: 250,
  });
  assert.deepEqual(makeCashOnlyBook({ ...context, nav: undefined }), {
    asOf: "2025-01-31", quantities: {}, cash: 100, nav: 100,
  });
  const request = { objective: { type: "regularized_mean_variance" } };
  const cashOnly = applyStartingPortfolioSelection(request, { mode: "cash_only" }, context);
  assert.deepEqual(cashOnly.rebalanceRegularization, {
    lambdaR: 0.25,
    holdings: { asOf: "2025-01-31", quantities: {}, cash: 250, nav: 250 },
  });
});

test("saved target-only rows are unavailable; only persisted actual holdings with exact cutoff load", () => {
  const targetOnly = loadSavedActualBook({
    id: 44,
    request: { targetWeights: { SPY: 0.8, CASH: 0.2 } },
  }, context.informationCutoff, false);
  assert.equal(targetOnly.book, undefined);
  assert.match(targetOnly.error ?? "", /target allocation is not an actual book/);

  const exact = loadSavedActualBook({
    id: 45,
    request: { rebalanceRegularization: { lambdaR: 0.5, holdings: context.holdings } },
  }, context.informationCutoff, false);
  assert.deepEqual(exact.book, context.holdings);

  const stale = loadSavedActualBook({
    request: { rebalanceRegularization: { holdings: { ...context.holdings, asOf: "2025-01-30" } } },
  }, context.informationCutoff, false);
  assert.equal(stale.book, undefined);
  assert.match(stale.error ?? "", /exactly match/);
});

test("signed cash and quantities are accepted only for the signed overlay mode", () => {
  const signedBook = { asOf: context.informationCutoff, quantities: { SPY: -2 }, cash: -10, nav: 100 };
  assert.equal(loadSavedActualBook({
    request: { rebalanceRegularization: { holdings: signedBook } },
  }, context.informationCutoff, false).book, undefined);
  assert.deepEqual(loadSavedActualBook({
    request: { rebalanceRegularization: { holdings: signedBook } },
  }, context.informationCutoff, true).book, signedBook);
});

test("positive lambdaR cannot be applied with a different objective", () => {
  assert.throws(() => applyStartingPortfolioSelection(
    {},
    { mode: "current", holdings: context.holdings },
    { ...context, objectiveType: "mean_variance" },
  ), /regularized_mean_variance/);
});