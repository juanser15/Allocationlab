import { desc, eq } from "drizzle-orm";
import {
  allocationsTable, c1ExperimentsTable, db, preparedInputsTable, validationRunsTable,
} from "@workspace/db";
import type { C1ExperimentInput } from "@workspace/api-zod";
import {
  planC1Policies,
  summarizeC1Experiment,
} from "./c1-contribution";
import type { AllocationRequest } from "./allocation-b2";
import {
  C1_ESTIMATION_ALIGNMENT_RULE,
  runB3Validation,
  type B3Assumptions,
  type B3EstimationDatePlan,
  type B3Result,
} from "./b3-policy";
import { canonicalJson, fingerprint, type PreparedCandidate, type PreparedSnapshot } from "./prepared-inputs";
import { hashDataset } from "./run-snapshot";
import {
  persistB3ValidationRun,
  replayB3ValidationRun,
} from "./b3-validation-store";
import {
  compareC1ReplayChildren,
  differenceObjects,
  formatC1IntegrityDifference,
  recomputeAndCompareC1Summary,
} from "./c1-replay-integrity";

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
  // Absent only on immutable historical experiments created before T2 alignment.
  alignmentPlan?: B3EstimationDatePlan;
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

function c1AlignmentMatches(result: B3Result, plan: B3EstimationDatePlan): boolean {
  const expected = new Map(plan.decisions.map((decision) => [decision.decisionDate, decision]));
  for (const decision of result.decisions) {
    const aligned = expected.get(decision.decisionDate);
    if (!aligned || aligned.failureReason || aligned.observationCount !== decision.estimationDates.length ||
        !isSame(aligned.estimationDates, decision.estimationDates))
      return false;
  }
  const firstFailure = plan.decisions.find((decision) => decision.failureReason);
  if (firstFailure && result.failureDate && result.failureDate !== firstFailure.decisionDate)
    return false;
  return true;
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

  let referenceResult: B3Result;
  try {
    referenceResult = runB3Validation(policySnapshot, basePolicyRequest, validationSnapshot, assumptions);
  } catch (error) {
    return { error: `Full-baseline C1 alignment preparation failed: ${error instanceof Error ? error.message : String(error)}`,
      status: 422 } as const;
  }
  const referenceDecisions = new Map(referenceResult.decisions.map((decision) => [decision.decisionDate, decision]));
  const referenceCalendar = referenceResult.decisionCalendar;
  const firstUnsolvedIndex = referenceCalendar.findIndex((item) => !referenceDecisions.has(item.decisionDate));
  const failureCalendarIndex = referenceResult.status === "failed"
    ? firstUnsolvedIndex >= 0 ? firstUnsolvedIndex
      : referenceCalendar.findIndex((item) => item.decisionDate >= (referenceResult.failureDate ?? ""))
    : -1;
  const referenceFailureDate = failureCalendarIndex >= 0
    ? referenceCalendar[failureCalendarIndex].decisionDate : referenceResult.failureDate;
  const referenceFailureReason = referenceResult.status === "failed"
    ? referenceResult.reason ?? `Full-baseline B3 failed at ${referenceFailureDate ?? assumptions.evaluationStartDate}.`
    : undefined;
  const alignmentPlan: B3EstimationDatePlan = {
    rule: C1_ESTIMATION_ALIGNMENT_RULE,
    referenceCandidateIds: [...basePolicyRequest.candidateIds],
    decisions: referenceCalendar.map((item, index) => {
      const decision = failureCalendarIndex < 0 || index < failureCalendarIndex
        ? referenceDecisions.get(item.decisionDate) : undefined;
      if (decision) return {
        decisionDate: item.decisionDate,
        informationCutoff: decision.informationCutoff,
        estimationDates: [...decision.estimationDates],
        observationCount: decision.estimationDates.length,
      };
      const cutoff = validationSnapshot.dataset.csvContent.trimEnd().split(/\r?\n/)
        .slice(1).map((line) => line.split(",")[0].replace(/^"|"$/g, ""))
        .filter((date) => date < item.decisionDate).at(-1) ?? "";
      return {
        decisionDate: item.decisionDate,
        informationCutoff: cutoff,
        estimationDates: [],
        observationCount: 0,
        failureReason: referenceFailureReason ??
          `Full-baseline reference did not produce a B2 estimate at ${item.decisionDate}.`,
      };
    }),
  };

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
    alignmentPlan: structuredClone(alignmentPlan),
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
      }, plan.policyRequest, alignmentPlan);
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
        children.every((child) => resultAsB3Result(child.result) &&
          c1AlignmentMatches(child.result, alignmentPlan)) &&
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
  const addDifferences = (expected: unknown, observed: unknown, root: string) => {
    differences.push(...differenceObjects(expected, observed, { root })
      .map(formatC1IntegrityDifference));
  };
  const actualManifestHash = fingerprint(manifest);
  addDifferences(row.manifestHash, actualManifestHash, "manifestHash");
  const [allocation] = await db.select().from(allocationsTable)
    .where(eq(allocationsTable.id, row.allocationId)).limit(1);
  const [prepared] = await db.select().from(preparedInputsTable)
    .where(eq(preparedInputsTable.id, row.validationPreparedInputId)).limit(1);
  const allocationHash = allocation ? allocationFingerprint(allocation) : "";
  addDifferences({
    allocationId: row.allocationId,
    allocationFingerprint: allocation?.fingerprint ?? null,
    reconstructedAllocationFingerprint: allocationHash,
    preparedInputId: allocation?.preparedInputId ?? null,
  }, {
    allocationId: manifest.allocationId,
    allocationFingerprint: manifest.allocationFingerprint,
    reconstructedAllocationFingerprint: manifest.allocationFingerprint,
    preparedInputId: manifest.allocationPreparedInputId,
  }, "manifest.allocationReference");
  const currentPreparedFingerprint = prepared ? preparedFingerprint(prepared.snapshot) : "";
  addDifferences({
    validationPreparedInputId: row.validationPreparedInputId,
    fingerprint: prepared?.fingerprint ?? null,
    reconstructedFingerprint: currentPreparedFingerprint,
  }, {
    validationPreparedInputId: manifest.validationPreparedInputId,
    fingerprint: manifest.validationPreparedFingerprint,
    reconstructedFingerprint: manifest.validationPreparedFingerprint,
  }, "manifest.validationPreparation");
  const currentDataset = prepared && isRecord(prepared.snapshot) && isRecord(prepared.snapshot.dataset)
    ? prepared.snapshot.dataset : null;
  const actualDatasetHash = currentDataset && typeof currentDataset.csvContent === "string"
    ? hashDataset(currentDataset.csvContent) : null;
  addDifferences({
    manifestDatasetHash: manifest.validationDatasetHash,
    preparedDatasetHash: currentDataset?.sha256 ?? null,
    calculatedDatasetHash: actualDatasetHash,
  }, {
    manifestDatasetHash: manifest.validationDatasetHash,
    preparedDatasetHash: manifest.validationDatasetHash,
    calculatedDatasetHash: manifest.validationDatasetHash,
  }, "manifest.validationDataset");
  const currentInputHash = fingerprint({
    manifestHash: actualManifestHash,
    allocationFingerprint: manifest.allocationFingerprint,
    validationPreparedFingerprint: manifest.validationPreparedFingerprint,
    policySnapshotHash: allocation ? fingerprint(allocation.frozenSnapshot) : "",
    validationDatasetHash: manifest.validationDatasetHash,
  });
  addDifferences(row.inputHash, currentInputHash, "inputHash");

  const children = Array.isArray(row.childResultsJson) ? row.childResultsJson as ChildRecord[] : [];
  const ids = Array.isArray(row.childValidationRunIds) ? row.childValidationRunIds as number[] : [];
  const actualChildIds = children.flatMap((child) =>
    child && child.validationRunId !== null ? [child.validationRunId] : []);
  addDifferences(actualChildIds, ids, "childValidationRunIds");
  const manifestPlans = Array.isArray(manifest.plans) ? manifest.plans : [];
  addDifferences(row.plannedPolicyCount, manifestPlans.length, "plannedPolicyCount");
  addDifferences(row.actualPolicyCount, children.length, "actualPolicyCount");

  if (!manifest.alignmentPlan)
    differences.push("UNVERIFIED/NON-COMPARABLE: frozen C1 alignmentPlan is absent; legacy replay cannot be VERIFIED.");
  if (manifest.alignmentPlan) {
    addDifferences(C1_ESTIMATION_ALIGNMENT_RULE, manifest.alignmentPlan.rule, "manifest.alignmentPlan.rule");
    addDifferences(manifest.candidateIds, manifest.alignmentPlan.referenceCandidateIds,
      "manifest.alignmentPlan.referenceCandidateIds");
  }

  if (!allocation || !prepared || !isRecord(allocation.frozenSnapshot) ||
      !isRecord(prepared.snapshot) || !isRecord(allocation.frozenRequest)) {
    differences.push("Frozen allocation/preparation inputs are unavailable; canonical C1 plans cannot be reconstructed.");
  } else {
    const policySnapshot = allocation.frozenSnapshot as unknown as PreparedSnapshot;
    const validationSnapshot = prepared.snapshot as unknown as PreparedSnapshot;
    const basePolicyRequest = allocation.frozenRequest as unknown as AllocationRequest;
    const baselineIds = [...basePolicyRequest.candidateIds];
    const expectedValidationCandidateIds: Record<string, string> = {};
    for (const candidateId of baselineIds) {
      const policyCandidate = policySnapshot.candidates.find((candidate) => candidate.candidateId === candidateId);
      const compatible = policyCandidate ? validationSnapshot.candidates.filter((candidate) =>
        candidate.candidateId === candidate.canonicalFingerprint && !candidate.diagnostics.duplicateOf &&
        compatibleCandidateDefinitions(policyCandidate, candidate)) : [];
      if (compatible.length === 1) expectedValidationCandidateIds[candidateId] = compatible[0].candidateId;
      addDifferences(1, compatible.length, `manifest.validationCandidateIds.${candidateId}.compatibleCandidateCount`);
    }
    addDifferences({
      allocationId: row.allocationId,
      allocationPreparedInputId: allocation.preparedInputId,
      validationPreparedInputId: prepared.id,
      candidateIds: baselineIds,
      validationCandidateIds: expectedValidationCandidateIds,
      candidateDefinitionsHash: fingerprint(baselineIds.map((candidateId) => {
        const candidate = policySnapshot.candidates.find((item) => item.candidateId === candidateId);
        return candidate ? { policyCandidateId: candidateId, definition: candidateDefinition(candidate) } : null;
      })),
      developmentPeriod: {
        startDate: manifest.assumptions?.evaluationStartDate,
        endDate: manifest.assumptions?.evaluationEndDate,
      },
      rowMode: row.mode,
      holdoutConstraint: manifest.holdoutStartDate === undefined
        ? null
        : manifest.assumptions?.evaluationEndDate < manifest.holdoutStartDate,
    }, {
      allocationId: manifest.allocationId,
      allocationPreparedInputId: manifest.allocationPreparedInputId,
      validationPreparedInputId: manifest.validationPreparedInputId,
      candidateIds: manifest.candidateIds,
      validationCandidateIds: manifest.validationCandidateIds,
      candidateDefinitionsHash: manifest.candidateDefinitionsHash,
      developmentPeriod: manifest.developmentPeriod,
      rowMode: manifest.mode,
      holdoutConstraint: manifest.holdoutStartDate === undefined
        ? null
        : typeof manifest.holdoutStartDate === "string" &&
          manifest.assumptions?.evaluationEndDate < manifest.holdoutStartDate,
    }, "manifest");

    let reconstructedPlans: C1Plan[] = [];
    try {
      reconstructedPlans = planC1Policies(policySnapshot, basePolicyRequest, manifest.assumptions, {
        mode: manifest.mode,
        exclusionSets: manifest.exclusionSets,
        ...(manifest.holdoutStartDate ? { holdoutStartDate: manifest.holdoutStartDate } : {}),
      }) as C1Plan[];
    } catch (error) {
      differences.push(`manifest.plans: expected canonical plans from frozen inputs; observed reconstruction error=${JSON.stringify(
        error instanceof Error ? error.message : String(error))}`);
    }
    addDifferences(reconstructedPlans, manifestPlans, "manifest.plans");
  }

  if (manifest.assumptions) {
    addDifferences({
      startDate: manifest.assumptions.evaluationStartDate,
      endDate: manifest.assumptions.evaluationEndDate,
      holdoutStartDate: manifest.holdoutStartDate ?? null,
    }, {
      startDate: manifest.developmentPeriod?.startDate,
      endDate: manifest.developmentPeriod?.endDate,
      holdoutStartDate: manifest.holdoutStartDate ?? null,
    }, "manifest.period");
    if (manifest.holdoutStartDate &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.holdoutStartDate) ||
         manifest.assumptions.evaluationEndDate >= manifest.holdoutStartDate))
      differences.push(`manifest.holdoutStartDate: expected a valid date after development end ${JSON.stringify(manifest.assumptions.evaluationEndDate)}, observed=${JSON.stringify(manifest.holdoutStartDate)}`);
  }

  const childReplays: unknown[] = [];
  const verifiedSummaryChildren: Array<{ label: string; excludedCandidateIds: string[]; result: B3Result }> = [];
  const planPolicySnapshot = allocation && isRecord(allocation.frozenSnapshot)
    ? allocation.frozenSnapshot as unknown as PreparedSnapshot : null;
  const basePolicyRequest = allocation && isRecord(allocation.frozenRequest)
    ? allocation.frozenRequest as unknown as AllocationRequest : null;
  const preparedSnapshot = prepared && isRecord(prepared.snapshot)
    ? prepared.snapshot as unknown as PreparedSnapshot : null;
  const baselineIds = basePolicyRequest?.candidateIds ?? manifest.candidateIds ?? [];
  const alignmentDifferences = (result: B3Result, plan: B3EstimationDatePlan, root: string) => {
    const findings: string[] = [];
    const plannedDates = plan.decisions.map((item) => item.decisionDate);
    const calendarDates = result.decisionCalendar.map((item) => item.decisionDate);
    findings.push(...differenceObjects(plannedDates, calendarDates, {
      root: `${root}.decisionCalendar`,
    }).map(formatC1IntegrityDifference));
    const resultDecisions = new Map(result.decisions.map((decision) => [decision.decisionDate, decision]));
    for (const [decisionIndex, aligned] of plan.decisions.entries()) {
      const actual = resultDecisions.get(aligned.decisionDate);
      if (aligned.failureReason) {
        if (actual)
          findings.push(...differenceObjects(undefined, {
            informationCutoff: actual.informationCutoff,
            estimationDates: actual.estimationDates,
          }, { root: `${root}.decisions[${decisionIndex}]` }).map(formatC1IntegrityDifference));
      } else if (!actual) {
        findings.push(...differenceObjects({
          decisionDate: aligned.decisionDate,
          informationCutoff: aligned.informationCutoff,
          estimationDates: aligned.estimationDates,
          observationCount: aligned.observationCount,
        }, undefined, { root: `${root}.decisions[${decisionIndex}]` }).map(formatC1IntegrityDifference));
      } else {
        findings.push(...differenceObjects({
          decisionDate: aligned.decisionDate,
          informationCutoff: aligned.informationCutoff,
          estimationDates: aligned.estimationDates,
          observationCount: aligned.observationCount,
        }, {
          decisionDate: actual.decisionDate,
          informationCutoff: actual.informationCutoff,
          estimationDates: actual.estimationDates,
          observationCount: actual.estimationDates.length,
        }, { root: `${root}.decisions[${decisionIndex}]` }).map(formatC1IntegrityDifference));
      }
    }
    const expectedAlignmentFailure = plan.decisions.find((item) => item.failureReason)?.decisionDate ?? null;
    if (expectedAlignmentFailure !== null)
      findings.push(...differenceObjects(expectedAlignmentFailure, result.failureDate ?? null, {
        root: `${root}.failureDate`,
      }).map(formatC1IntegrityDifference));
    return findings;
  };
  if (children.length !== manifestPlans.length)
    differences.push(`children.length: expected=${manifestPlans.length}, observed=${children.length}`);
  for (const [index, child] of children.entries()) {
    const planned = manifestPlans[index];
    if (!isRecord(child)) {
      differences.push(`children[${index}]: expected a C1 child record, observed=${JSON.stringify(child)}`);
      childReplays.push({ validationRunId: null, status: "fail", differences: ["invalid child record"] });
      continue;
    }
    addDifferences(planned ?? undefined, {
      label: child.label,
      excludedCandidateIds: child.excludedCandidateIds,
      policyRequest: child.policyRequest,
    }, `children[${index}].plan`);
    if (child.validationRunId === null) {
      const failure = isRecord(child.result) && child.result.status === "failed";
      if (!failure)
        differences.push(`children[${index}].result.status: expected="failed" when validationRunId is null, observed=${JSON.stringify(isRecord(child.result) ? child.result.status : child.result)}`);
      childReplays.push({
        validationRunId: null,
        status: "fail",
        differences: ["child B3 Validation Run was not persisted; recorded failed-child outcome preserved, but this chain cannot be VERIFIED."],
      });
      continue;
    }
    const [run] = await db.select().from(validationRunsTable)
      .where(eq(validationRunsTable.id, child.validationRunId))
      .limit(1);
    if (!run) {
      differences.push(`children[${index}].validationRunId: expected an existing original B3 run, observed=${child.validationRunId}`);
      childReplays.push({ validationRunId: child.validationRunId, status: "fail", differences: ["child reference does not resolve to a saved B3 run"] });
      continue;
    }
    const envelope = isRecord(run.resultJson) ? run.resultJson : {};
    const childExpected = {
      label: planned?.label,
      excludedCandidateIds: planned?.excludedCandidateIds,
      policyRequest: planned?.policyRequest,
      validationRunId: run.id,
      validationInputHash: run.validationInputHash,
      result: envelope.result,
    };
    const childObserved = {
      label: child.label,
      excludedCandidateIds: child.excludedCandidateIds,
      policyRequest: child.policyRequest,
      validationRunId: child.validationRunId,
      validationInputHash: child.validationInputHash,
      result: child.result,
    };
    differences.push(...compareC1ReplayChildren([childExpected], [childObserved])
      .map(formatC1IntegrityDifference));
    addDifferences({
      id: row.allocationId,
      validationPreparedInputId: row.validationPreparedInputId,
      datasetHash: manifest.validationDatasetHash,
    }, {
      id: run.allocationId,
      validationPreparedInputId: run.validationPreparedInputId,
      datasetHash: run.datasetHash,
    }, `children[${index}].B3Reference`);
    addDifferences({
      kind: "b3",
      policySnapshot: planPolicySnapshot,
      policyRequest: planned?.policyRequest,
      validationSnapshot: preparedSnapshot,
      validationPreparedFingerprint: manifest.validationPreparedFingerprint,
      assumptions: manifest.assumptions,
      ...(manifest.alignmentPlan ? { estimationDatePlan: manifest.alignmentPlan } : {}),
    }, envelope, `children[${index}].B3Envelope`);

    const replay = await replayB3ValidationRun(child.validationRunId);
    const replayDifferences: string[] = [];
    if (!replay) {
      replayDifferences.push("B3 replay returned no record for the original child reference.");
    } else {
      if (replay.status !== "pass")
        replayDifferences.push(...replay.differences.map((item) => `B3 replay: ${item}`));
      differences.push(...compareC1ReplayChildren(
        [{ result: envelope.result as unknown }],
        [{ result: replay.replayedResult as unknown }],
      ).map(formatC1IntegrityDifference));
      if (replay.status === "pass" && resultAsB3Result(replay.replayedResult)) {
        if (manifest.alignmentPlan)
          replayDifferences.push(...alignmentDifferences(
            replay.replayedResult,
            manifest.alignmentPlan,
            `children[${index}].alignmentPlan`,
          ));
        if (!replayDifferences.length)
          verifiedSummaryChildren.push({
            label: child.label,
            excludedCandidateIds: child.excludedCandidateIds,
            result: replay.replayedResult,
          });
      }
    }
    if (replayDifferences.length) differences.push(...replayDifferences.map((item) =>
      `children[${index}].replay: ${item}`));
    childReplays.push(replay
      ? { ...replay, differences: [...replay.differences, ...replayDifferences] }
      : { validationRunId: child.validationRunId, status: "fail", differences: replayDifferences });
  }
  if (verifiedSummaryChildren.length === children.length && children.length > 0 &&
      verifiedSummaryChildren[0].excludedCandidateIds.length === 0) {
    const summaryIntegrity = recomputeAndCompareC1Summary(
      verifiedSummaryChildren,
      baselineIds,
      row.summaryJson,
    );
    differences.push(...summaryIntegrity.differences.map(formatC1IntegrityDifference));
  } else if (row.summaryJson !== null) {
    differences.push(`summary: expected recomputation from every passing original B3 child; observed unavailable because only ${verifiedSummaryChildren.length}/${children.length} children verified.`);
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