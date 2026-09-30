import type { ChildProcess } from "node:child_process";

export type ValidationWorkerLease = {
  child: ChildProcess;
  owner: string;
  jobId: string;
  generation: number;
};

export function heartbeatDisposition(
  status: "renewed" | "terminal" | "lost",
): "keep" | "retire" | "terminate" {
  if (status === "terminal") return "retire";
  if (status === "lost") return "terminate";
  return "keep";
}

export function isCurrentValidationWorkerLease(
  current: ValidationWorkerLease | null,
  candidate: ValidationWorkerLease,
  currentChild: ChildProcess | null,
  currentGeneration: number,
): boolean {
  return current === candidate &&
    current.child === candidate.child &&
    current.owner === candidate.owner &&
    current.jobId === candidate.jobId &&
    current.generation === candidate.generation &&
    currentChild === candidate.child &&
    currentGeneration === candidate.generation;
}

export function terminateChildAfterTimeout(
  child: ChildProcess,
  graceMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(forceKill);
      clearTimeout(exitFallback);
      resolve();
    };
    const onExit = () => finish();
    let exitFallback: NodeJS.Timeout | undefined;
    const forceKill = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        exitFallback = setTimeout(finish, 1_000);
      } else finish();
    }, graceMs);
    child.once("exit", onExit);
    child.kill("SIGTERM");
  });
}