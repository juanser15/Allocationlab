/** Source-only HTTP integration. Uses the production router, parser, planner,
 * normalizer and financial engine. The injected store is in memory and rows
 * are explicitly synthetic. This does NOT certify PostgreSQL, process IPC,
 * private datasets or the deployed Replit application. */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createP0Router, type P0RouteService } from '../../artifacts/api-server/src/routes/workbench-p0';
import { createWorkbenchPreviewAccess } from '../../artifacts/api-server/src/lib/workbench/preview-access';
import { parseP0, planP0WithData, normalizeP0WithData, p0RunId, requestFromP0Spec } from '../../artifacts/api-server/src/lib/workbench/p0-calendar';
import { runInstitutional } from './institutional';
import { optimizerTestData, optimizerTestRequest } from './optimizer-test-fixtures';
import type { classify } from './engine';
import { CONSTRAINT_TOLERANCE } from '../../artifacts/api-server/src/lib/workbench/portfolio-numerics';

const controlled: typeof classify = (_model, history) => ({
  model: 'SYNTHETIC_SOURCE_TEST_SIGNAL',
  // Causal synthetic clock stress: calm, positive de-risking, and explicit cash.
  defensive_score: [0, .99, 1][(Date.parse(history.at(-1)!.date) / 86400000) % 3],
  high_risk_probability: null,
  label: 'SYNTHETIC_SOURCE_TEST_SIGNAL',
}) as any;

