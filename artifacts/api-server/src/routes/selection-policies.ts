import { Router, type IRouter } from "express";
import { desc, sql } from "drizzle-orm";
import {
  CreateSelectionPolicyExperimentBody,
  CreateSelectionPolicyExperimentResponse,
  CreateSelectionPolicyPlanBody,
  CreateSelectionPolicyPlanResponse,
  GetSelectionPolicySourcesResponse,
  GetSelectionPolicyExperimentParams,
  GetSelectionPolicyExperimentResponse,
  ListSelectionPolicyExperimentsResponse,
  ReplaySelectionPolicyExperimentParams,
  ReplaySelectionPolicyExperimentResponse,
} from "@workspace/api-zod";
import {
  allocationsTable,
  c2ExperimentsTable,
  db,
  preparedInputsTable,
} from "@workspace/db";
import {
  getC3Experiment,
  listC3Experiments,
  persistC3Experiment,
  previewC3Experiment,
  replayC3Experiment,
} from "../lib/c3-experiment-store";

const router: IRouter = Router();
const INPUT_KEYS = new Set([
  "allocationId", "validationPreparedInputId", "c2ExperimentId", "alphaIds",
  "developmentStartDate", "developmentEndDate", "evaluationStartDate", "evaluationEndDate",
  "thresholds", "groupCaps", "manualOverrides", "assumptions",
]);

function validId(raw: string): boolean {
  return /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw));
}

function validExperimentIds(input: {
  allocationId: number;
  validationPreparedInputId: number;
  c2ExperimentId: number;
}): boolean {
  return [input.allocationId, input.validationPreparedInputId, input.c2ExperimentId]
    .every((id) => Number.isSafeInteger(id) && id > 0);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

router.get("/selection-policies/sources", async (_req, res): Promise<void> => {
  const preparedStatus = sql<string>`CASE
    WHEN jsonb_typeof(${preparedInputsTable.snapshot}->'candidates') IS DISTINCT FROM 'array' THEN 'INVALID_DATA'
    WHEN jsonb_array_length(${preparedInputsTable.snapshot}->'candidates') = 0 THEN 'INCOMPLETE'
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(${preparedInputsTable.snapshot}->'candidates') AS candidate_row(value)
      WHERE candidate_row.value->>'status' = 'INVALID_DATA'
    ) THEN 'INVALID_DATA'
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(${preparedInputsTable.snapshot}->'candidates') AS candidate_row(value)
      WHERE candidate_row.value->>'status' = 'UNSUPPORTED'
    ) THEN 'UNSUPPORTED'
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(${preparedInputsTable.snapshot}->'candidates') AS candidate_row(value)
      WHERE candidate_row.value->>'status' = 'INCOMPLETE'
    ) THEN 'INCOMPLETE'
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(${preparedInputsTable.snapshot}->'candidates') AS candidate_row(value)
      WHERE candidate_row.value->>'status' = 'INSUFFICIENT_HISTORY'
    ) THEN 'INSUFFICIENT_HISTORY'
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(${preparedInputsTable.snapshot}->'candidates') AS candidate_row(value)
      WHERE candidate_row.value->>'status' IS DISTINCT FROM 'READY'
    ) THEN 'INVALID_DATA'
    ELSE 'READY'
  END`;
  const [allocationRows, preparedRows, c2Rows] = await Promise.all([
    db.select({
      id: allocationsTable.id,
      preparedInputId: allocationsTable.preparedInputId,
      representation: allocationsTable.representation,
      status: sql<unknown>`${allocationsTable.frozenResult}->>'status'`,
      candidateIds: sql<unknown>`${allocationsTable.frozenRequest}->'candidateIds'`,
    }).from(allocationsTable).orderBy(desc(allocationsTable.id)),
    db.select({
      preparedInputId: preparedInputsTable.id,
      representation: preparedInputsTable.representation,
      status: preparedStatus,
    }).from(preparedInputsTable).orderBy(desc(preparedInputsTable.id)),
    db.select({
      id: c2ExperimentsTable.id,
      allocationId: c2ExperimentsTable.allocationId,
      validationPreparedInputId: c2ExperimentsTable.validationPreparedInputId,
      alphaIds: sql<unknown>`${c2ExperimentsTable.manifestJson}->'input'->'alphaIds'`,
      startDate: sql<unknown>`${c2ExperimentsTable.manifestJson}->'input'->>'startDate'`,
      endDate: sql<unknown>`${c2ExperimentsTable.manifestJson}->'input'->>'endDate'`,
      createdAt: c2ExperimentsTable.createdAt,
    }).from(c2ExperimentsTable).orderBy(desc(c2ExperimentsTable.id)),
  ]);

  const allocations = allocationRows.flatMap((row) => {
    if (!Number.isSafeInteger(row.id) || row.id < 1 ||
        !Number.isSafeInteger(row.preparedInputId) || row.preparedInputId < 1 ||
        typeof row.representation !== "string" ||
        typeof row.status !== "string" || !row.status ||
        !isStringArray(row.candidateIds)) return [];
    return [{
      id: row.id,
      preparedInputId: row.preparedInputId,
      representation: row.representation,
      status: row.status,
      candidateIds: row.candidateIds,
    }];
  });
  const preparedInputs = preparedRows.flatMap((row) => {
    if (!Number.isSafeInteger(row.preparedInputId) || row.preparedInputId < 1 ||
        typeof row.representation !== "string" || typeof row.status !== "string" || !row.status)
      return [];
    return [{
      preparedInputId: row.preparedInputId,
      representation: row.representation,
      status: row.status,
    }];
  });
  const c2Experiments = c2Rows.flatMap((row) => {
    if (!Number.isSafeInteger(row.id) || row.id < 1 ||
        !Number.isSafeInteger(row.allocationId) || row.allocationId < 1 ||
        !Number.isSafeInteger(row.validationPreparedInputId) || row.validationPreparedInputId < 1 ||
        !isStringArray(row.alphaIds) || !row.alphaIds.length ||
        !validDateString(row.startDate) || !validDateString(row.endDate) ||
        !(row.createdAt instanceof Date) || Number.isNaN(row.createdAt.getTime())) return [];
    return [{
      id: row.id,
      allocationId: row.allocationId,
      validationPreparedInputId: row.validationPreparedInputId,
      alphaIds: row.alphaIds,
      startDate: row.startDate,
      endDate: row.endDate,
      createdAt: row.createdAt.toISOString(),
    }];
  });

  res.json(GetSelectionPolicySourcesResponse.parse({ allocations, preparedInputs, c2Experiments }));
});

router.post("/selection-policies/plan", async (req, res): Promise<void> => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
      Object.keys(req.body).some((key) => !INPUT_KEYS.has(key))) {
    res.status(400).json({ error: "C3 plan request must be an object containing only supported fields." });
    return;
  }
  const parsed = CreateSelectionPolicyPlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!validExperimentIds(parsed.data)) {
    res.status(400).json({ error: "allocationId, validationPreparedInputId, and c2ExperimentId must be positive safe integer IDs." });
    return;
  }
  const preview = await previewC3Experiment({
    ...parsed.data,
    manualOverrides: parsed.data.manualOverrides ?? {},
  } as Parameters<typeof previewC3Experiment>[0]);
  if ("error" in preview) {
    res.status(typeof preview.status === "number" ? preview.status : 409).json({ error: preview.error });
    return;
  }
  res.json(CreateSelectionPolicyPlanResponse.parse(preview.plan));
});

