---
name: Allocation Lab v2 navigation structure
description: The fixed sidebar order and how sub-workflows are merged into it
---

Allocation Lab v2's left nav must stay exactly 7 items, in this order: Dashboard, Portfolio Lab, Market Intelligence, Configuration, Investment Committee, Reports, Archive.

**Why:** User replaced an earlier 9-section structure (Command Center, Setup & Data, Portfolio Construction, Results & Diagnostics, Research Lab, Investment Committee, Reports & Exports, Archive & Governance, Methodology & Settings) with this leaner 7-section one; nav count/order is a hard, user-mandated product constraint that has already changed once — treat any future nav count as a snapshot, not permanent.

**How to apply:** When adding a new feature/workflow, do not create a new top-level route/sidebar entry. Instead, find the closest matching existing section and add it as a tab within that page's component (e.g. Market Intelligence merges ETF Explorer/Factor Explorer/Market Health/Advanced Backtesting as tabs; Configuration merges Universe/Constraints/Data Source/Benchmark/Methodology as tabs). Every page uses the shared `PageHeader` component for its numbered section breadcrumb + title + description.
