---
name: Allocation Lab v2 navigation structure
description: The current sidebar order and how sub-workflows/settings are merged into it
---

Allocation Lab v2's left nav is exactly 5 items, in this order: Dashboard, Market Monitor, Portfolio Lab, Research Lab, Investment Committee. Settings is NOT a sidebar item — it lives behind a top-right gear icon.

**Why:** Nav structure has changed twice now (9 sections → 7 sections → this 5-module + gear layout, organized around a strict 12-stage workflow dependency model). Treat nav count/order as a snapshot that can change again, not a permanent constraint — always check the current `Sidebar.tsx` rather than trusting a remembered count.

**How to apply:** When adding a new feature/workflow, do not create a new top-level route/sidebar entry. Instead, find the closest matching existing module and add it as a tab within that page's component (e.g. Market Monitor merges ETF Explorer/Factor Explorer/Market Health as tabs; Investment Committee merges Decision Room/AI Committee Analysis/Report/Archive as tabs; Settings merges Universe & Prior Weights/Constraints/Data Source/Benchmark & Costs/Methodology & Roadmap as tabs). Confirm with the user before adding a genuinely new top-level nav item.
