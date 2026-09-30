import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, lt, or } from "drizzle-orm";
import {
  db, allocationsTable, preparedInputsTable, sessionsTable, validationJobsTable,
  type ValidationJob,
} from "@workspace/db";
import { CreateValidationRunBody } from "@workspace/api-zod";
import type { ValidationRunDbWriter } from "./validation-run-store";

export type ValidationJobRequest = ReturnType<typeof CreateValidationRunBody.parse>;
export type ValidationJobStatus = "queued" | "running" | "completed" | "failed";
export type ValidationJobError = { code: string; message: string; httpStatus: number | null };
export const VALIDATION_JOB_LEASE_MS = 45_000;
export const VALIDATION_JOB_MAX_ATTEMPTS = 3;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toPublicJob(row: ValidationJob) {
  return {
    jobId: row.id,
    status: row.status as ValidationJobStatus,
    phase: row.phase,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    validationRunId: row.validationRunId,
    error: row.error as ValidationJobError | null,
    attempts: row.attempts,
    request: row.request as ValidationJobRequest,
  };
}

export function serializeValidationJob(row: ValidationJob) {
  return toPublicJob(row);
}

function duplicateResponse(
  row: ValidationJob,
  requestHash: string,
): { job: ReturnType<typeof toPublicJob>; conflict: boolean } {
  return { job: toPublicJob(row), conflict: row.requestHash !== requestHash };
}

export async function submitValidationJob(
  idempotencyKey: string,
  request: ValidationJobRequest,
  traceId: string = randomUUID(),
) {
  const requestHash = createHash("sha256").update(canonicalJson(request)).digest("hex");
  const [existing] = await db.select().from(validationJobsTable)
    .where(eq(validationJobsTable.idempotencyKey, idempotencyKey)).limit(1);
  if (existing) return duplicateResponse(existing, requestHash);

  let pinnedRequest: ValidationJobRequest;
  let frozenInputs: Record<string, unknown>;
  let sessionId: number | null = null;
  let allocationId: number | null = null;

  if ("allocationId" in request) {
    allocationId = request.allocationId;
    const [allocation] = await db.select().from(allocationsTable)
      .where(eq(allocationsTable.id, allocationId)).limit(1);
    if (!allocation) throw Object.assign(new Error("Frozen allocation policy not found."), { httpStatus: 404 });
    const [prepared] = await db.select().from(preparedInputsTable)
      .where(eq(preparedInputsTable.id, request.validationPreparedInputId)).limit(1);
    if (!prepared) throw Object.assign(new Error("Frozen validation prepared input not found."), { httpStatus: 404 });
    pinnedRequest = request;
    frozenInputs = jsonRoundTrip({
      kind: "b3", allocation, prepared,
    });
  } else {
    const requestedId = request.sessionId;
    const [session] = requestedId !== undefined
      ? await db.select().from(sessionsTable).where(eq(sessionsTable.id, requestedId)).limit(1)
      : await db.select().from(sessionsTable).orderBy(desc(sessionsTable.runAt), desc(sessionsTable.id)).limit(1);
    if (!session) throw Object.assign(new Error("Optimization run not found."), { httpStatus: 404 });
    sessionId = session.id;
    pinnedRequest = { ...request, sessionId: session.id };
    frozenInputs = jsonRoundTrip({
      kind: "legacy", sessionId: session.id, sessionResultJson: session.resultJson,
    });
  }

  const now = new Date();
  const id = randomUUID();
  frozenInputs.traceId = traceId;
  if (frozenInputs.kind === "legacy") frozenInputs.validatedAt = now.toISOString();
  const [inserted] = await db.insert(validationJobsTable).values({
    id,
    idempotencyKey,
    requestHash,
    request: pinnedRequest,
    frozenInputs,
    sessionId,
    allocationId,
    status: "queued",
    phase: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing({ target: validationJobsTable.idempotencyKey }).returning();
  if (inserted) return { job: toPublicJob(inserted), conflict: false };

  const [raced] = await db.select().from(validationJobsTable)
    .where(eq(validationJobsTable.idempotencyKey, idempotencyKey)).limit(1);
  if (!raced) throw new Error("Validation job idempotency conflict could not be resolved.");
  return duplicateResponse(raced, requestHash);
}

export async function getValidationJob(id: string) {
  const [row] = await db.select().from(validationJobsTable).where(eq(validationJobsTable.id, id)).limit(1);
  return row ? toPublicJob(row) : null;
}

export async function listValidationJobs(filters: { sessionId?: number; allocationId?: number }) {
  const predicates = [];
  if (filters.sessionId !== undefined) predicates.push(eq(validationJobsTable.sessionId, filters.sessionId));
  if (filters.allocationId !== undefined) predicates.push(eq(validationJobsTable.allocationId, filters.allocationId));
  const query = db.select().from(validationJobsTable)
    .orderBy(desc(validationJobsTable.createdAt), desc(validationJobsTable.id)).limit(100);
  const rows = predicates.length ? await query.where(and(...predicates)) : await query;
  return rows.map(toPublicJob);
}

export async function claimValidationJob(owner: string): Promise<ValidationJob | null> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + VALIDATION_JOB_LEASE_MS);
  return db.transaction(async (tx) => {
    await tx.update(validationJobsTable).set({
      status: "failed",
      phase: "failed",
      error: {
        code: "WORKER_RESTART_LIMIT",
        message: `Validation job was not recovered after ${VALIDATION_JOB_MAX_ATTEMPTS} worker attempts.`,
        httpStatus: null,
      },
      completedAt: now,
      updatedAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
    }).where(and(
      eq(validationJobsTable.status, "running"),
      lt(validationJobsTable.leaseExpiresAt, now),
      gte(validationJobsTable.attempts, VALIDATION_JOB_MAX_ATTEMPTS),
    ));

    const [candidate] = await tx.select().from(validationJobsTable).where(or(
      eq(validationJobsTable.status, "queued"),
      and(eq(validationJobsTable.status, "running"), lt(validationJobsTable.leaseExpiresAt, now),
        lt(validationJobsTable.attempts, VALIDATION_JOB_MAX_ATTEMPTS)),
    )).orderBy(asc(validationJobsTable.createdAt), asc(validationJobsTable.id))
      .limit(1).for("update", { skipLocked: true });
    if (!candidate) return null;

    const [claimed] = await tx.update(validationJobsTable).set({
      status: "running",
      phase: "starting",
      attempts: candidate.attempts + 1,
      leaseOwner: owner,
      leaseExpiresAt,
      startedAt: candidate.startedAt ?? now,
      updatedAt: now,
      error: null,
    }).where(eq(validationJobsTable.id, candidate.id)).returning();
    return claimed ?? null;
  });
}