router.post("/selection-policies", async (req, res): Promise<void> => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
      Object.keys(req.body).some((key) => !INPUT_KEYS.has(key))) {
    res.status(400).json({ error: "C3 request must be an object containing only supported fields." });
    return;
  }
  const parsed = CreateSelectionPolicyExperimentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!validExperimentIds(parsed.data)) {
    res.status(400).json({ error: "allocationId, validationPreparedInputId, and c2ExperimentId must be positive safe integer IDs." });
    return;
  }
  const saved = await persistC3Experiment(parsed.data as Parameters<typeof persistC3Experiment>[0]);
  if ("error" in saved) {
    res.status(typeof saved.status === "number" ? saved.status : 409).json({ error: saved.error });
    return;
  }
  res.status(201).json(CreateSelectionPolicyExperimentResponse.parse(saved.experiment));
});

router.get("/selection-policies", async (_req, res): Promise<void> => {
  res.json(ListSelectionPolicyExperimentsResponse.parse(await listC3Experiments()));
});

router.get("/selection-policies/:experimentId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.experimentId) ? req.params.experimentId[0] : req.params.experimentId;
  const params = GetSelectionPolicyExperimentParams.safeParse({ experimentId: raw });
  if (!validId(raw) || !params.success) {
    res.status(400).json({ error: "Invalid C3 experiment ID." });
    return;
  }
  const experiment = await getC3Experiment(params.data.experimentId);
  if (!experiment) {
    res.status(404).json({ error: "C3 experiment not found." });
    return;
  }
  res.json(GetSelectionPolicyExperimentResponse.parse(experiment));
});

router.post("/selection-policies/:experimentId/replay", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.experimentId) ? req.params.experimentId[0] : req.params.experimentId;
  const params = ReplaySelectionPolicyExperimentParams.safeParse({ experimentId: raw });
  if (!validId(raw) || !params.success) {
    res.status(400).json({ error: "Invalid C3 experiment ID." });
    return;
  }
  const replay = await replayC3Experiment(params.data.experimentId);
  if (!replay) {
    res.status(404).json({ error: "C3 experiment not found." });
    return;
  }
  res.json(ReplaySelectionPolicyExperimentResponse.parse(replay));
});

export default router;