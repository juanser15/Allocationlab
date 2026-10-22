import { readExecutionCapacity } from "./lib/workbench/execution-capacity";
import app from "./app";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { startValidationJobSupervisor } from "./lib/validation-job-supervisor";

// Fail closed before listening; only variable names, never values, are reported.
readExecutionCapacity();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const host = process.env["RENDER_LOCAL_API"] === "1" ? "127.0.0.1" : undefined;
const server = app.listen({ port, host }, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  stopWorker = startValidationJobSupervisor();
});

let stopWorker: () => Promise<void> = async () => {};
let isShuttingDown = false;
const shutdown = (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, "Shutting down API and validation worker");
  void (async () => {
    await stopWorker();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await pool.end();
  })().catch((error: unknown) => {
    logger.error({ err: error, signal }, "Could not shut down API and validation worker cleanly");
    process.exitCode = 1;
  });
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
