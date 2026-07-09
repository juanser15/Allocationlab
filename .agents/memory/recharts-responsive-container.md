---
name: Recharts ResponsiveContainer in nested flex/grid layouts
description: Why a recharts chart can render as blank/invisible inside nested flex or grid preview panels, and the fix
---

## Symptom
A recharts `<ResponsiveContainer>` renders an empty white box (no chart) even though the data is correct and the component otherwise mounts fine, inside a nested flex/grid layout (e.g. a report preview panel embedded within a sidebar+content grid).

**Why:** `ResponsiveContainer` measures its parent's size via `width: 100%; height: 100%` on first render. In deeply nested flex/grid containers (especially ones using `min-w-0`, `xl:grid-cols-[...]`, or conditional mount via `{show && <Preview/>}`), the parent can report a 0px width/height at the moment recharts measures it, and the container never re-measures afterward.

## Fix
Replace `ResponsiveContainer` with a chart component (`PieChart`, etc.) given explicit fixed `width`/`height` props when it lives inside a preview/report panel with a known, bounded pixel size. Add `isAnimationActive={false}` too, since these previews are also captured via html2canvas for PNG export and animation frames can be captured mid-transition.

**How to apply:** if a chart embedded in a report/preview/export panel renders blank on first paint (but the surrounding legend/labels are fine), suspect `ResponsiveContainer` sizing before assuming a data bug — switch to fixed pixel dimensions.