async function sourceServer() {
  const data = optimizerTestData(12);
  const records = new Map<string, any>();
  let serviceOpens = 0, created = 0, executions = 0;
  const execute = async (value: unknown, rerun = false) => {
    // Same ordering as production: normalize/preflight BEFORE store mutation.
    const spec = normalizeP0WithData(value, data), id = p0RunId(spec);
    const prior = records.get(id);
    if (prior && !rerun) return { run_id: id, execution_attempt_id: prior.execution_attempt_id, status: 'SUCCESS', execution_requested: false, reused_existing_attempt: true };
    const result = runInstitutional(spec, data, () => {}, { classifyCapital: controlled });
    const attempt = `source_test_attempt_${++executions}`;
    if (!prior) created++;
    records.set(id, { spec, result, run_id: id, execution_attempt_id: attempt,
      latest_status: 'SUCCESS', execution_kind: 'SYNTHETIC_SOURCE_TEST_ADAPTER',
      attempt_history: [...(prior?.attempt_history ?? []), { execution_attempt_id: attempt, result }] });
    return { run_id: id, execution_attempt_id: attempt, status: 'SUCCESS', execution_requested: true, reused_existing_attempt: false };
  };
  const adapter = {
    submit: execute,
    list: async () => ({ runs: [...records.values()] }),
    get: async (id: string) => records.get(id),
    rerun: async (id: string) => execute(requestFromP0Spec(records.get(id).spec), true),
    store: { reviews: async () => [], review: async () => ({}) },
  } as unknown as P0RouteService;
  const app = express();
  app.use('/api/workbench', createWorkbenchPreviewAccess(() => 'SOURCE_ONLY_TEST_TOKEN'));
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', createP0Router({
    service: async () => { serviceOpens++; return adapter; },
    plan: async (body: unknown) => planP0WithData(body, data),
  }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const call = async (path: string, body?: unknown, auth = true) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/workbench/p0${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(auth ? { Authorization: 'Bearer SOURCE_ONLY_TEST_TOKEN' } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { call, data, stats: () => ({ created, executions, serviceOpens }),
    stop: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

test('HTTP: invalid minimum-holdings values are actionable 4xx before service opening or run creation', async () => {
  const api = await sourceServer();
  try {
    for (const minimum_positions of [null, '', 0, -1, 1.5, 'garbage', NaN, Infinity]) {
      const request = optimizerTestRequest({ mandate: { minimum_positions, maximum_positions: 10, minimum_weight: .03 } });
      assert.throws(() => parseP0(request), (error: any) => error.code === 'PORTFOLIO_CONSTRAINT');
      // JSON encodes nonfinite numbers as null; direct parser check above covers nonfinite inputs too.
      const response = await api.call('/runs', request);
      assert.equal(response.status, 422);
      assert.equal(response.body.error.code, 'PORTFOLIO_CONSTRAINT');
      assert.match(response.body.error.message, /Minimum final holdings.*positive whole number/);
      assert.equal(api.stats().serviceOpens, 0);
      assert.equal(api.stats().created, 0);
    }
  } finally { await api.stop(); }
});

test('HTTP: impossible exposure/cardinality/floor mandates and data coverage fail before any run is created', async () => {
  const api = await sourceServer();
  try {
    for (const patch of [
      { maximum_exposure: .09, mandate: { minimum_positions: 4, maximum_positions: 10, minimum_weight: .03 } },
      { mandate: { minimum_positions: 10, maximum_positions: 4, minimum_weight: .03 } },
      { maximum_etf_weight: .02 },
      { etfs: ['SPY'], mandate: { minimum_positions: 2, maximum_positions: 2, minimum_weight: .03 } },
    ]) {
      const response = await api.call('/runs', optimizerTestRequest({ regime_response: 'FIXED', ...patch }));
      assert.equal(response.status, 422); assert.equal(response.body.error.code, 'PORTFOLIO_CONSTRAINT');
      assert.equal(api.stats().created, 0); assert.equal(api.stats().serviceOpens, 0);
    }
    const history = optimizerTestRequest({ evaluation_start: '2021-03-01', evaluation_end_exclusive: '2021-04-01', training_window_months: 6 });
    for (const route of ['/plan', '/runs']) {
      const response = await api.call(route, history);
      assert.equal(response.status, 422); assert.equal(response.body.error.code, 'DATA_COVERAGE');
      assert.match(response.body.error.message, /2020-09-01|2021-01-01|history/);
      assert.equal(api.stats().created, 0);
    }
  } finally { await api.stop(); }
});

for (const floor of [.025, .03]) test(`HTTP: ${floor * 100}% strategic floor survives positive HMM scaling and cash through more than 85 causal signals`, async () => {
  const api = await sourceServer();
  try {
    const request = optimizerTestRequest({ evaluation_end_exclusive: '2024-06-01', mandate: { minimum_positions: 1, maximum_positions: 10, minimum_weight: floor } });
    const before = structuredClone(request);
    const denied = await api.call('/plan', request, false); assert.equal(denied.status, 401);
    const plan = await api.call('/plan', request);
    assert.equal(plan.status, 200, JSON.stringify(plan.body));
    assert.equal(api.stats().created, 0, 'Preview does not execute or create records');
    assert.deepEqual(plan.body.normalized_request.mandate, request.mandate);
    const submitted = await api.call('/runs', request);
    assert.equal(submitted.status, 202, JSON.stringify(submitted.body));
    const retrieved = await api.call('/runs/' + submitted.body.run_id);
    assert.equal(retrieved.status, 200);
    const result = retrieved.body.result;
    assert.equal(retrieved.body.execution_kind, 'SYNTHETIC_SOURCE_TEST_ADAPTER');
    assert.equal(retrieved.body.spec.dataset_source, 'SYNTHETIC_TEST_ONLY');
    assert.deepEqual(result.plan.folds, plan.body.folds);
    assert.ok(result.capital_clock.signals.length > 85);
    assert.ok(result.validation_evidence.accounting.passed);
    const signals = result.capital_clock.signals;
    assert.equal(result.mandate_evidence.length, plan.body.number_of_folds);
    assert.equal(signals.filter((signal: any) => signal.optimizer_refreshed).length, plan.body.number_of_folds);
    assert.ok(signals.some((signal: any) => signal.exposure === 0), 'Cash remains an explicit capital state');
    assert.ok(signals.some((signal: any) => signal.exposure > 0 && signal.exposure < floor), 'Positive HMM exposure can put every effective holding below construction floor');
    assert.ok(result.capital_target_evidence.every((audit: any) => audit.passed));
    for (const decision of result.decisions) {
      const strategic = Object.values(decision.optimizer.optimized_nav_weights as Record<string, number>);
      const active = strategic.filter((weight: number) => weight > 1e-10);
      assert.ok(active.length <= 10 && active.length >= 1);
      assert.ok(active.every(weight => weight >= floor - CONSTRAINT_TOLERANCE && weight <= request.maximum_etf_weight + CONSTRAINT_TOLERANCE));
      assert.equal(decision.optimizer.audit.status, 'CONVERGED_FEASIBLE_SUPPORT');
      assert.equal(decision.optimizer.audit.support_size, active.length);
      assert.equal(decision.optimizer.constraint_scope, 'STRATEGIC_NAV_TARGET_AT_SCHEDULED_REBALANCE');
      assert.ok(Object.values(decision.optimizer.construction_constraint_residuals as Record<string, number>).every(value => value <= CONSTRAINT_TOLERANCE));
      assert.ok(Object.values(decision.optimizer.effective_policy_residuals as Record<string, number>).every(value => value <= CONSTRAINT_TOLERANCE));
      assert.equal(Object.hasOwn(decision.optimizer.effective_policy_residuals, 'minimum_weight'), false, 'Construction floors are not effective execution safety constraints');
      assert.ok(Object.values(decision.weights as Record<string, number>).reduce((sum, weight) => sum + weight, 0) <= decision.maximum_exposure + CONSTRAINT_TOLERANCE);
      assert.ok(decision.information_cutoff < decision.decision_date);
    }
    for (const signal of signals) {
      assert.ok(signal.rebalance_date || !signal.optimizer_refreshed, 'Capital changes cannot cause intramonth optimization');
      const source = result.decisions.find((decision: any) => decision.decision_date === signal.source_optimizer_date);
      assert.ok(source, 'Every capital target retains the scheduled strategic source');
      assert.deepEqual(signal.frozen_risky_proportions, source.capital_overlay.frozen_risky_proportions);
      const effective = Object.values(signal.frozen_risky_proportions as Record<string, number>).map(proportion => proportion * signal.exposure);
      assert.ok(effective.every(weight => Number.isFinite(weight) && weight >= 0));
      assert.ok(effective.reduce((sum, weight) => sum + weight, 0) <= 1 + CONSTRAINT_TOLERANCE);
      assert.ok(signal.information_cutoff < signal.decision_date);
      if (signal.execution_date) assert.ok(signal.execution_date > signal.decision_date);
    }
    assert.ok(result.ledger.some((day: any) => day.transactionCosts > 0), 'Initial/re-entry costs remain real');
    const again = await api.call('/runs', request);
    assert.equal(again.body.reused_existing_attempt, true);
    assert.equal(api.stats().executions, 1);
    const rerun = await api.call('/runs/' + submitted.body.run_id + '/rerun', {});
    assert.equal(rerun.status, 202, JSON.stringify(rerun.body));
    assert.equal(rerun.body.run_id, submitted.body.run_id);
    assert.notEqual(rerun.body.execution_attempt_id, submitted.body.execution_attempt_id);
    const repeated = await api.call('/runs/' + submitted.body.run_id);
    assert.equal(repeated.body.result.financial_result_hash, result.financial_result_hash);
    assert.deepEqual(repeated.body.result.points, result.points);
    assert.equal(repeated.body.attempt_history.length, 2);
    assert.deepEqual(request, before, 'No dates, support mandate or costs were repaired silently');
  } finally { await api.stop(); }
});
