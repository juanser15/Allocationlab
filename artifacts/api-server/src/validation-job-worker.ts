import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { claimValidationJob, failValidationJob } from "./lib/validation-job-store";
import { errorForValidationJob, executeValidationJob } from "./lib/validation-job-runner";

const owner = process.env.VALIDATION_JOB_WORKER_OWNER ?? randomUUID();
const POLL_MS = 500;
let stopping = false;

process.on("message", (message) => {
  if (message && typeof message === "object" && "type" in message && message.type === "stop")
    stopping = true;
});
process.on("disconnect", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  logger.info({ owner }, "Validation job worker started");
  while (!stopping) {
    try {
      const job = await claimValidationJob(owner);
      if (!job) {
        await delay(POLL_MS);
        continue;
      }
      if (process.send) process.send({ type: "claimed", jobId: job.id });
      try {
        await executeValidationJob(job, owner);
      } catch (error) {
        const failure = errorForValidationJob(error);
        logger.error({ jobId: job.id, owner, err: error }, "Validation job failed");
        await failValidationJob(job.id, owner, failure);
      }
      if (process.send) process.send({ type: "finished", jobId: job.id });
    } catch (error) {
      logger.error({ owner, err: error }, "Validation job worker loop failed");
      await delay(POLL_MS);
    }
  }
  logger.info({ owner }, "Validation job worker stopped");
  process.exitCode = 0;
}

void run().then(async () => {
  logger.info({ owner }, "Closing validation worker database pool");
  await pool.end();
  if (process.connected) process.disconnect?.();
  process.exitCode = 0;
}).catch(async (error: unknown) => {
  logger.fatal({ owner, err: error }, "Validation job worker terminated unexpectedly");
  try {
    await pool.end();
  } catch (closeError) {
    logger.error({ owner, err: closeError }, "Could not close validation worker database pool");
  }
  if (process.connected) process.disconnect?.();
  process.exitCode = 1;
});