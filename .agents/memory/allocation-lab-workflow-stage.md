---
name: Allocation Lab workflow-stage gating model
description: 12-stage stage model driving EmptyState gating so diagnostics never render before their generating run
---

Allocation Lab v2 models progress as 12 strict stages (0 No Data ... 11 Archived), computed by `useWorkflowStage` (`src/lib/workflow.ts`) from live backend state (price data status, latest committee run, backtest results, archive, decision log) — never from a client-side flag that could drift from reality.

**Why:** Product requirement: outputs and diagnostics must never render before the run that generates them (e.g. no backtest diagnostics before a backtest has actually run, no committee decision room before a committee run exists).

**How to apply:** Any page that shows derived output (Market Monitor, Portfolio Lab, Research Lab, Investment Committee) must gate that output behind the relevant stage using the shared `EmptyState` component (`src/components/shared/EmptyState.tsx`, requires an `icon: LucideIcon` prop) and show current progress via `WorkflowStatusBar`. When adding a new derived view, determine which stage it depends on and gate it the same way rather than assuming data exists.
