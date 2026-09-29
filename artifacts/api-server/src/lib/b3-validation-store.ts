import { db, allocationsTable, preparedInputsTable, validationRunsTable } from "@workspace/db";
import { desc, eq, isNotNull, and } from "drizzle-orm";
import {
  runB3Validation,
  type B3Assumptions,
  type B3EstimationDatePlan,
  type B3Result,
} from "./b3-policy";
import type { AllocationRequest } from "./allocation-b2";
import type { B3ValidationAssumptions } from "@workspace/api-zod";
import { fingerprint } from "./prepared-inputs";
import { hashDataset } from "./run-snapshot";
import { maximumNumericDifference } from "./replay-numeric-difference";

const B3_API_ENGINE_VERSION = "b3-validation-api.1";

type B3ValidationEnvelope = {
  kind: "b3";
  policySnapshot: unknown;
  policyRequest: unknown;
  validationSnapshot: unknown;
  validationPreparedFingerprint: string;
  assumptions: B3Assumptions;
  estimationDatePlan?: B3EstimationDatePlan;
  result: B3Result | { status: "failed"; diagnostic: string };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function engineVersion(snapshot: unknown): string {
  const snapshotVersion = isRecord(snapshot) && typeof snapshot.engineVersion === "string"
    ? snapshot.engineVersion : "unknown";
  return `${B3_API_ENGINE_VERSION}; ${snapshotVersion}`;
}

function resultStatus(result: unknown): "success" | "failed" {
  if (!isRecord(result)) return "failed";
  const diagnostics = isRecord(result.diagnostics) ? result.diagnostics : null;
  const accounting = diagnostics && typeof diagnostics.maximumReconciliationDifference === "number" &&
    Number.isFinite(diagnostics.maximumReconciliationDifference) &&
    diagnostics.maximumReconciliationDifference <= 1e-8;
  const fullRun = Array.isArray(result.dailyLedger) && result.dailyLedger.length > 0 &&
    Array.isArray(result.decisions) && Array.isArray(result.decisionCalendar) &&
    result.decisions.length === result.decisionCalendar.length;
  // Both full-period completion and accounting reconciliation are required.
  return result.status === "completed" && accounting && fullRun ? "success" : "failed";
}

function jsonbRoundTrip(value: unknown): unknown {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? undefined : JSON.parse(encoded);
}

type B3InputHashInput = {
  allocationId: number;
  validationPreparedInputId: number;
  policySnapshot: unknown;
  policyRequest: unknown;
  validationSnapshot: unknown;
  assumptions: unknown;
  estimationDatePlan?: unknown;
  engineVersion: string;
  result: unknown;
};

function b3HashPayload(input: B3InputHashInput): unknown {
  const { estimationDatePlan, ...base } = input;
  return estimationDatePlan === undefined ? base : { ...base, estimationDatePlan };
}

export function b3InputHash(input: B3InputHashInput): string {
  // JSONB drops undefined object properties and converts non-JSON numeric
  // values to null. Hash the same representation that is persisted so save
  // and replay agree even when D4 diagnostics contain optional request fields.
  return fingerprint(jsonbRoundTrip(b3HashPayload(input)));
}

function legacyB3InputHash(input: B3InputHashInput): string {
  // Before JSONB normalization was applied, saved B3 hashes covered the
  // in-memory result (including undefined properties later omitted by JSONB).
  return fingerprint(b3HashPayload(input));
}

function jsonbValueHash(value: unknown): string {
  return fingerprint(jsonbRoundTrip(value));
}

export function verifyLegacyB3ReplayFingerprint(
  input: B3InputHashInput,
  storedHash: string,
  replayedResult: unknown,
  engineVersionMatches: boolean,
): boolean {
  if (!engineVersionMatches ||
      legacyB3InputHash({ ...input, result: replayedResult }) !== storedHash)
    return false;
  // Legacy fallback is stricter than the ordinary numeric replay tolerance:
  // the persisted JSONB payload itself must be exactly the replayed payload.
  return jsonbValueHash(input.result) === jsonbValueHash(replayedResult);
}

function envelope(row: typeof validationRunsTable.$inferSelect): B3ValidationEnvelope {
  const value = row.resultJson;
  if (!isRecord(value) || value.kind !== "b3")
    throw new Error(`Validation Run ${row.id} is missing its frozen B3 inputs.`);
  return value as unknown as B3ValidationEnvelope;
}

function b3Representation(envelope: B3ValidationEnvelope): string {
  if (isRecord(envelope.policyRequest) && typeof envelope.policyRequest.representation === "string")
    return envelope.policyRequest.representation;
  if (isRecord(envelope.policySnapshot) && typeof envelope.policySnapshot.representation === "string")
    return envelope.policySnapshot.representation;
  throw new Error("Frozen B3 Validation Run is missing its policy representation.");
}

function b3ComparisonMetadata(envelope: B3ValidationEnvelope) {
  const request = isRecord(envelope.policyRequest) ? envelope.policyRequest : null;
  const constraints = request && isRecord(request.constraints) ? request.constraints : null;
  if (!constraints)
    throw new Error("Frozen B3 Validation Run is missing its policy constraints.");
  return {
    finalAssetConstraints: constraints,
    capitalBudget: {
      initialNav: envelope.assumptions.initialNav,
      initialCash: envelope.assumptions.initialCash,
      initialHoldings: envelope.assumptions.initialHoldings,
      initialRiskyCapital: envelope.assumptions.initialNav - envelope.assumptions.initialCash,
      policyTotalCashConstraint: constraints.totalCash ?? null,
    },
  };
}

function statisticalFactorIntegrityError(request: AllocationRequest, result: B3Result): string | null {
  if (request.riskModel?.type !== "STATISTICAL_FACTOR") return null;
  const expectedFactors = request.riskModel.factorCount;
  const expectedFloor = request.riskModel.specificRiskFloorFraction ?? 1e-6;
  if (!Number.isSafeInteger(expectedFactors) || (expectedFactors ?? 0) < 1)
    return "Statistical-factor B3 policy must freeze a resolved positive factor count.";
  for (const decision of result.decisions) {
    const risk = decision.optimizer.riskModel;
    if (risk?.type !== "STATISTICAL_FACTOR" || risk.factorCount !== expectedFactors ||
        risk.specificRiskFloorFraction !== expectedFloor)
      return `Statistical-factor settings changed or are missing at B3 decision ${decision.decisionDate}.`;
    if (risk.provenance.informationCutoff !== decision.informationCutoff ||
        risk.provenance.datasetHash !== decision.inputDatasetHash ||
        risk.provenance.observationCount !== decision.estimationDates.length ||
        JSON.stringify(risk.provenance.dates) !== JSON.stringify(decision.estimationDates) ||
        JSON.stringify(risk.provenance.candidateIds) !== JSON.stringify(decision.pointInTimeCandidateIds) ||
        risk.covariance.length !== decision.pointInTimeCandidateIds.length ||
        risk.covariance.some((row) => row.length !== decision.pointInTimeCandidateIds.length))
      return `Statistical-factor B3 provenance or covariance dimensions do not match decision ${decision.decisionDate}.`;
    if (risk.provenance.dates.some((date) => date > decision.informationCutoff))
      return `Statistical-factor B3 inputs contain future observations at ${decision.decisionDate}.`;
  }
  return null;
}

export function toB3ValidationRun(row: typeof validationRunsTable.$inferSelect) {
  const saved = envelope(row);
  const result = saved.result;
  const status = resultStatus(result);
  return {
    validationRunId: row.id,
    allocationId: row.allocationId!,
    validationPreparedInputId: row.validationPreparedInputId!,
    representation: b3Representation(saved),
    datasetHash: row.datasetHash,
    engineVersion: row.engineVersion,
    validatedAt: row.validatedAt.toISOString(),
    assumptions: saved.assumptions,
    reconciliationStatus: row.reconciliationStatus,
    reproducibilityStatus: row.reproducibilityStatus,
    validationInputHash: row.validationInputHash,
    status,
    result,
    comparisonMetadata: b3ComparisonMetadata(saved),
  };
}

export async function persistB3ValidationRun(input: {
  allocationId: number;
  validationPreparedInputId: number;
  assumptions: B3ValidationAssumptions;
}, internalPolicyRequestOverride?: AllocationRequest, internalEstimationDatePlan?: B3EstimationDatePlan) {
  const [allocation] = await db.select().from(allocationsTable)
    .where(eq(allocationsTable.id, input.allocationId)).limit(1);
  if (!allocation) return { error: "Frozen allocation policy not found.", status: 404 } as const;
  const [prepared] = await db.select().from(preparedInputsTable)
    .where(eq(preparedInputsTable.id, input.validationPreparedInputId)).limit(1);
  if (!prepared) return { error: "Frozen validation prepared input not found.", status: 404 } as const;

  const policySnapshot = structuredClone(allocation.frozenSnapshot);
  const basePolicyRequest = structuredClone(allocation.frozenRequest) as AllocationRequest;
  if (basePolicyRequest.costAware) {
    return {
      error: "The legacy D5 costAware L1 method is retired; new B3 validations cannot be created from saved costAware allocations.",
      status: 422,
    } as const;
  }
  const policyRequest = internalPolicyRequestOverride
    ? structuredClone(internalPolicyRequestOverride)
    : basePolicyRequest;
  if (internalPolicyRequestOverride && !validInternalPolicyOverride(basePolicyRequest, policyRequest))
    return { error: "Internal C1 policy request override is not a valid subset of the frozen allocation.", status: 409 } as const;
  const validationSnapshot = structuredClone(prepared.snapshot);
  const policySnapshotHash = fingerprint(policySnapshot);
  const expectedAllocationFingerprint = fingerprint({
    preparedInputId: allocation.preparedInputId,
    representation: allocation.representation,
    engineVersion: allocation.engineVersion,
    request: basePolicyRequest,
    snapshotHash: policySnapshotHash,
    result: allocation.frozenResult,
  });
  if (policySnapshotHash !== allocation.frozenSnapshotHash || expectedAllocationFingerprint !== allocation.fingerprint) {
    return { error: "Frozen allocation policy fingerprint mismatch.", status: 409 } as const;
  }
  const preparedFingerprint = isRecord(validationSnapshot) && isRecord(validationSnapshot.dataset) &&
    isRecord(validationSnapshot.factorSet)
    ? fingerprint({
      request: validationSnapshot.request,
      datasetHash: validationSnapshot.dataset.sha256,
      factorVersion: validationSnapshot.factorSet.version,
      engineVersion: validationSnapshot.engineVersion,
    })
    : "";
  if (preparedFingerprint !== prepared.fingerprint) {
    return { error: "Frozen validation prepared-input fingerprint mismatch.", status: 409 } as const;
  }
  const dataset = isRecord(validationSnapshot) && isRecord(validationSnapshot.dataset)
    ? validationSnapshot.dataset : null;
  if (!dataset || typeof dataset.csvContent !== "string" || typeof dataset.sha256 !== "string" ||
      hashDataset(dataset.csvContent) !== dataset.sha256) {
    return { error: "Selected validation dataset content/hash mismatch.", status: 409 } as const;
  }
  if (allocation.representation !== prepared.representation ||
      (isRecord(policySnapshot) && policySnapshot.representation !== prepared.representation)) {
    return { error: "Policy and validation prepared-input representations must match.", status: 409 } as const;
  }

  const frozenAssumptions = structuredClone(input.assumptions) as B3Assumptions;
  const version = engineVersion(policySnapshot);
  let result: B3Result | { status: "failed"; diagnostic: string };
  try {
    result = runB3Validation(
      policySnapshot as Parameters<typeof runB3Validation>[0],
      policyRequest as Parameters<typeof runB3Validation>[1],
      validationSnapshot as Parameters<typeof runB3Validation>[2],
      frozenAssumptions,
      internalEstimationDatePlan,
    );
  } catch (error) {
    result = {
      status: "failed",
      diagnostic: error instanceof Error ? error.message : "B3 validation engine failed.",
    };
  }
  if (result.status === "completed") {
    const integrityError = statisticalFactorIntegrityError(policyRequest, result);
    if (integrityError) return { error: integrityError, status: 409 } as const;
  }

  const status = resultStatus(result);
  const savedEnvelope: B3ValidationEnvelope = {
    kind: "b3",
    policySnapshot,
    policyRequest,
    validationSnapshot,
    validationPreparedFingerprint: prepared.fingerprint,
    assumptions: frozenAssumptions,
    ...(internalEstimationDatePlan ? { estimationDatePlan: structuredClone(internalEstimationDatePlan) } : {}),
    result: structuredClone(result),
  };
  const inputHash = b3InputHash({
    allocationId: allocation.id,
    validationPreparedInputId: prepared.id,
    policySnapshot,
    policyRequest,
    validationSnapshot,
    assumptions: frozenAssumptions,
    ...(internalEstimationDatePlan ? { estimationDatePlan: internalEstimationDatePlan } : {}),
    engineVersion: version,
    result,
  });
  const [row] = await db.insert(validationRunsTable).values({
    strategySnapshotId: null,
    allocationId: allocation.id,
    validationPreparedInputId: prepared.id,
    datasetHash: dataset.sha256,
    factorSetVersion: isRecord(validationSnapshot) && isRecord(validationSnapshot.factorSet) &&
      typeof validationSnapshot.factorSet.version === "string" ? validationSnapshot.factorSet.version : "none",
    engineVersion: version,
    validatedAt: new Date(),
    assumptions: frozenAssumptions,
    resultJson: savedEnvelope,
    reconciliationStatus: status === "success" ? "pass" : "fail",
    reproducibilityStatus: status === "success" ? "pass" : "fail",
    validationInputHash: inputHash,
  }).returning();
  return { run: toB3ValidationRun(row) } as const;
}

function validInternalPolicyOverride(base: AllocationRequest, override: AllocationRequest): boolean {
  const baseIds = new Set(base.candidateIds);
  if (!Array.isArray(override.candidateIds) || !override.candidateIds.length ||
      new Set(override.candidateIds).size !== override.candidateIds.length ||
      override.candidateIds.some((id) => !baseIds.has(id))) return false;
  const baseConstraints = base.constraints;
  const overrideConstraints = override.constraints;
  if (!baseConstraints || !overrideConstraints) return false;
  const same = (left: unknown, right: unknown) => fingerprint(left) === fingerprint(right);
  const unchanged = { ...base, candidateIds: override.candidateIds, constraints: undefined };
  const supplied = { ...override, constraints: undefined };
  if (!same(unchanged, supplied)) return false;
  const { candidateBounds: _baseBounds, groupCaps: _baseGroups, ...baseOther } = baseConstraints;
  const { candidateBounds: _overrideBounds, groupCaps: _overrideGroups, ...overrideOther } = overrideConstraints;
  if (!same(baseOther, overrideOther)) return false;
  const expectedBounds = Object.fromEntries(Object.entries(baseConstraints.candidateBounds ?? {})
    .filter(([candidateId, bound]) => override.candidateIds.includes(candidateId) || (bound.min ?? 0) > 0));
  if (!same(expectedBounds, overrideConstraints.candidateBounds ?? {})) return false;
  const expectedGroups = (baseConstraints.groupCaps ?? []).map((group) => ({
    ...group,
    candidateIds: group.candidateIds.filter((candidateId) => override.candidateIds.includes(candidateId)),
  }));
  return same(expectedGroups, overrideConstraints.groupCaps ?? []);
}

export async function listB3ValidationRuns(allocationId?: number) {
  const rows = await db.select().from(validationRunsTable)
    .where(allocationId === undefined
      ? isNotNull(validationRunsTable.allocationId)
      : and(isNotNull(validationRunsTable.allocationId), eq(validationRunsTable.allocationId, allocationId)))
    .orderBy(desc(validationRunsTable.id));
  return rows.map((row) => {
    const run = toB3ValidationRun(row);
    return {
      validationRunId: run.validationRunId,
      allocationId: run.allocationId,
      validationPreparedInputId: run.validationPreparedInputId,
      representation: run.representation,
      status: run.status,
      validatedAt: run.validatedAt,
      reproducibilityStatus: run.reproducibilityStatus,
      result: run.result,
      comparisonMetadata: run.comparisonMetadata,
    };
  });
}

export function resultDifferences(saved: unknown, replayed: unknown): string[] {
  const differences: string[] = [];
  const visit = (left: unknown, right: unknown, path: string) => {
    if (differences.length >= 100) return;
    if (typeof left === "number" && typeof right === "number") {
      if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) > 1e-8)
        differences.push(`${path}: saved=${left}, replayed=${right}`);
      return;
    }
    if (Object.is(left, right)) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) differences.push(`${path}.length differs`);
      for (let i = 0; i < Math.min(left.length, right.length); i++) visit(left[i], right[i], `${path}[${i}]`);
      return;
    }
    if (isRecord(left) && isRecord(right)) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of keys) {
        if (!(key in left) || !(key in right)) differences.push(`${path}.${key}: key presence differs`);
        else visit(left[key], right[key], `${path}.${key}`);
      }
      return;
    }
    differences.push(`${path}: saved=${JSON.stringify(left)}, replayed=${JSON.stringify(right)}`);
  };
  // A result loaded from JSONB has undergone the same serialization
  // normalization as the frozen hash; compare it to replay in that form.
  visit(jsonbRoundTrip(saved), jsonbRoundTrip(replayed), "result");
  return differences;
}

