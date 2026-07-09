---
name: Allocation Lab v2 navigation structure
description: The current sidebar order and how sub-workflows/settings are merged into it
---

Allocation Lab v2's left nav is exactly 4 items, in this order: Dashboard, Portfolio Lab, Research Lab, Investment Committee. Settings is NOT a sidebar item — it lives behind a top-right gear icon and now also drives a persistent app-wide DataBar shown beneath the top bar on every page.

**Why:** Nav structure has changed three times now (9 sections → 7 sections → 5-module+gear → this 4-module+gear layout, organized around a strict 12-stage workflow dependency model). The former "Market Monitor" top-level tab was collapsed into Research Lab as tabs. Treat nav count/order as a snapshot that can change again, not a permanent constraint — always check the current `Sidebar.tsx` rather than trusting a remembered count.

**How to apply:** When adding a new feature/workflow, do not create a new top-level route/sidebar entry. Instead, find the closest matching existing module and add it as a tab within that page's component (e.g. Research Lab merges ETF Explorer/Factor Explorer/Market Health/Backtester/Bias Audit/Walk-Forward/Sensitivity/Scenario-Stress Testing/Research Notes as tabs; Investment Committee merges Decision Room/AI Committee Analysis/Report/Archive as tabs; Settings merges Universe & Prior Weights/Constraints/Data Source/Benchmark & Costs/Methodology & Roadmap as tabs). "Generate Committee Pack" wording must only ever appear in Investment Committee — grep for it after any nav change. Confirm with the user before adding a genuinely new top-level nav item.
