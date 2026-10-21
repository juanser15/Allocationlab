# Progress contract

States: PENDING, RUNNING, SUCCESS, FAILED, BLOCKED. No queue or implicit retry is introduced.

Planned work units = fold_count × (5 candidate training books + 1 selected OOS book) + 4. The four remaining units are preparation, controls, attribution and finalization. Cache hits complete the same validated work unit; they do not manufacture an additional financial result. Full backtest execution and candidate selection remain real.

The fixed child sends actual completion events. The parent publishes the latest counter for the active immutable attempt. Fields: status, stage, completed_work_units, total_work_units, percent_complete, current_fold, total_folds, completed_candidates, total_candidates, elapsed_ms, estimated_remaining_ms, eta_confidence.

Percentage = 100 × completed / planned units. Counter values are monotonic, bounded and reach 100 for completed financial work. Finalization includes building and hashing the complete result; publishing its immutable envelope follows immediately. Until publication succeeds the attempt remains RUNNING. Failures remain failures even if prior work units completed.

ETA is null / ESTIMATING until at least two units complete; otherwise remaining units × elapsed / completed. Confidence is LOW during early measurements and OBSERVED after five units. It is an estimate from measured aggregate throughput, not a countdown, promise or statistical confidence interval. Different stages have different costs. ETA is never negative. No fake percentage or percent timer exists in the browser. Status responses use actual parent elapsed time while the worker is busy, and progress status always follows the attempt status. The UI displays one decimal place so rounding cannot display 100 before the last planned unit.

The UI polls the actual detail endpoint every 250 ms while pending/running, stops on terminal status and bounds automatic polling by current server timeout plus 15 seconds. Manual refresh restarts observation only. A compact sticky progress panel stays on the same page; completion switches to Results only for the attempt actually launched. Late history refreshes cannot steal later Setup navigation.

Runtime counters/timestamps/memory/cache hits/profiling are excluded from every financial hash. Final progress is stored with the immutable result. A failed attempt preserves private bounded evidence; there is no replacement with an earlier success.
