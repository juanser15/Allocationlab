# Capital Research Engine v1

Research-only. Uses the corrected production `runBacktestEngine`, explicit targets
on one fixed risk asset, actual-notional D5 fees and no production services.
CL-01 and CL-02 remain unchanged.

## Run

From `artifacts/api-server`, build with existing dependencies:

```sh
./node_modules/.bin/esbuild ../../research/capital/engine.test.ts ../../research/capital/cli.ts --bundle --platform=node --format=esm --packages=external --alias:@workspace/db=./src/lib/calculator.a1.db-shim.ts --outdir=dist/cl03
```

From repository root:

```sh
node artifacts/api-server/dist/cl03/engine.test.js
node artifacts/api-server/dist/cl03/cli.js configs/capital-research/acceptance-nested.json --dry-run
node artifacts/api-server/dist/cl03/cli.js configs/capital-research/acceptance-nested.json --run
# Bounded interruption, then same --run resumes only pending evaluations:
node artifacts/api-server/dist/cl03/cli.js campaign.json --run --max-new-jobs 2
MPLCONFIGDIR=/tmp/cl03-mpl XDG_CACHE_HOME=/tmp/cl03-cache python research/capital/render.py reports/capital-research/EXPERIMENT_ID
```

The default CLI action is dry-run. A run requires a matching dry-run and must fit
the explicitly declared `max_jobs`. Never run `budget-200.json` as an acceptance
campaign: its 100-job guard intentionally blocks the 1,610-job plan.

## Campaign specification

Examples are in `configs/capital-research/`. JSON is parsed without dependencies.
Dates are month-start inclusive `start` / exclusive `end_exclusive`. Only complete
outer and inner horizons are generated. Rolling training keeps its declared
month length; expanding training keeps its initial start. Inner window type
inherits outer type unless explicitly supplied.

`candidate_space` is an array of templates with a `base` CandidateSpec and optional
dot-path `axes`. Change axes/templates in campaign JSON, not the engine. Candidate
IDs hash canonical configuration; campaign/mode/fold are not part of the candidate
definition. Grid expansion exceeding budget fails unless `grid_reduction.indices`
explicitly identifies retained Cartesian indices. Random samples without
replacement with a mandatory deterministic seed. Budget defaults to 200 and may
never exceed 200.

Supported clocks: signal/rebalance monthly or quarterly (existing backtester);
model recalibration monthly/quarterly/yearly/once; independently configured
train, test and step in months. Recalibration is on-demand at the most recent
declared calendar event during traditional training. Unused intermediate fits
need not be calculated. Models fit from scratch on the supplied training slice.
Inner and outer OOS learned parameters/normalizers remain frozen at their training
cutoff; market state can still update as-of each signal. Traditional training
uses as-of recalibrations, not an estimator fitted on the end of the entire train
window for earlier signals.

Disjoint tests are required (`step_months >= test_months`, likewise inner).
Larger steps leave explicit gaps. Overlapping test horizons are rejected rather
than double-counted. Market input history may precede a training boundary for
indicator warmup; **fit/normalization training rows never do**. A family requiring
minimum training history must validate that in its fit; failures are retained.

## Registry

`Registry.model(name, definition)` registers a versioned family with `validate`,
`fit` and `predict`. Fit receives only the training slice and information cutoff;
predict receives only market rows through the strict previous close. Outputs can
contain state, score, forecast or probabilities. Fit state and outputs must be
JSON-safe plain data. A version must change when family semantics change.

`Registry.policy(name, definition)` registers a separate versioned output→risk
mapping with `validate` and `map`. Risk must be finite in [0,1]; cash is 1-risk.
Only `current_regime`, `cash_band` and `constant` are real registrations in v1.
The regime is stateless; its fit artifact declares that fact. Identity is the
only real transformation currently supported. Synthetic families are confined
to the test fixture. No HMM, Markov or new financial estimator is implemented.

Model cache keys contain data hash, family/version/parameters, inputs,
transformations, training bounds, information cutoff/hash and fold identity.
Policies are excluded from model identity, so multiple policies share one fit.
Prediction cache adds actual signal information cutoff/hash. Reuse never crosses
different information sets.

## Selection and persistence

