---
name: Allocation Lab v2 navigation structure
description: The current sidebar order and how sub-workflows/settings are merged into it
---

Allocation Lab v2's left nav is exactly 4 items, in this order: Dashboard, Portfolio Lab, Research Lab, Investment Committee. Settings is NOT a sidebar item — it lives behind a top-right gear icon and now also drives a persistent app-wide DataBar shown beneath the top bar on every page.

**Why:** Nav structure has changed three times now (9 sections → 7 sections → 5-module+gear → this 4-module+gear layout, organized around a strict 12-stage workflow dependency model). The former "Market Monitor" top-level tab was collapsed into Research Lab as tabs. Treat nav count/order as a snapshot that can change again, not a permanent constraint — always check the current `Sidebar.tsx` rather than trusting a remembered count.

**How to apply:** When adding a new feature/workflow, do not create a new top-level route/sidebar entry. Instead, find the closest matching existing module and add it as a tab within that page's component (e.g. Investment Committee merges Decision Room/AI Committee Analysis/Report/Archive as tabs; Settings merges Universe & Prior Weights/Constraints/Data Source/Benchmark & Costs/Methodology & Roadmap as tabs). "Generate Committee Pack" wording must only ever appear in Investment Committee — grep for it after any nav change. Confirm with the user before adding a genuinely new top-level nav item.

Research Lab's tab order is fixed to a config→test→results→diagnostics sequence, not an arbitrary list: 1) Overview (regime/market health status), 2) ETF & Factor Explorer, 3) Backtesting (config + run), 4) Bias Audit / Integrity Checks, 5) Walk-Forward & Sensitivity, 6) Scenario & Stress Lab (two labeled sub-sections: Scenario Analysis for user-defined shocks [SPX/rates/USD/oil/vol/credit], Stress Testing for historical pre-defined episodes [COVID/2022 rates shock/regional banking crisis/tech unwind/custom windows]), 7) Research Notes. Diagnostics tabs (Bias Audit, Walk-Forward, Sensitivity) must never render analysis before their generating backtest has actually run — gate on `bt.hasSufficientData`.

Dashboard must never contain clickable cross-module CTAs (no "Go to X" links/buttons jumping to other modules, including in empty-state alerts or "next step" cards) — it is a read-only status overview only. Individual ETF ticker links (`/etf/:ticker`) are the sole exception, since they're inline data drill-downs, not module navigation.
