import { sql } from "drizzle-orm";
import { preparedInputsTable } from "@workspace/db/schema";

const candidates = sql`${preparedInputsTable.snapshot}->'candidates'`;

const technicalStatus = sql<string | null>`
  CASE
    WHEN jsonb_typeof(${candidates}) IS DISTINCT FROM 'array' THEN NULL
    WHEN jsonb_array_length(${candidates}) = 0 THEN 'INCOMPLETE'
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(${candidates}) AS prepared_candidate(value)
      WHERE value->>'status' = 'INVALID_DATA'
    ) THEN 'INVALID_DATA'
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(${candidates}) AS prepared_candidate(value)
      WHERE value->>'status' = 'UNSUPPORTED'
    ) THEN 'UNSUPPORTED'
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(${candidates}) AS prepared_candidate(value)
      WHERE value->>'status' = 'INCOMPLETE'
    ) THEN 'INCOMPLETE'
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(${candidates}) AS prepared_candidate(value)
      WHERE value->>'status' = 'INSUFFICIENT_HISTORY'
    ) THEN 'INSUFFICIENT_HISTORY'
    ELSE 'READY'
  END
`;

const candidateCount = sql<number | null>`
  CASE
    WHEN jsonb_typeof(${candidates}) = 'array' THEN jsonb_array_length(${candidates})
    ELSE NULL
  END
`;

const observationCount = sql<number | null>`
  CASE
    WHEN jsonb_typeof(${preparedInputsTable.snapshot}->'coverage'->'observationCount') = 'number'
      THEN (${preparedInputsTable.snapshot}->'coverage'->>'observationCount')::integer
    ELSE NULL
  END
`;

const datasetId = sql<number | null>`
  CASE
    WHEN jsonb_typeof(${preparedInputsTable.snapshot}->'dataset'->'id') = 'number'
      THEN (${preparedInputsTable.snapshot}->'dataset'->>'id')::integer
    ELSE NULL
  END
`;

/**
 * A SQL-only projection for the saved-input picker. Do not add the snapshot
 * column here: frozen source content, candidates, histories, and ledgers must
 * remain server-side until an explicit GET /prepared-inputs/:id.
 */
export const preparedInputSummaryProjection = {
  preparedInputId: preparedInputsTable.id,
  representation: preparedInputsTable.representation,
  technicalStatus,
  createdAt: preparedInputsTable.createdAt,
  candidateCount,
  coverageStartDate: sql<string | null>`${preparedInputsTable.snapshot}->'coverage'->>'startDate'`,
  coverageEndDate: sql<string | null>`${preparedInputsTable.snapshot}->'coverage'->>'endDate'`,
  observationCount,
  coverageStatus: sql<string | null>`${preparedInputsTable.snapshot}->'coverage'->>'status'`,
  datasetId,
  datasetHash: sql<string | null>`${preparedInputsTable.snapshot}->'dataset'->>'sha256'`,
  cutoffDate: sql<string | null>`${preparedInputsTable.snapshot}->'request'->>'cutoffDate'`,
};