Primary selection metric and selection cost scenario are frozen before
performance. Traditional uses training scores; nested recomputes metrics from
concatenated **inner OOS observations**, never outer data. Constraints apply to
annual gross turnover, absolute maximum drawdown and mean beginning risky
exposure. Ties: lower annual turnover, lower generic parameter-count complexity,
then candidate ID. Undefined primary metrics and constraint violations are
recorded; no fallback winner is invented.

Each selection is frozen before its selected outer backtest. Jobs are partitioned
by experiment/candidate/outer/inner-or-stage/scenario and carry integrity hashes.
Valid, invalid and failed evaluations are completed records, not silently retried.
Atomic temp-file/rename writes protect interruption boundaries. Code/config/data
changes reject reuse in an existing experiment directory; create a new experiment
ID for a deliberately different campaign. Telemetry is separate from reproducible
result summaries, so resume leaves economic artifact hashes unchanged.

## Accounting and diagnostics

Each validation sleeve starts NAV=100 in cash using the existing backtester. Entry
fees are included; there is no fictional terminal liquidation. Outer-OOS equity
compounds only outer daily returns from these independent sleeves. It is a
research return index, **not a continuous carried-position account**. Sleeve
positions/NAV remain explicit in `oos-ledger.csv`; the composite is separate in
`oos-equity.csv`. A future continuous-account validation protocol is not silently
substituted here.

CAGR annualizes compounded returns by 252/observed sessions, including initial
cash waiting in each sleeve; it is not calendar CAGR from CL-02. Volatility and
Sharpe use sample daily deviations; Sharpe subtracts the declared daily reference.
Cash supports an explicit constant daily rate; historical-series cash is not
implemented. Fees are verified against actual fills and NAV against positions.

Every candidate/score/status, fold, selection, job, cache artifact and failure is
saved. Diagnostics include per-fold distributions, ranks, score versus outer
score, candidate/family selection counts, numeric nearest-neighbor sensitivity
and aligned inner OOS return correlations. No comparable candidate OOS series
exists for traditional's unselected candidates, so those similarities are not
fabricated. DSR is **NOT_IMPLEMENTED**; no significance/alpha/robustness claim is
made from the highest Sharpe or from two acceptance folds.

## CL-04 verification and hardening (v1.0.1)

CL-01/02/03 artifacts and configs remain frozen. Original research source is
archived in `reports/cl04/baseline/research/capital/`; the hardening diff and
pre/post failures are in `reports/cl04/`. See `reports/CL04_engine_validation.md`.

Models receive a deeply frozen `ModelSpec` containing only family, parameters,
inputs and transformations. Context rows are copied, deeply frozen and projected
onto declared model inputs. Policy parameters never reach fit/predict; policies
receive frozen copies of the model output and their own parameters. This is an
information API for trusted research plugins, not an OS sandbox for malicious
code reading arbitrary files or globals.

Fit/prediction cache data hashes cover their actual information slice, so changes
after a cutoff preserve previous cache artifacts. Full snapshot/code/registry
hashes still reject changed economic jobs within an existing experiment. An
explicit `cache_root` can share verified scope-identical artifacts across new
experiments; the cache contract version separates pre-hardening artifacts.
Nonfinite/non-JSON state and integrity mismatches are rejected. Atomic writers
use RFC4180 quotes and CRLF for CSV. Failed job/summary commits are journaled in
`storage-failures.jsonl`; storage failure aborts rather than inventing completion.
Once the filesystem is repaired, completed jobs resume without new backtests.
Elapsed time, per-invocation hits/misses and peak RSS stay in `progress.json`,
outside reproducible economic summaries.

Build QA from `artifacts/api-server` using the existing esbuild command with
`../../research/capital/validation.test.ts ../../research/capital/qa-campaign.ts`
and `--outdir=dist/cl04`. Run from repository root (fixtures resolve source paths):

```sh
node artifacts/api-server/dist/cl04/validation.test.js
node artifacts/api-server/dist/cl04/qa-campaign.js 200
python research/capital/replay.py reports/cl04/scale-200
```

The 200-candidate QA spec is separate from CL-03's frozen budget-200 spec: one
outer/inner fold, 0/5 bps, 402 backtests plus two fits, explicit max_jobs=500.
QA observables, predictors and constant policy grids are deterministic synthetic
infrastructure fixtures. They are never registered by the real financial CLI.
Independent oracles implement pairwise sample variance, integer calendar folds,
closed-form self-financing fills and artifact-only winner/OOS reconstruction.
DSR remains NOT_IMPLEMENTED and the independent-sleeve convention is unchanged.
