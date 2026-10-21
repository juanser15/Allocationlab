# Product Reset 01

Starting checkpoint: `2201fef03b9930ecdd26613daa28788bfd94ba9f`, branch `workbench-v1`.

Allocation Lab is a portfolio research platform. Capital Exposure is its first executable module, not an ETF allocator. The rebuilt `/workbench` uses an application header, ordered portfolio-construction navigation and compact Setup / Results / Compare / Runs / Audit tabs. The legacy root remains separate. No prior evidence or financial implementation is replaced.

The ordinary workflow is Configure → Run → Progress → Results. Every financial field starts empty. Model and universe are fixed by the actual available engine. A background planning request validates the design; Run also validates synchronously before submission. There is no preview action, review checkbox or mandatory audit step. Exact folds remain available in Audit.

The form supplies arbitrary calendar dates, training months, rolling/expanding type, monthly/quarterly rebalance and one explicit Trading Costs input. Standard mode maps the cost exactly to both selection and OOS cost fields. Duplicate configuration is an explicit user action. Optional labels are tab-local display metadata and never affect identity.

Results are actual server calculations. No client return, metric, selection, identity or attribution calculation exists. The three aligned research tracks, performance matrix and attribution are available immediately. Research-only, temporary-storage and unverified-vintage limitations remain visible.

The old designer source remains historical; App routes `/workbench` to `src/research/workbench.tsx`. React, Vite, TypeScript, Wouter, React Query, Zod and Recharts are reused. No dependency or lockfile changes, second app, router framework or database were introduced.
