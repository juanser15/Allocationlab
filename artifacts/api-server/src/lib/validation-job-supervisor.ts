import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger";
import { renewValidationJobLease } from "./validation-job-store";
import {
  heartbeatDisposition, isCurrentValidationWorkerLease, terminateChildAfterTimeout,
  type ValidationWorkerLease,
} from "./validation-job-supervisor-control";

const HEARTBEAT_INTERVAL_MS = 8_000;
const RESTART_BASE_DELAY_MS = 1_000;
const RESTART_MAX_DELAY_MS = 30_000;

type ClaimedMessage = { type: "claimed"; jobId: string };
type FinishedMessage = { type: "finished"; jobId: string };

export function startValidationJobSupervisor(): () => Promise<void> {
  if (process.env.VALIDATION_JOB_WORKER_DISABLED === "1") return async () => {};

  const workerPath = resolve(dirname(fileURLToPath(import.meta.url)), "validation-job-worker.mjs");
  let child: ChildProcess | null = null;
  let activeLease: (ValidationWorkerLease & {
    heartbeat: NodeJS.Timeout;
    requestInFlight: boolean;
  }) | null = null;
  let restartTimer: NodeJS.Timeout | null = null;
  let stopped = false;
  let restartCount = 0;
  let generation = 0;

  const retireLease = (lease?: ValidationWorkerLease) => {
    if (!activeLease || (lease && activeLease !== lease)) return;
    clearInterval(activeLease.heartbeat);
    activeLease = null;
  };

  const beginHeartbeat = (jobId: string, owner: string, worker: ChildProcess) => {
    retireLease();
    const lease = {
      child: worker,
      owner,
      jobId,
      generation: ++generation,
      requestInFlight: false,
      heartbeat: undefined as unknown as NodeJS.Timeout,
    };
    activeLease = lease;
    lease.heartbeat = setInterval(async () => {
      if (lease.requestInFlight ||
          !isCurrentValidationWorkerLease(activeLease, lease, child, generation)) return;
      lease.requestInFlight = true;
      try {
        const leaseStatus = await renewValidationJobLease(jobId, owner);
        if (!isCurrentValidationWorkerLease(activeLease, lease, child, generation)) return;
        const disposition = heartbeatDisposition(leaseStatus);
        if (disposition === "retire") {
          retireLease(lease);
        } else if (disposition === "terminate") {
          logger.warn({ jobId, owner }, "Validation job lease is no longer owned by this worker");
          retireLease(lease);
          void terminateChildAfterTimeout(worker, 1_000);
        }
      } catch (error) {
        if (isCurrentValidationWorkerLease(activeLease, lease, child, generation))
          logger.error({ jobId, owner, err: error }, "Could not renew validation job lease");
      } finally {
        lease.requestInFlight = false;
      }
    }, HEARTBEAT_INTERVAL_MS);
    lease.heartbeat.unref();
  };

  const spawnWorker = () => {
    if (stopped || child) return;
    const owner = randomUUID();
    logger.info({ workerPath, owner }, "Starting validation job worker child");
    const worker = fork(workerPath, [], {
      env: { ...process.env, VALIDATION_JOB_WORKER_OWNER: owner },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    child = worker;
    worker.on("message", (message: ClaimedMessage | FinishedMessage) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "claimed" && typeof message.jobId === "string")
        beginHeartbeat(message.jobId, owner, worker);
      else if (message.type === "finished" && activeLease?.jobId === message.jobId &&
          activeLease.child === worker && activeLease.owner === owner)
        retireLease(activeLease);
    });
    worker.on("error", (error) => logger.error({ owner, err: error }, "Validation worker child error"));
    worker.on("exit", (code, signal) => {
      if (activeLease?.child === worker) retireLease(activeLease);
      if (child === worker) child = null;
      logger.warn({ owner, code, signal }, "Validation job worker child exited");
      if (stopped) return;
      const delay = Math.min(RESTART_BASE_DELAY_MS * 2 ** restartCount, RESTART_MAX_DELAY_MS);
      restartCount = Math.min(restartCount + 1, 8);
      restartTimer = setTimeout(spawnWorker, delay);
      restartTimer.unref();
    });
  };

  spawnWorker();

  return async () => {
    stopped = true;
    if (restartTimer) clearTimeout(restartTimer);
    retireLease();
    const current = child;
    if (!current) return;
    if (current.connected) {
      try {
        current.send({ type: "stop" });
      } catch (error) {
        logger.warn({ err: error }, "Could not send validation worker stop message; terminating by signal");
      }
    }
    await terminateChildAfterTimeout(current, 2_000);
  };
}