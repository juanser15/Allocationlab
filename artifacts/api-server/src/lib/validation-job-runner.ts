import {
  computeB3ValidationRun, persistPreparedB3ValidationRun,
  type FrozenB3ValidationInputs,
} from "./b3-validation-store";
import { computeBacktest } from "../routes/backtest";
import { persistValidationRun } from "./validation-run-store";
import type { ValidationJob } from "@workspace/db";
import {
  completeValidationJobWithRun, updateValidationJobPhase,
  type ValidationJobError, type ValidationJobRequest,
} from "./validation-job-store";
import { d6Error, d6Trace, d6TraceContext, withD6Trace } from "./d6-trace";

type FrozenJobInput = {
  kind: "legacy" | "b3";
  sessionId?: number;
  sessionResultJson?: unknown;
  validatedAt?: string;
  traceId?: string;
  allocation?: FrozenB3ValidationInputs["allocation"];
  prepared?: FrozenB3ValidationInputs["prepared"];
};

function errorFrom(error: unknown): ValidationJobError {
  const message = error instanceof Error ? error.message : "Validation job failed unexpectedly.";
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code : "VALIDATION_JOB_EXECUTION_FAILED";
  const httpStatus = error && typeof error === "object" &&
    "httpStatus" in error && typeof error.httpStatus === "number" ? error.httpStatus
    : error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status
    : null;
  return { code, message, httpStatus };
}

async function runValidationJob(job: ValidationJob, owner: string): Promise<void> {
  const request = job.request as ValidationJobRequest;
  const frozen = job.frozenInputs as FrozenJobInput;
  await updateValidationJobPhase(job.id, owner, frozen.kind === "b3"
    ? "running_b3_validation" : "running_backtest");

  if (frozen.kind === "legacy") {
    if (!frozen.sessionId || frozen.sessionResultJson === undefined)
      throw new Error("Frozen optimization snapshot is incomplete.");
    const result = await computeBacktest(request as Record<string, unknown>, {
      frozenSession: { id: frozen.sessionId, resultJson: frozen.sessionResultJson },
      validatedAt: frozen.validatedAt,
    });
    if (!result.hasSufficientData)
      throw Object.assign(new Error(result.insufficientReason ?? "Validation could not be completed."), {
        httpStatus: 422,
      });
    await updateValidationJobPhase(job.id, owner, "persisting_validation_run");
    await completeValidationJobWithRun(job.id, owner, async (writer) => {
      const run = await persistValidationRun(result, writer);
      return { validationRunId: run.validationRunId };
    });
    return;
  }

  if (frozen.kind !== "b3" || !frozen.allocation || !frozen.prepared)
    throw new Error("Frozen B3 allocation or prepared input is incomplete.");
  const prepared = await computeB3ValidationRun(
    request as Extract<ValidationJobRequest, { allocationId: number }>,
    undefined,
    undefined,
    { allocation: frozen.allocation, prepared: frozen.prepared },
  );
  if ("error" in prepared)
    throw Object.assign(new Error(prepared.error), { httpStatus: prepared.status, code: "B3_VALIDATION_REJECTED" });

  const b3Result = prepared.resultJson.result;
  const failedResult = b3Result.status === "failed" || prepared.reconciliationStatus !== "pass"
    ? {
        code: "B3_VALIDATION_FAILED",
        message: "diagnostic" in b3Result
          ? b3Result.diagnostic
          : `B3 validation completed with ${prepared.reconciliationStatus} reconciliation.`,
        httpStatus: null,
      } satisfies ValidationJobError
    : undefined;
  await updateValidationJobPhase(job.id, owner, "persisting_validation_run");
  await completeValidationJobWithRun(job.id, owner, async (writer) => {
    const saved = await persistPreparedB3ValidationRun(prepared, writer);
    return { validationRunId: saved.run.validationRunId, ...(failedResult ? { failedResult } : {}) };
  });
}

export async function executeValidationJob(job: ValidationJob, owner: string): Promise<void> {
  const frozen = job.frozenInputs as FrozenJobInput;
  const context = d6TraceContext(frozen.traceId);
  return withD6Trace(context, async () => {
    d6Trace("receive", { action: "validation", source: "durable_job", jobId: job.id });
    try {
      await runValidationJob(job, owner);
      d6Trace("job.complete", { action: "validation", jobId: job.id });
    } catch (error) {
      d6Trace("request.exception", { action: "validation", jobId: job.id, ...d6Error(error) });
      throw error;
    }
  });
}

export function errorForValidationJob(error: unknown): ValidationJobError {
  return errorFrom(error);
}