# Interactive Walk-Forward Designer

The owner opens `/workbench`, enters the preview token, and sees an empty research design. The page asks what research design to test and shows the available SPY empirical dataset and its limitations.

1. Enter OOS start and end-exclusive dates, choose Rolling or Expanding, enter a positive integer training window, choose Monthly or Quarterly, and enter both costs explicitly.
2. Review the derived timing. OOS horizon, step and reselection/refit cadence all follow the selected rebalance frequency. They cannot be edited independently.
3. Click **PREVIEW WALK-FORWARD**. This calls only the B3A planning endpoint. Training and warmup failures explain the requested design and available/required observations without changing any input.
4. Review the exact fold map, full date/observation table, estimated jobs, financial assumptions, warnings and blockers. Check the review acknowledgement. Editing any financial field marks the plan **PLAN OUTDATED** and disables execution.
5. Click **RUN RESEARCH**. The normalized request from that plan is submitted unchanged. The actual PENDING/RUNNING/SUCCESS/FAILED/BLOCKED state is shown without a fabricated percentage. Polling is bounded; worker capacity never triggers automatic resubmission.
6. Inspect actual returned metrics and OOS index points. The frontend compares the executed exact fold plan and stored financial request with the reviewed plan. `PLAN_EXECUTION_MISMATCH` withholds results and disables further execution. An opened historical run without a session preview is labelled as engine-returned evidence rather than claiming a frontend review took place.
7. **RERUN SAME DESIGN** calls the backend rerun endpoint with `{}`. Identity remains the same and a new immutable attempt appears. Earlier successful evidence and a newer failed/blocked attempt remain distinct. A pending newer attempt is identified while status refreshes. A history design not reviewed in the current session first displays its exact immutable fold map and requires an explicit review before the rerun call; history cannot bypass fold review.
8. Select exactly two successful V2 runs in **TEMPORARY RESEARCH HISTORY**, then compare. The read-only backend supplies financial-input and result differences. Both fold counts are displayed separately; no unsupported fold-count delta is calculated locally. Overlays are shown only for equal evaluation intervals. Different periods get a visible warning and no overlay. There is no winner or recommendation.

History shows up to twelve available V2 runs, their designs, costs, status and final index where available. OPEN, RERUN and COMPARE remain attached to backend identities; rerun never reconstructs a financial spec locally. Attempt IDs, hashes, artifacts and technical provenance are collapsed under Advanced audit details.

The designer offers no other mode, asset, model, uploaded configuration, optimizer, signal, broker integration or live investment workflow.
