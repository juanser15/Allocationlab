# Owner workflow

1. Open the Railway preview at `/workbench`. The existing root and legacy routes remain separate.
2. Enter the preview token supplied through the protected Railway environment. It remains in this browser tab's session storage.
3. Review the fixed SPY empirical walk-forward context and choose either 0 bps or 5 bps.
4. Select **Run Research**. The page submits the strict five-field spec and follows the actual queued/running status until it ends.
5. Inspect the returned observations, research index, simulated cost, time-series chart, walk-forward evidence and immutable attempt history. Open advanced details only when audit identifiers are needed.
6. Select **Rerun Same Configuration** to create a new immutable attempt under the same experiment identity.
7. Select **Run Other Cost Scenario** to execute the other allowed cost assumption through the API.
8. Select the two successful runs and choose **Compare Selected Runs**. The comparison is read-only, reports exact differences, and makes no recommendation.

The run history is temporary and may disappear when the preview service restarts. The Workbench is research-only; it cannot trade, place orders, authorize capital, promote a strategy, or verify the historical data vintage independently.
