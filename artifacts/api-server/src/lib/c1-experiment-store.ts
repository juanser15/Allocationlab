import { and, desc, eq } from "drizzle-orm";
import {
  allocationsTable, c1ExperimentsTable, db, preparedInputsTable, validationRunsTable,
} from "@workspace/db";
import type { C1ExperimentInput } from "@workspace/api-zod";
import {
  planC1Policies,
  summarizeC1Experiment,
} from "./c1-contribution";
import type { AllocationRequest } from "./allocation-b2";
import type { B3Assumptions, B3Result } from "./b3-policy";
import { canonicalJson, fingerprint, type PreparedCandidate, type PreparedSnapshot } from "./prepared-inputs";
import { hashDataset } from "./run-snapshot";
import {
  persistB3ValidationRun,
  replayB3ValidationRun,
} from "./b3-validation-store";

type C1Plan = {
  label: string;
  excludedCandidateIds: string[];
  policyRequest: AllocationRequest;
};

type ChildRecord = {
  label: string;
  excludedCandidateIds: string[];
  policyRequest: AllocationRequest;
  validationRunId: number | null;
  validationInputHash?: string;
  result: unknown;
};

type C1Manifest = {
  schemaVersion: 1;
  label: "Development comparison — no automatic selection.";
  allocationId: number;
  allocationFingerprint: string;
  allocationPreparedInputId: number;
  validationPreparedInputId: number;
  validationPreparedFingerprint: string;
  validationDatasetHash: string;
  candidateIds: string[];
  validationCandidateIds: Record<string, string>;
  candidateDefinitionsHash: string;
  developmentPeriod: { startDate: string; endDate: string };
  holdoutStartDate?: string;
  assumptions: B3Assumptions;
  mode: C1ExperimentInput["mode"];
  exclusionSets: string[][];
  plans: C1Plan[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function preparedFingerprint(snapshot: unknown): string {
  if (!isRecord(snapshot) || !isRecord(snapshot.dataset) || !isRecord(snapshot.factorSet)) return "";
  return fingerprint({
    request: snapshot.request,
    datasetHash: snapshot.dataset.sha256,
    factorVersion: snapshot.factorSet.version,
    engineVersion: snapshot.engineVersion,
  });
}

function allocationFingerprint(row: typeof allocationsTable.$inferSelect): string {
  const snapshotHash = fingerprint(row.frozenSnapshot);
  return snapshotHash === row.frozenSnapshotHash ? fingerprint({
    preparedInputId: row.preparedInputId,
    representation: row.representation,
    engineVersion: row.engineVersion,
    request: row.frozenRequest,
    snapshotHash,
    result: row.frozenResult,
  }) : "";
}

function sortStable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortStable);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortStable(value[key])]));
  return value;
}

function isSame(left: unknown, right: unknown): boolean {
  return fingerprint(sortStable(left)) === fingerprint(sortStable(right));
}

function candidateDefinition(candidate: PreparedCandidate) {
  const rawDefinition = candidate.lineage.definition;
  const definition = isRecord(rawDefinition) ? { ...rawDefinition } : null;
  if (definition) delete definition.name;
  return {
    kind: candidate.kind,
    factorId: candidate.factorId ?? null,
    assetTickers: candidate.assetTickers,
    mapping: candidate.mapping ?? null,
    signalUnits: candidate.signalUnits ?? null,
    definition,
  };
}

function compatibleCandidateDefinitions(policy: PreparedCandidate, validation: PreparedCandidate): boolean {
  if (policy.kind !== validation.kind ||
      canonicalJson(policy.assetTickers) !== canonicalJson(validation.assetTickers) ||
      policy.factorId !== validation.factorId || policy.mapping !== validation.mapping ||
      policy.signalUnits !== validation.signalUnits) return false;
  if (policy.kind !== "alpha_streams") return true;
  const policyDefinition = policy.lineage.definition;
  const validationDefinition = validation.lineage.definition;
  if (!isRecord(policyDefinition) || !isRecord(validationDefinition)) return false;
  const withoutDisplayName = (value: Record<string, unknown>) => {
    const copy = { ...value };
    delete copy.name;
    return copy;
  };
  return canonicalJson(withoutDisplayName(policyDefinition)) ===
    canonicalJson(withoutDisplayName(validationDefinition));
}