export async function renewValidationJobLease(
  id: string,
  owner: string,
): Promise<"renewed" | "terminal" | "lost"> {
  const [updated] = await db.update(validationJobsTable).set({
    leaseExpiresAt: new Date(Date.now() + VALIDATION_JOB_LEASE_MS),
  }).where(and(eq(validationJobsTable.id, id), eq(validationJobsTable.leaseOwner, owner),
    eq(validationJobsTable.status, "running"))).returning({ id: validationJobsTable.id });
  if (updated) return "renewed";
  const [current] = await db.select({
    status: validationJobsTable.status,
  }).from(validationJobsTable).where(eq(validationJobsTable.id, id)).limit(1);
  if (current && (current.status === "completed" || current.status === "failed")) return "terminal";
  return "lost";
}

export async function heartbeatValidationJob(id: string, owner: string): Promise<boolean> {
  return (await renewValidationJobLease(id, owner)) === "renewed";
}

export async function updateValidationJobPhase(id: string, owner: string, phase: string): Promise<void> {
  await db.update(validationJobsTable).set({ phase, updatedAt: new Date() })
    .where(and(eq(validationJobsTable.id, id), eq(validationJobsTable.leaseOwner, owner),
      eq(validationJobsTable.status, "running")));
}

export async function completeValidationJobWithRun(
  id: string,
  owner: string,
  persistRun: (writer: ValidationRunDbWriter) => Promise<{
    validationRunId: number;
    failedResult?: ValidationJobError;
  }>,
) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(validationJobsTable)
      .where(eq(validationJobsTable.id, id)).limit(1).for("update");
    if (!job || job.status !== "running" || job.leaseOwner !== owner)
      throw new Error("Validation job lease was lost before result persistence.");
    const persisted = await persistRun(tx);
    const status = persisted.failedResult ? "failed" : "completed";
    const [completed] = await tx.update(validationJobsTable).set({
      status,
      phase: status,
      error: persisted.failedResult ?? null,
      validationRunId: persisted.validationRunId,
      completedAt: now,
      updatedAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
    }).where(and(eq(validationJobsTable.id, id), eq(validationJobsTable.leaseOwner, owner),
      eq(validationJobsTable.status, "running"))).returning();
    if (!completed) throw new Error("Validation job lease was lost while committing the result.");
    return toPublicJob(completed);
  });
}

export async function failValidationJob(
  id: string,
  owner: string,
  error: ValidationJobError,
): Promise<void> {
  const now = new Date();
  await db.update(validationJobsTable).set({
    status: "failed",
    phase: "failed",
    error,
    completedAt: now,
    updatedAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
  }).where(and(eq(validationJobsTable.id, id), eq(validationJobsTable.leaseOwner, owner),
    eq(validationJobsTable.status, "running")));
}