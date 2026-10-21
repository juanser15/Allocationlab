# Exact Railway failure

Starting branch `workbench-v1`, clean at `2404632e60f837dc564a64f3029e1abe92324f95`. The exact request was reproduced first, without reducing the period or fold count, using the actual production server and fixed production worker in a fresh external temporary store. Passive parent-process event listeners observed IPC and process exit without changing worker arguments, source, inputs, costs, constraints, limits or behavior. The server remained online.

**Primary cause: NO_VALID_CANDIDATE (classification B).** The first rejected selection is fold 0: training `[2019-09-01, 2019-10-01)`, decision date `2019-10-01`, test `[2019-10-01, 2019-11-01)`. Its training ledger contains 20 actual observations. Every training job is VALID and every net-Sharpe value is defined. All five policies violate the unchanged maximum annualized gross turnover of 8. There is no selection-history, data-availability, timeout or worker-protocol failure at this boundary.

| Policy | Required initial SPY target | Annualized turnover | Limit |
| --- | ---: | ---: | ---: |
| Cash 20–20% | 0.8 | 10.079193664506839 | 8 |
| Cash 20–40% | 0.6893 | 8.684581371806042 | 8 |
| Cash 10–40% | 0.73395 | 9.247091309733321 | 8 |
| Constant 100% SPY | 1 | 12.598740125987401 | 8 |
| Cash 10–20% | 0.84465 | 10.641691149557053 | 8 |

The independent training sleeve starts in cash and includes actual entry turnover. For first target r and selection fee rate k, self-financing entered notional divided by pretrade NAV is `r / (1 + k*r)`. The certified metric annualizes cumulative gross turnover by `252 / observed_training_returns`. Later turnover is nonnegative. The initial entry therefore supplies a necessary lower bound; for this one-month fold it equals actual total turnover. The exact bound is verified against all five actual engine ledgers to `1e-12`.

The engine continues across all 84 requested folds and writes an INCOMPLETE summary: 71 selections have no eligible candidate, 433 backtest jobs were produced, with zero invalid and zero failed jobs. The V2 adapter then throws `Error: Dynamic campaign did not complete as a fresh execution`. The worker sends `CAPITAL_ENGINE_EXECUTION_FAILED`; the parent wraps it as `WORKBENCH_WORKER_FAILED` and exposes the generic safe message. Parent cleanup sends SIGTERM after that error message; this is not evidence of an independent worker crash. Exact elapsed time, exit observation, byte/file counts and source artifact hashes are in `before-fix-reproduction.json`.

The engine output is about 13.4 MB, below 64 MiB, and completes in about 26 seconds, below the unchanged 120-second timeout. A separate latent resource issue exists: 728 files exceed the unchanged 512-file success-sealing budget. That check did not cause this failure because the completeness guard ran before sealing. New preflight also rejects a provably unsealable successful campaign using the existing fixed-model event/job plan and conservative file-count accounting. It does not raise limits.

# Narrow remediation

An additive API preflight uses the existing calendar plan, actual training observation counts, existing stateless model/registry, existing exposure policies and explicitly supplied selection costs. It computes only the first training target for each model/fold using strictly prior historical inputs. It does not calculate returns, candidate rankings, OOS metrics, a ledger or a full backtest. If every candidate's required entry already breaches the fixed turnover limit, the plan and direct submission return HTTP 422 `NO_VALID_CANDIDATE` with the exact fold and bound. The 84-fold design remains unchanged and creates no attempt.

This is not a minimum month count. One-month requests remain valid inputs, and a real one-month design is included in the acceptance matrix. Passing preflight is explicitly not a guarantee of candidate eligibility: defined net Sharpe, realized drawdown and later turnover still require the unchanged engine. Such execution failures now expose safe evidence-based diagnostics instead of inferring a cause from the generic worker message.

No certified engine, model, selection metric, candidate definition, constraint, calendar planner, cost mechanism, identity implementation or benchmark methodology is edited. Validation is attached at the ordinary V2 API boundary, including rerun. Existing failed attempt files remain byte-identical; new diagnostics are appended separately. Prior successful run IDs and all financial hashes remain unchanged.
