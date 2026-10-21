# Owner preview readiness

This phase changes only workbench-v1. It does not update render-preview, main, hosting configuration or a deployed service. No deployment is authorized or performed.

An owner-reviewed future preview must build the existing API (including its fixed isolated Workbench worker) and existing Vite frontend from the same source revision. Preserve the committed repository markers, capital source and empirical dataset in the runtime image; Git metadata is unnecessary. Keep API requests same-origin.

Continue to configure the server-only WORKBENCH_PREVIEW_TOKEN and a separate absolute temporary WORKBENCH_RUN_DIR outside the repository. DATABASE_URL remains required by the existing server integration, not by research storage. Do not inject the token into Vite or expose it in URLs. The owner enters it manually; the client keeps it only in sessionStorage and sends a Bearer header.

Optional server-only capacity variables are documented in operational-capacity-contract.md. Omit them to keep exactly 2000 jobs, 512 engine files, 120000 ms and 67108864 output bytes. Invalid values fail startup. This phase does not increase defaults. The exact 84-fold V2 request remains blocked by current interactive file capacity; a different resource tier is a later owner decision, not a model rejection.

Storage remains temporary and append-only per attempt, with no durability claim. Research-only and unverified data-vintage limitations remain mandatory. No real-money capability is present. Stop at owner review; do not start an extended-run implementation.
