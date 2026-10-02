---
name: Financial report evidence and scale
description: Distinguish numerical results, persisted histories, signal freshness, and actual fee conventions in financial reports.
---

A successful as-of optimization does not establish that a historical policy completed. Publish performance only from a completed, reconciled historical run; preserve failed attempts and leave missing metrics absent rather than zero.

**Why:** Long real-universe histories exposed numerical certification failures at historical dates even when terminal-date allocations solved. Forecast-heavy histories also hit serialization limits after substantial computation, without a saved Validation Run.

**How to apply:** Inspect financial status, execution status, reconciliation, full scheduled-decision coverage, and persisted result identity separately. Do not retry the same oversized serialization as a numerical remedy. Changes to universe, factor selection, or risk aversion must be disclosed, not selected by realized performance.

Reducing the number of alpha streams to control payload size also reduces the set of possible underlying allocations. Asset-level limits that are feasible for direct ETF optimization can become infeasible for combinations of a small set of streams at historical dates.

**Why:** A reduced-stream historical run reported infeasible underlying constraints despite its terminal-date allocation solving. This is distinct from the separate serialization failure of the signal forecast.

**How to apply:** Check historical feasibility of the stream exposure maps against the frozen bounds. Do not treat every failed run as an infrastructure error or silently relax economic constraints to obtain a completed backtest.

An allocation's decision timestamp is not sufficient evidence that every input or underlying exposure map was refreshed for that date.

**Why:** A terminal-calendar next-close forecast can be unavailable, while an alpha as-of optimization can use older scheduled exposure mappings. Neither should be described as newly constructed current signals.

**How to apply:** Report information cutoff, decision date, forecast/calendar availability, and mapping signal date separately. Never fabricate future price rows to make an as-of forecast executable.

Use the engine's actual cash ledger and turnover convention when reporting fees.

**Why:** Configured commission/slippage basis points applied to half-absolute target-weight turnover are not equivalent to charging those basis points on every buy and sell fill dollar.

**How to apply:** Reconcile dollar costs to the ledger and explain the calculation base. Do not independently recompute a different brokerage-cost model and label it the engine result.

Check forecast and historical execution timing together before committing to a comparison; an OHLC dataset alone does not establish next-open support for every model.

**Why:** Real-OHLC operation exposed a D6 terminal-calendar forecast limitation, followed by rejection of next-open validation for a same-close forecast. A passing target replay did not resolve either historical limitation.

**How to apply:** Disclose supported timing substitutions and preserve failed attempts. Never invent future observations or present a differently timed validation as the requested execution convention.