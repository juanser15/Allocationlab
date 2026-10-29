/** Public source-only error-contract tests. No datasets, worker or DB access. */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { safeError } from '../../artifacts/api-server/src/routes/workbench';
import { CalendarContractError } from '../../artifacts/api-server/src/lib/workbench/calendar-v2';
import { researchFailureAction, researchFailureCategory, researchFailureStage, type ResearchFailureCategory } from '../../artifacts/api-server/src/lib/workbench/research-error-category';

async function responseFor(error: unknown) {
  const app = express();
  app.get('/source-only-error', (req, res) => safeError(req, res, error));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const { port } = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${port}/source-only-error`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

const publicFailures: Array<{ category: ResearchFailureCategory; message: string; details: Record<string, unknown> }> = [
  { category: 'PORTFOLIO_CONSTRAINT', message: 'Minimum final holdings must be a positive whole number.', details: { field: 'minimum_positions', received: 0 } },
  { category: 'DATA_COVERAGE', message: 'Training requires 2020-09-01, but the selected dataset begins 2021-01-01.', details: { training_start: '2020-09-01', dataset_first: '2021-01-01' } },
  { category: 'SOLVER_INFEASIBLE', message: 'No compliant allocation was found under the exposure and support constraints.', details: { reason: 'FROZEN_COMPOSITION_EXPOSURE_CONFLICT', minimum_required_exposure: .12, available_exposure: .1 } },
  { category: 'NUMERICAL_FAILURE', message: 'The optimizer did not satisfy its convergence certificate.', details: { reason: 'OPTIMIZER_NOT_CONVERGED', constraint_residual: .004 } },
];

for (const failure of publicFailures) {
  test(`HTTP safeError: ${failure.category} preserves its actionable public category and bounded evidence`, async () => {
    const error = new CalendarContractError(failure.category, failure.message, failure.details, 422);
    error.stack = 'SOURCE_ONLY_PRIVATE_STACK at /private/source-only/solver.ts:123';
    const response = await responseFor(error);
    assert.equal(response.status, 422);
    assert.equal(response.body.error.code, failure.category);
    assert.equal(response.body.error.category, failure.category);
    assert.equal(response.body.error.message, failure.message);
    assert.deepEqual(response.body.error.issues, failure.details);
    assert.doesNotMatch(JSON.stringify(response.body), /SOURCE_ONLY_PRIVATE_STACK|\/private\/source-only|"stack"/);
  });
}

test('HTTP safeError: unknown exceptions cannot expose messages, stack paths or forged public error properties', async () => {
  const internal = Object.assign(new Error('SOURCE_ONLY_SECRET_VALUE in /private/source-only/secret.env'), {
    code: 'PORTFOLIO_CONSTRAINT',
    details: { stack: '/private/source-only/internal.ts', environment: 'SOURCE_ONLY_SECRET_VALUE' },
  });
  internal.stack = 'SOURCE_ONLY_PRIVATE_STACK at /private/source-only/internal.ts:12';
  for (const error of [internal, { code: 'NUMERICAL_FAILURE', message: 'SOURCE_ONLY_SECRET_VALUE', stack: internal.stack }]) {
    const response = await responseFor(error);
    assert.equal(response.status, 500);
    assert.deepEqual(response.body.error, {
      code: 'WORKBENCH_INTERNAL_ERROR',
      message: 'The research service could not complete the request.',
    });
    assert.doesNotMatch(JSON.stringify(response.body), /SOURCE_ONLY_SECRET_VALUE|SOURCE_ONLY_PRIVATE_STACK|\/private\/source-only|"stack"|"environment"/);
  }
});

test('Research failure helper keeps the four categories and distinct next actions without treating numerical failure as proven infeasibility', () => {
  const aliases: Record<ResearchFailureCategory, string[]> = {
    PORTFOLIO_CONSTRAINT: ['PORTFOLIO_CONSTRAINT', 'PORTFOLIO_CONSTRAINT_CONFLICT'],
    DATA_COVERAGE: ['DATA_COVERAGE', 'SIGNAL_HISTORY_REQUIRED', 'FORECAST_TRAINING_REQUIRED', 'HMM_HISTORY_REQUIRED', 'INSUFFICIENT_TRAINING_HISTORY'],
    SOLVER_INFEASIBLE: ['SOLVER_INFEASIBLE', 'OPTIMIZATION_INFEASIBLE', 'FROZEN_COMPOSITION_EXPOSURE_CONFLICT'],
    NUMERICAL_FAILURE: ['NUMERICAL_FAILURE', 'OPTIMIZER_NOT_CONVERGED', 'OPTIMIZATION_INVALID_RISK', 'HMM_NUMERICAL_FAILURE', 'HMM_NOT_CONVERGED'],
  };
  for (const [category, codes] of Object.entries(aliases)) for (const code of codes) assert.equal(researchFailureCategory(code), category);
  assert.match(researchFailureAction('PORTFOLIO_CONSTRAINT')!, /Correct.*mandate.*before/);
  assert.match(researchFailureAction('DATA_COVERAGE')!, /training and feature dates.*selected dataset.*No dates were changed/);
  assert.match(researchFailureAction('SOLVER_INFEASIBLE')!, /No compliant allocation.*no constraints were relaxed/);
  assert.match(researchFailureAction('NUMERICAL_FAILURE')!, /convergence and residual.*not interpret.*statically infeasible/);
  assert.equal(new Set(publicFailures.map(({ category }) => researchFailureAction(category))).size, 4);
  assert.equal(researchFailureCategory('UNCLASSIFIED_SOURCE_ONLY_FAILURE'), undefined);
  assert.equal(researchFailureAction(undefined), undefined);
});

test('Failure stage uses the structured solver stage instead of stale preparing progress, with a strict allowlist', () => {
  assert.equal(researchFailureStage({ failed_stage: 'PORTFOLIO_OPTIMIZATION' }, 'Preparing shared data'), 'PORTFOLIO_OPTIMIZATION');
  assert.equal(researchFailureStage({ failed_stage: 'CAPITAL_OVERLAY' }, 'Preparing shared data'), 'CAPITAL_OVERLAY');
  assert.equal(researchFailureStage({ failed_stage: '/private/internal.ts' }, 'Existing progress'), 'Existing progress');
  assert.equal(researchFailureStage({}), 'PREPARING_DATA');
});
