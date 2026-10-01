import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import {
  allocationsTable,
  db,
  sessionsTable,
  validationJobsTable,
  validationRunsTable,
} from "@workspace/db";
import { ListPortfolioHistoryResponse } from "@workspace/api-zod";
import {
  projectAllocationHistory,
  projectJobHistory,
  projectOptimizationHistory,
  projectValidationHistory,
  sortPortfolioHistory,
} from "../lib/portfolio-history-projection";

const router: IRouter = Router();

router.get("/portfolio-history", async (_req, res): Promise<void> => {
  const [sessions, allocations, validations, jobs] = await Promise.all([
    db.select({
      id: sessionsTable.id,
      createdAt: sessionsTable.runAt,
      representation: sql<string | null>`${sessionsTable.resultJson}->>'representation'`,
      executionMode: sql<string | null>`COALESCE(
        ${sessionsTable.resultJson}->>'executionMode',
        ${sessionsTable.resultJson}->>'executionTiming'
      )`,
    }).from(sessionsTable).orderBy(desc(sessionsTable.runAt), desc(sessionsTable.id)),

    db.select({
      id: allocationsTable.id,
      createdAt: allocationsTable.createdAt,
      representation: allocationsTable.representation,
      resultStatus: sql<string | null>`${allocationsTable.frozenResult}->>'status'`,
      executionMode: sql<string | null>`COALESCE(
        ${allocationsTable.frozenRequest}->>'allocationMode',
        ${allocationsTable.frozenRequest}->>'mode',
        ${allocationsTable.frozenResult}->>'allocationMode',
        ${allocationsTable.frozenResult}->>'mode'
      )`,
    }).from(allocationsTable).orderBy(desc(allocationsTable.createdAt), desc(allocationsTable.id)),

    db.select({
      id: validationRunsTable.id,
      createdAt: validationRunsTable.validatedAt,
      strategySnapshotId: validationRunsTable.strategySnapshotId,
      allocationId: validationRunsTable.allocationId,
      reconciliationStatus: validationRunsTable.reconciliationStatus,
      reproducibilityStatus: validationRunsTable.reproducibilityStatus,
      representation: sql<string | null>`COALESCE(
        ${allocationsTable.representation},
        ${sessionsTable.resultJson}->>'representation'
      )`,
      executionMode: sql<string | null>`${validationRunsTable.assumptions}->>'executionTiming'`,
    }).from(validationRunsTable)
      .leftJoin(allocationsTable, eq(validationRunsTable.allocationId, allocationsTable.id))
      .leftJoin(sessionsTable, eq(validationRunsTable.strategySnapshotId, sessionsTable.id))
      .orderBy(desc(validationRunsTable.validatedAt), desc(validationRunsTable.id)),

    db.select({
      id: validationJobsTable.id,
      createdAt: validationJobsTable.createdAt,
      status: validationJobsTable.status,
      sessionId: validationJobsTable.sessionId,
      allocationId: validationJobsTable.allocationId,
      validationRunId: validationJobsTable.validationRunId,
      representation: sql<string | null>`COALESCE(
        ${allocationsTable.representation},
        ${sessionsTable.resultJson}->>'representation'
      )`,
      executionMode: sql<string | null>`COALESCE(
        ${validationJobsTable.request}->>'executionTiming',
        ${validationJobsTable.request}->'assumptions'->>'executionTiming'
      )`,
    }).from(validationJobsTable)
      .leftJoin(allocationsTable, eq(validationJobsTable.allocationId, allocationsTable.id))
      .leftJoin(sessionsTable, eq(validationJobsTable.sessionId, sessionsTable.id))
      .orderBy(desc(validationJobsTable.createdAt), desc(validationJobsTable.id)),
  ]);

  const history = sortPortfolioHistory([
    ...sessions.map(projectOptimizationHistory),
    ...allocations.map(projectAllocationHistory),
    ...validations.map(projectValidationHistory),
    ...jobs.map(projectJobHistory),
  ]);

  res.set("Cache-Control", "no-store");
  res.json(ListPortfolioHistoryResponse.parse(history));
});

export default router;