function validatePlan(plan: C1Plan, baseRequest: AllocationRequest, knownIds: Set<string>): string | null {
  if (!plan || typeof plan.label !== "string" || !plan.label.trim() ||
      !Array.isArray(plan.excludedCandidateIds) || !plan.policyRequest)
    return "C1 planner returned an invalid policy plan.";
  const excluded = new Set(plan.excludedCandidateIds);
  if (excluded.size !== plan.excludedCandidateIds.length ||
      plan.excludedCandidateIds.some((candidateId) => !knownIds.has(candidateId)))
    return "C1 planner returned an unknown or duplicate canonical candidate exclusion.";
  const expectedIds = baseRequest.candidateIds.filter((candidateId) => !excluded.has(candidateId));
  if (!expectedIds.length || !isSame(expectedIds, plan.policyRequest.candidateIds))
    return "C1 planner policy request is not the requested canonical candidate subset.";

  const original = baseRequest.constraints;
  const reduced = plan.policyRequest.constraints;
  if (!original || !reduced) return "C1 policy request is missing its frozen constraints.";
  const originalOther = { ...original, candidateBounds: undefined, groupCaps: undefined };
  const reducedOther = { ...reduced, candidateBounds: undefined, groupCaps: undefined };
  if (!isSame(originalOther, reducedOther))
    return "C1 policy plan changed non-candidate allocation constraints.";
  const expectedBounds = Object.fromEntries(Object.entries(original.candidateBounds ?? {})
    .filter(([id, bound]) => expectedIds.includes(id) || (bound.min ?? 0) > 0));
  if (!isSame(expectedBounds, reduced.candidateBounds ?? {}))
    return "C1 policy plan changed a retained candidate bound.";
  const expectedGroups = (original.groupCaps ?? []).map((group) => ({
    ...group,
    candidateIds: group.candidateIds.filter((id) => expectedIds.includes(id)),
  }));
  if (!isSame(expectedGroups, reduced.groupCaps ?? []))
    return "C1 policy plan changed or broadened a frozen candidate group constraint.";
  const baseWithoutMutableFields = { ...baseRequest, candidateIds: undefined, constraints: undefined };
  const plannedWithoutMutableFields = { ...plan.policyRequest, candidateIds: undefined, constraints: undefined };
  if (!isSame(baseWithoutMutableFields, plannedWithoutMutableFields))
    return "C1 policy plan changed frozen B2 assumptions.";
  return null;
}

function resultAsB3Result(result: unknown): result is B3Result {
  return isRecord(result) && (result.status === "completed" || result.status === "failed") &&
    isRecord(result.policyIdentity) && isRecord(result.assumptions) && Array.isArray(result.dailyLedger);
}

