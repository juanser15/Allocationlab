# Workbench B3B frontend contract

Starting branch: `workbench-v1`. Starting HEAD: `53e8dfbc564d64e7d2669444e3586f36a5523eec`. The starting worktree was clean. All tracked files were hashed before editing.

The existing React/Vite/TypeScript application, Wouter route, TanStack Query, Zod, Recharts and shared input/button primitives are reused. Only the `/workbench` import changes in the application router. Legacy application routes and the B2 page remain in source.

`workbench-v2-api.ts` validates ordinary V2 capabilities, plans, immutable attempts, results, lists and comparisons. The designer never calls `/api/workbench/v1/**`. The API remains the authority for calendars, candidate selection, identity, financial metrics, hashes and result differences. Browser geometry and number/percentage formatting do not calculate financial results.

The seven editable values are evaluation/OOS start, evaluation/OOS end exclusive, window type, training months, cadence, OOS cost and model-selection cost. All begin empty, including enum selections. Fixed mode/scope/universe/validation/version fields are visible product context and validated against capabilities. No financial values are copied from certification fixtures into the form.

`POST /plan` and `POST /runs` use the same strict twelve-field V2 request: contract version, research mode, execution scope, universe, validation protocol and the seven explicit financial fields. Submission sends the backend's normalized plan request itself. No independent test horizon, step, recalibration, candidate budget, paths or output settings are accepted by the client schema.

Capabilities supplies dataset limits, conditional earliest evaluation boundary, training/warmup rules, supported windows/cadences, separate finite nonnegative cost rules and execution limits. Calendar- and quarter-start UX checks reject invalid inputs without moving them. The backend preflight remains authoritative for complete folds, history, model warmup and job budget.

Plan approval is revision-bound. Every field edit immediately clears acceptance and invalidates the previous plan. Late plan responses for older revisions cannot become executable. A new preview requires explicit review of the exact current folds. Blockers, contract errors and mismatched executed folds fail closed.

Successful results expose only mapped backend outputs: observations, final index, simulated cost, CAGR, net Sharpe, drawdown, volatility, turnover and exposure when returned. Metadata identifies the exact evaluation interval, window, training months, cadence, fold count and two costs. Missing outputs are not invented. The primary chart uses actual OOS points, straight lines and no missing-value interpolation. Optional drawdown visualization is not added.

Preview access uses the existing server bearer boundary. The manually entered token stays in sessionStorage, never URLs, build variables, reports or screenshots. Queries/mutations do not automatically retry execution. Status polling stops on terminal states or at the existing bounded UI timeout, after which manual refresh is available.

`RESEARCH_ONLY`, `TEMPORARY_RESEARCH_STORAGE` and `PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED` remain visible in plain language with exact terminology available. There is no investment recommendation, broker/order control or capital authorization.