export async function replayB3ValidationRun(id: number) {
  const [row] = await db.select().from(validationRunsTable).where(eq(validationRunsTable.id, id)).limit(1);
  if (!row) return null;
  if (row.allocationId === null || row.validationPreparedInputId === null)
    return { validationRunId: id, status: "fail" as const, validationInputHash: row.validationInputHash,
      differences: ["Validation Run is not a B3 run."], replayedResult: {} };
  const frozen = envelope(row);
  const version = engineVersion(frozen.policySnapshot);
  const differences: string[] = [];
  if (version !== row.engineVersion) differences.push(`engine version mismatch: saved=${row.engineVersion}, current=${version}`);
  const dataset = isRecord(frozen.validationSnapshot) && isRecord(frozen.validationSnapshot.dataset)
    ? frozen.validationSnapshot.dataset : null;
  if (!dataset || typeof dataset.csvContent !== "string" || typeof dataset.sha256 !== "string" ||
      hashDataset(dataset.csvContent) !== dataset.sha256)
    differences.push("frozen validation dataset content/hash mismatch");
  const preparedFingerprint = isRecord(frozen.validationSnapshot) && isRecord(frozen.validationSnapshot.dataset) &&
    isRecord(frozen.validationSnapshot.factorSet)
    ? fingerprint({
      request: frozen.validationSnapshot.request,
      datasetHash: frozen.validationSnapshot.dataset.sha256,
      factorVersion: frozen.validationSnapshot.factorSet.version,
      engineVersion: frozen.validationSnapshot.engineVersion,
    })
    : "";
  if (!preparedFingerprint) differences.push("frozen validation prepared-input fingerprint cannot be reconstructed");
  else if (preparedFingerprint !== frozen.validationPreparedFingerprint)
    differences.push("frozen validation prepared-input fingerprint mismatch");
  const hashInput: B3InputHashInput = {
    allocationId: row.allocationId,
    validationPreparedInputId: row.validationPreparedInputId,
    policySnapshot: frozen.policySnapshot,
    policyRequest: frozen.policyRequest,
    validationSnapshot: frozen.validationSnapshot,
    assumptions: frozen.assumptions,
    ...(frozen.estimationDatePlan ? { estimationDatePlan: frozen.estimationDatePlan } : {}),
    engineVersion: row.engineVersion,
    result: frozen.result,
  };
  const expectedHash = b3InputHash(hashInput);
  if (differences.length) return {
    validationRunId: id,
    status: version !== row.engineVersion ? "engine_mismatch" as const : "fail" as const,
    validationInputHash: row.validationInputHash,
    differences,
    replayedResult: {},
  };
  let replayed: B3Result | { status: "failed"; diagnostic: string };
  try {
    replayed = runB3Validation(
      frozen.policySnapshot as Parameters<typeof runB3Validation>[0],
      frozen.policyRequest as Parameters<typeof runB3Validation>[1],
      frozen.validationSnapshot as Parameters<typeof runB3Validation>[2],
      frozen.assumptions,
      frozen.estimationDatePlan,
    );
  } catch (error) {
    replayed = { status: "failed", diagnostic: error instanceof Error ? error.message : "B3 replay failed." };
  }
  if (expectedHash !== row.validationInputHash &&
      !verifyLegacyB3ReplayFingerprint(hashInput, row.validationInputHash, replayed,
        version === row.engineVersion))
    differences.push("persisted B3 validation fingerprint mismatch");
  differences.push(...resultDifferences(frozen.result, replayed));
  return {
    validationRunId: id,
    status: differences.length ? "fail" as const : "pass" as const,
    validationInputHash: row.validationInputHash,
    differences,
    maximumNumericDifference: maximumNumericDifference(jsonbRoundTrip(frozen.result), jsonbRoundTrip(replayed)),
    replayedResult: replayed,
  };
}

export async function getB3ValidationRun(id: number) {
  const [row] = await db.select().from(validationRunsTable).where(eq(validationRunsTable.id, id)).limit(1);
  return row?.allocationId !== null && row?.allocationId !== undefined &&
    row.validationPreparedInputId !== null ? toB3ValidationRun(row) : null;
}