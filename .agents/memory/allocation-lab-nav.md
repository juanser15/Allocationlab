---
name: Allocation Lab v2 navigation structure
description: The fixed 9-section sidebar order and how sub-workflows are merged into it
---

Allocation Lab v2's left nav must stay exactly 9 items, in this order: Command Center, Setup & Data, Portfolio Construction, Results & Diagnostics, Research Lab, Investment Committee, Reports & Exports, Archive & Governance, Methodology & Settings.

**Why:** User explicitly mandated this exact structure after finding the nav confusing/duplicated; treated as a hard constraint, not a suggestion.

**How to apply:** When adding a new feature/workflow, do not create a new top-level route/sidebar entry. Instead, find the closest matching existing section and add it as a tab within that page's component (see `research-lab.tsx` and `investment-committee.tsx` for the tab-merge pattern, and `PageHeader.tsx` for the shared breadcrumb/section header component every page should use).
