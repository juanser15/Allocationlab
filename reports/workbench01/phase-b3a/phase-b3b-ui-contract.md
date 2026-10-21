# Future B3B UI contract — no UI implemented in B3A

The future Walk-Forward Designer must obtain capabilities V2 and require explicit OOS start, OOS end exclusive, rolling/expanding window, training months, monthly/quarterly rebalance, selection cost and OOS evaluation cost. It must explain that historical training precedes the requested evaluation start. It must distinguish warmup from the user-selected training window.

**A visual fold map is required BEFORE RUN.** The UI must call authenticated `POST /api/workbench/plan`, render the returned exact training/cutoff/decision/OOS intervals, show the fold count and estimated jobs, and display all warnings/blockers. Changing any financial field invalidates the old plan and requires a new one before submission. The UI must not calculate a second calendar, silently repair dates, or offer independent test/step/recalibration controls.

Allowed derived timing is one month for MONTHLY or three calendar months for QUARTERLY. Rebalance, model reselection/final refit and new OOS fold start share that cadence. On non-trading boundaries, show the separate calendar OOS start and actual observed decision date from the plan. Quarterly starts must be calendar-quarter aligned to the existing engine.

The ordinary run API requires the exact V2 wire contract documented in `calendar-contract.md`. The frontend must submit the same financial values that produced the previewed plan. The backend remains the sole authority for identity, folds, metrics, costs and comparison. Show precise training/warmup failures with available versus required history; never propose a silently enlarged window.

Results must label evaluation dates, fold count, window type, training window and cadence. Preserve independent-sleeve versus carried-account distinctions and selection-cost versus evaluation-cost meanings. Show immutable attempts, safe failures and reproducibility evidence; do not declare a performance winner or recommend an investment.

The existing B2 frontend is intentionally not upgraded here. Its V1 capability gate disables execution against the V2 API. V1 fixture APIs remain available under `/api/workbench/v1/**` for explicit regression and old-run inspection, not as a substitute for the new designer.

No other universe, research mode, new model, estimator, allocation module, broker/order capability or capital authorization is part of this contract. Preview Bearer access, temporary storage and `PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED` remain visible requirements.
