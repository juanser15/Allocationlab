# Exact fold visualization

The SVG receives `folds[]` from authenticated `POST /api/workbench/plan`. It does not generate dates, extend training or recreate `makeFolds`.

Every row has a training rectangle spanning `[training_start, training_end_exclusive)`, an OOS rectangle spanning `[oos_start, oos_end_exclusive)`, and a decision marker on the actual `decision_date`. Positions and widths are linear elapsed-time projections of those exact backend dates on one shared axis. Calendar month lengths retain their actual geometry. No minimum rectangle width distorts short OOS intervals.

Rolling rows move their training start forward; expanding rows retain the exact initial training start and grow. Axis labels are selected from returned boundaries to remain readable. The legend separates training, OOS and observed decision dates. Calendar OOS starts can differ from observed decision dates on holidays.

The exact table retains fold ID, both training boundaries, information cutoff, decision date, both OOS boundaries and all three backend observation counts. Its caption and labels identify exclusive interval ends. `warmup_observations` is explicitly the backend-reported history available before training, distinct from the required trailing warmup. Calendar observations are distinguished from realized OOS return observations.

The map scrolls horizontally on small screens and vertically for many folds. Tables scroll within their own focusable containers. A common scale and full-size labels are preserved; the page is never shrunk to fit a table. Keyboard users can focus the scroll regions, inspect the exact table, and review folds without relying on color.

The map remains visibly labelled PLAN OUTDATED after an edit, and the execution acknowledgement is disabled until a new successful preview. Financial request equality and exact returned fold equality are checked after execution; the frontend does not create a competing financial hash.

Real Chromium evidence includes rolling, expanding and quarterly maps, pre-run review at all five required widths, returned result charts, and a deliberately mismatched response that correctly withholds results. Fault injection is labelled separately from actual empirical acceptance.