function response(row: typeof c1ExperimentsTable.$inferSelect) {
  const children = Array.isArray(row.childResultsJson) ? row.childResultsJson as ChildRecord[] : [];
  return {
    id: row.id,
    allocationId: row.allocationId,
    validationPreparedInputId: row.validationPreparedInputId,
    mode: row.mode,
    manifestHash: row.manifestHash,
    inputHash: row.inputHash,
    manifest: row.manifestJson,
    status: row.status,
    plannedPolicyCount: row.plannedPolicyCount,
    actualPolicyCount: row.actualPolicyCount,
    children,
    summary: row.summaryJson,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export async function persistC1Experiment(input: C1ExperimentInput) {
  const [allocation] = await db.select().from(allocationsTable)
    .where(eq(allocationsTable.id, input.allocationId)).limit(1);
  if (!allocation) return { error: "Frozen allocation policy not found.", status: 404 } as const;
  const [prepared] = await db.select().from(preparedInputsTable)
    .where(eq(preparedInputsTable.id, input.validationPreparedInputId)).limit(1);
  if (!prepared) return { error: "Frozen validation prepared input not found.", status: 404 } as const;

  const allocationHash = allocationFingerprint(allocation);
  if (!allocationHash || allocationHash !== allocation.fingerprint)
    return { error: "Frozen allocation policy fingerprint mismatch.", status: 409 } as const;
  const policySnapshot = structuredClone(allocation.frozenSnapshot) as PreparedSnapshot;
  const basePolicyRequest = structuredClone(allocation.frozenRequest) as AllocationRequest;
  const validationSnapshot = structuredClone(prepared.snapshot) as PreparedSnapshot;
  const validationFp = preparedFingerprint(validationSnapshot);
  if (!validationFp || validationFp !== prepared.fingerprint)
    return { error: "Frozen validation prepared-input fingerprint mismatch.", status: 409 } as const;
  if (!validationSnapshot.dataset?.csvContent ||
      hashDataset(validationSnapshot.dataset.csvContent) !== validationSnapshot.dataset.sha256)
    return { error: "Selected validation dataset content/hash mismatch.", status: 409 } as const;
  if (allocation.representation !== "alpha_streams" || prepared.representation !== "alpha_streams" ||
      policySnapshot.representation !== "alpha_streams" || validationSnapshot.representation !== "alpha_streams")
    return { error: "C1 requires a frozen alpha-stream B2 allocation and alpha-stream B1 validation preparation.", status: 409 } as const;
  if (basePolicyRequest.preparedInputId !== allocation.preparedInputId ||
      basePolicyRequest.representation !== allocation.representation)
    return { error: "Frozen B2 request metadata does not match its saved allocation.", status: 409 } as const;

  const baselineIds = [...basePolicyRequest.candidateIds];
  if (!baselineIds.length || new Set(baselineIds).size !== baselineIds.length)
    return { error: "Frozen allocation does not contain unique canonical candidate IDs.", status: 409 } as const;
  const policyCandidates = new Map(policySnapshot.candidates.map((candidate) => [candidate.candidateId, candidate]));
  const validationCandidatesByPolicyId = new Map<string, PreparedCandidate>();
  for (const candidateId of baselineIds) {
    const policyCandidate = policyCandidates.get(candidateId);
    if (!policyCandidate || policyCandidate.canonicalFingerprint !== candidateId ||
        policyCandidate.diagnostics.duplicateOf)
      return { error: `Canonical policy candidate ${candidateId} is absent or inconsistent in the frozen B2 input.`, status: 409 } as const;
    const matches = validationSnapshot.candidates.filter((candidate) =>
      candidate.candidateId === candidate.canonicalFingerprint && !candidate.diagnostics.duplicateOf &&
      compatibleCandidateDefinitions(policyCandidate, candidate));
    if (matches.length !== 1)
      return { error: `Canonical policy candidate ${candidateId} maps to ${matches.length} compatible frozen validation candidates; exactly one is required.`, status: 409 } as const;
    validationCandidatesByPolicyId.set(candidateId, matches[0]);
  }

  const assumptions = structuredClone(input.assumptions) as B3Assumptions;
  if (input.holdoutStartDate && assumptions.evaluationEndDate >= input.holdoutStartDate)
    return { error: "Development evaluation must end before the reserved holdout start date.", status: 422 } as const;
  if (assumptions.evaluationStartDate > assumptions.evaluationEndDate)
    return { error: "Development evaluation start date must not follow its end date.", status: 422 } as const;

  let plans: C1Plan[];
  try {
    plans = planC1Policies(policySnapshot, basePolicyRequest, assumptions, {
      mode: input.mode,
      exclusionSets: structuredClone(input.exclusionSets),
      ...(input.holdoutStartDate ? { holdoutStartDate: input.holdoutStartDate } : {}),
    }) as C1Plan[];
  } catch (error) {
    return { error: error instanceof Error ? error.message : "C1 policy planning failed.", status: 422 } as const;
  }
  if (!Array.isArray(plans) || plans.length < 2 || plans.length > 6)
    return { error: `C1 requires a baseline and at most five distinct variants; planner returned ${Array.isArray(plans) ? plans.length : "an invalid count"}.`, status: 422 } as const;
  if (plans[0].excludedCandidateIds.length !== 0)
    return { error: "C1 planner must return the unchanged full-policy baseline first.", status: 422 } as const;
  const planErrors = plans.map((plan) => validatePlan(plan, basePolicyRequest, new Set(baselineIds))).filter(Boolean);
  if (planErrors.length) return { error: planErrors[0]!, status: 422 } as const;
  const uniqueVariants = new Set(plans.map((plan) => fingerprint([...plan.excludedCandidateIds].sort())));
  if (uniqueVariants.size !== plans.length)
    return { error: "C1 planner returned duplicate exclusion policies.", status: 422 } as const;

  const manifest: C1Manifest = {
    schemaVersion: 1,
    label: "Development comparison — no automatic selection.",
    allocationId: allocation.id,
    allocationFingerprint: allocation.fingerprint,
    allocationPreparedInputId: allocation.preparedInputId,
    validationPreparedInputId: prepared.id,
    validationPreparedFingerprint: prepared.fingerprint,
    validationDatasetHash: validationSnapshot.dataset.sha256,
    candidateIds: baselineIds,
    validationCandidateIds: Object.fromEntries(baselineIds.map((id) =>
      [id, validationCandidatesByPolicyId.get(id)!.candidateId])),
    candidateDefinitionsHash: fingerprint(baselineIds.map((id) => {
      const candidate = policyCandidates.get(id);
      return candidate ? { policyCandidateId: id, definition: candidateDefinition(candidate) } : null;
    })),
    developmentPeriod: {
      startDate: assumptions.evaluationStartDate,
      endDate: assumptions.evaluationEndDate,
    },
    ...(input.holdoutStartDate ? { holdoutStartDate: input.holdoutStartDate } : {}),
    assumptions,
    mode: input.mode,
    exclusionSets: structuredClone(input.exclusionSets),
    plans: structuredClone(plans),
  };
  const manifestHash = fingerprint(manifest);
  const inputHash = fingerprint({
    manifestHash,
    allocationFingerprint: allocation.fingerprint,
    validationPreparedFingerprint: prepared.fingerprint,
    policySnapshotHash: fingerprint(policySnapshot),
    validationDatasetHash: validationSnapshot.dataset.sha256,
  });
  const [created] = await db.insert(c1ExperimentsTable).values({
    allocationId: allocation.id,
    validationPreparedInputId: prepared.id,
    mode: input.mode,
    manifestHash,
    inputHash,
    manifestJson: manifest,
    childValidationRunIds: [],
    childResultsJson: [],
    summaryJson: null,
    status: "running",
    plannedPolicyCount: plans.length,
    actualPolicyCount: 0,
  }).returning();
  if (!created) return { error: "C1 experiment manifest could not be persisted.", status: 500 } as const;

  const children: ChildRecord[] = [];
  let summary: unknown = null;
  let status: "completed" | "partial" | "failed" = "completed";
  let activePlan: C1Plan | null = null;
  let successfulPolicies = 0;
  try {
    for (const [index, plan] of plans.entries()) {
      activePlan = plan;
      await db.update(c1ExperimentsTable).set({
        actualPolicyCount: index + 1,
        childResultsJson: structuredClone(children),
      }).where(eq(c1ExperimentsTable.id, created.id));
      const saved = await persistB3ValidationRun({
        allocationId: allocation.id,
        validationPreparedInputId: prepared.id,
        assumptions,
      }, plan.policyRequest);
      if ("error" in saved) {
        children.push({
          label: plan.label,
          excludedCandidateIds: plan.excludedCandidateIds,
          policyRequest: plan.policyRequest,
          validationRunId: null,
          result: { status: "failed", diagnostic: saved.error },
        });
      } else {
        children.push({
          label: plan.label,
          excludedCandidateIds: plan.excludedCandidateIds,
          policyRequest: plan.policyRequest,
          validationRunId: saved.run.validationRunId,
          validationInputHash: saved.run.validationInputHash,
          result: saved.run.result,
        });
        if (saved.run.status === "success") successfulPolicies++;
      }
      activePlan = null;
      await db.update(c1ExperimentsTable).set({
        childValidationRunIds: children.flatMap((child) => child.validationRunId === null ? [] : [child.validationRunId]),
        childResultsJson: structuredClone(children),
      }).where(eq(c1ExperimentsTable.id, created.id));
    }
    status = successfulPolicies === 0 ? "failed"
      : successfulPolicies < plans.length ? "partial" : "completed";
    const summaryChildren = children.flatMap((child) =>
      resultAsB3Result(child.result) ? [{
        label: child.label,
        excludedCandidateIds: child.excludedCandidateIds,
        result: child.result,
      }] : []);
    if (summaryChildren.length && summaryChildren.length === children.length &&
        summaryChildren[0].excludedCandidateIds.length === 0) {
      try {
        summary = summarizeC1Experiment(summaryChildren, baselineIds);
      } catch (error) {
        status = "failed";
        summary = { diagnostic: error instanceof Error ? error.message : "C1 comparison summary failed." };
      }
    }
    if (children.length < plans.length) status = "failed";
  } catch (error) {
    status = "failed";
    if (activePlan) children.push({
      label: activePlan.label,
      excludedCandidateIds: activePlan.excludedCandidateIds,
      policyRequest: activePlan.policyRequest,
      validationRunId: null,
      result: { status: "failed", diagnostic: error instanceof Error ? error.message : "C1 execution failed." },
    });
  }

  await db.update(c1ExperimentsTable).set({
    childValidationRunIds: children.flatMap((child) => child.validationRunId === null ? [] : [child.validationRunId]),
    childResultsJson: structuredClone(children),
    actualPolicyCount: children.length,
    summaryJson: summary,
    status,
    completedAt: new Date(),
  }).where(eq(c1ExperimentsTable.id, created.id));
  const [saved] = await db.select().from(c1ExperimentsTable)
    .where(eq(c1ExperimentsTable.id, created.id)).limit(1);
  return saved ? { experiment: response(saved) } as const
    : { error: "C1 experiment was saved but could not be reloaded.", status: 500 } as const;
}

export async function listC1Experiments() {
  const rows = await db.select().from(c1ExperimentsTable)
    .orderBy(desc(c1ExperimentsTable.createdAt), desc(c1ExperimentsTable.id));
  return rows.map(response);
}

export async function getC1Experiment(id: number) {
  const [row] = await db.select().from(c1ExperimentsTable)
    .where(eq(c1ExperimentsTable.id, id)).limit(1);
  return row ? response(row) : null;
}

export async function replayC1Experiment(id: number) {
  const [row] = await db.select().from(c1ExperimentsTable).where(eq(c1ExperimentsTable.id, id)).limit(1);
  if (!row) return null;
  const differences: string[] = [];
  if (!isRecord(row.manifestJson) || !Array.isArray(row.childResultsJson) || !Array.isArray(row.childValidationRunIds)) {
    return {
      experimentId: id,
      status: "fail" as const,
      inputHash: row.inputHash,
      differences: ["persisted C1 manifest or child collection has an invalid shape"],
      childReplays: [],
    };
  }
  const manifest = row.manifestJson as C1Manifest;
  const actualManifestHash = fingerprint(manifest);
  if (actualManifestHash !== row.manifestHash) differences.push("frozen C1 manifest fingerprint mismatch");
  const [allocation] = await db.select().from(allocationsTable)
    .where(eq(allocationsTable.id, row.allocationId)).limit(1);
  const [prepared] = await db.select().from(preparedInputsTable)
    .where(eq(preparedInputsTable.id, row.validationPreparedInputId)).limit(1);
  if (!allocation || allocationFingerprint(allocation) !== manifest.allocationFingerprint ||
      allocation.fingerprint !== manifest.allocationFingerprint)
    differences.push("frozen B2 allocation reference or fingerprint mismatch");
  if (!prepared || prepared.fingerprint !== manifest.validationPreparedFingerprint ||
      preparedFingerprint(prepared.snapshot) !== manifest.validationPreparedFingerprint)
    differences.push("frozen B1 validation preparation reference or fingerprint mismatch");
  const currentDataset = prepared && isRecord(prepared.snapshot) && isRecord(prepared.snapshot.dataset)
    ? prepared.snapshot.dataset : null;
  if (!currentDataset || typeof currentDataset.csvContent !== "string" ||
      currentDataset.sha256 !== manifest.validationDatasetHash ||
      hashDataset(currentDataset.csvContent) !== currentDataset.sha256)
    differences.push("frozen C1 validation dataset content/hash mismatch");
  const currentInputHash = fingerprint({
    manifestHash: actualManifestHash,
    allocationFingerprint: manifest.allocationFingerprint,
    validationPreparedFingerprint: manifest.validationPreparedFingerprint,
    policySnapshotHash: allocation ? fingerprint(allocation.frozenSnapshot) : "",
    validationDatasetHash: manifest.validationDatasetHash,
  });
  if (currentInputHash !== row.inputHash) differences.push("persisted C1 input fingerprint mismatch");

  const children = Array.isArray(row.childResultsJson) ? row.childResultsJson as ChildRecord[] : [];
  const ids = Array.isArray(row.childValidationRunIds) ? row.childValidationRunIds as number[] : [];
  if (ids.length !== children.filter((child) => child.validationRunId !== null).length)
    differences.push("persisted C1 child ID manifest mismatch");
  const manifestPlans = Array.isArray(manifest.plans) ? manifest.plans : [];
  if (!Array.isArray(manifest.plans) || manifestPlans.length !== row.plannedPolicyCount)
    differences.push("planned C1 policy count does not match the frozen manifest");
  if (row.actualPolicyCount !== children.length)
    differences.push("actual C1 policy count does not match the persisted child outcomes");
  if (children.length > manifestPlans.length)
    differences.push("persisted C1 child outcomes exceed the frozen policy manifest");
  const childReplays: unknown[] = [];
  for (const [index, child] of children.entries()) {
    const planned = manifestPlans[index];
    if (!planned || planned.label !== child.label ||
        !isSame(planned.excludedCandidateIds, child.excludedCandidateIds) ||
        !isSame(planned.policyRequest, child.policyRequest))
      differences.push(`persisted C1 child ${index + 1} does not match the frozen policy plan`);
    if (child.validationRunId === null) {
      childReplays.push({ validationRunId: null, status: "fail", differences: ["child B3 Validation Run was not persisted"] });
      continue;
    }
    const [run] = await db.select().from(validationRunsTable)
      .where(and(eq(validationRunsTable.id, child.validationRunId), eq(validationRunsTable.allocationId, row.allocationId)))
      .limit(1);
    if (!run || run.validationPreparedInputId !== row.validationPreparedInputId) {
      differences.push(`child Validation Run ${child.validationRunId} reference mismatch`);
      childReplays.push({ validationRunId: child.validationRunId, status: "fail", differences: ["child reference mismatch"] });
      continue;
    }
    const envelope = isRecord(run.resultJson) ? run.resultJson : {};
    if (!isSame(envelope.policyRequest, child.policyRequest))
      differences.push(`child Validation Run ${child.validationRunId} frozen policy request mismatch`);
    if (run.validationInputHash !== child.validationInputHash)
      differences.push(`child Validation Run ${child.validationRunId} input hash mismatch`);
    childReplays.push(await replayB3ValidationRun(child.validationRunId));
  }
  const replayStatus = childReplays.some((child) => isRecord(child) && child.status === "engine_mismatch")
    ? "engine_mismatch" : differences.length || childReplays.some((child) => isRecord(child) && child.status !== "pass")
      ? "fail" : "pass";
  return {
    experimentId: id,
    status: replayStatus,
    inputHash: row.inputHash,
    differences,
    childReplays,
  };
}