# Current execution capacity

Capacity is server configuration, separate from financial model definition. Startup validates positive safe decimal integers, rejects empty/negative/fractional/nonfinite/overflow values without printing their contents, and fails before listening. Timeout is additionally limited to Node's timer range (2,147,483,647 ms).

| Environment variable | Existing default | Enforcement |
|---|---:|---|
| WORKBENCH_MAX_JOBS | 2000 | Exact engine job estimate, checked in /plan, submit, rerun and worker |
| WORKBENCH_MAX_ENGINE_FILES | 512 | Conservative provable file lower bound before submit; actual immutable manifest count on sealing |
| WORKBENCH_EXECUTION_TIMEOUT_MS | 120000 | Worker watchdog and single-worker lease |
| WORKBENCH_MAX_OUTPUT_BYTES | 67108864 | Live output monitor, completed-output check and immutable sealing |

Concurrency remains one. Existing 1 MiB log, worker-message and metadata bounds remain in force. No queue, automatic retry or default increase was added. Owner changes to capacity are not accepted in request JSON.

Capabilities expose effective limits as `CURRENT_EXECUTION_CAPACITY`. V2 returns `INTERACTIVE_EXECUTION_CAPACITY_EXCEEDED` with exact fold count, estimated tasks, current task maximum, conservative minimum file requirement, current file maximum, methodology and `no_attempt_created: true`. The file estimate is explicitly a **lower bound**, not an estimate of exact bytes or a guarantee of success. It uses the unchanged single-model, coupled-clock design: 3 assured root files + planned backtest files + one selection file per fold + two cache files per model fit event. Actual output is still bounded while running and on sealing.

The original generic campaign schema requires a positive max_jobs field. The new worker supplies current capacity for schema validation but removes that runtime field from economic campaign artifacts, experiment identity and financial configuration hashes. It receives the effective worker job limit separately. The normalized financial spec excludes all capacity values. A separate-capacity actual execution test verifies identical run ID, dynamic/control/attribution hashes and full engine financial-artifact hash.

Legacy methodology V1 retains its original fixed operational behavior and precise B3C.1 blocker, with no migration. New ordinary V2 capacity is configurable. The original initial-entry lower-bound proof is never applied to V2. Preflight checks necessary history/folds and deterministic capacity only; it runs no backtest and does not guarantee candidate eligibility.

A capacity blocker must not be described as a rejected financial rule. Primary UX gives one short capacity explanation and one action; exact evidence is retained under SHOW TECHNICAL DETAILS, collapsed initially. No execution attempt is created for a pre-run capacity block.
