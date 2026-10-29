import express from "express";
import { createP0Router } from "../../artifacts/api-server/src/routes/workbench-p0";
import { createWorkbenchPreviewAccess } from "../../artifacts/api-server/src/lib/workbench/preview-access";
import { blotterFixture, fixtureRecord, manyFillFixture } from "./fixture";
const data = blotterFixture(),
  record = fixtureRecord(),
  large = manyFillFixture(),
  app = express();
large.run_id = "rr_large_blotter";
large.attempt_id = "ea_large_blotter";
app.use(
  "/api/workbench",
  createWorkbenchPreviewAccess(() => "P0B_BROWSER_TEST_ONLY"),
);
app.use(
  "/api",
  createP0Router({
    service: async () =>
      ({
        store: {
          getRun: async (id: string) =>
            id === large.run_id
              ? {
                  normalized_spec: large.spec,
                  attempt_history: [
                    {
                      status: "SUCCESS",
                      attempt: {
                        run_id: large.run_id,
                        execution_attempt_id: large.attempt_id,
                      },
                    },
                  ],
                }
              : {
                  normalized_spec: data.spec,
                  attempt_history: record.attempt_history,
                },
          readAttemptResult: async (ref: any) =>
            ref.runId === large.run_id ? large.result : data.result,
        },
      }) as any,
  }),
);
app.use(express.static(process.argv[2]));
const server = app.listen(0, "127.0.0.1", () =>
  process.send?.({ port: (server.address() as any).port }),
);
process.on("SIGTERM", () => server.close(() => process.exit(0)));
