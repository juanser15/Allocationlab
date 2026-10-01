export interface PreparedDraftSeed {
  candidateIds: string[];
  informationCutoff: string;
}

export interface FrozenAllocationView<T> {
  selectedAllocationId: number | null;
  result: T | null;
}

export function canOptimizeB2Draft(input: {
  historyInspectionActive: boolean;
  preparedInputMatchesDraft: boolean;
  draftReady?: boolean;
  draftRepresentation?: string;
  representation?: string;
}): boolean {
  const representation = input.draftRepresentation ?? input.representation;
  return !input.historyInspectionActive &&
    input.preparedInputMatchesDraft &&
    input.draftReady !== false &&
    representation !== "signals" &&
    input.representation !== "signals";
}

export type B2ResultView<T> =
  | { source: "working"; result: T | null }
  | { source: "inspected"; result: T }
  | { source: "inspected-loading"; result: null }
  | { source: "inspected-unavailable"; result: null }
  | { source: "unrecorded"; result: null };

export function selectB2ResultView<T>(input: {
  historyInspectionActive: boolean;
  inspectedAllocationId: number | null | undefined;
  inspectedResult: T | null;
  inspectedLoading: boolean;
  workingResult: T | null;
}): B2ResultView<T> {
  if (!input.historyInspectionActive) return { source: "working", result: input.workingResult };
  if (input.inspectedAllocationId === null || input.inspectedAllocationId === undefined)
    return { source: "unrecorded", result: null };
  if (input.inspectedResult) return { source: "inspected", result: input.inspectedResult };
  return input.inspectedLoading
    ? { source: "inspected-loading", result: null }
    : { source: "inspected-unavailable", result: null };
}

export function updateB2DraftForPreparationChange<T>(
  prepared: PreparedDraftSeed | null,
  frozenView: FrozenAllocationView<T>,
): PreparedDraftSeed & FrozenAllocationView<T> {
  return {
    candidateIds: prepared ? [...prepared.candidateIds] : [],
    informationCutoff: prepared?.informationCutoff ?? "",
    selectedAllocationId: frozenView.selectedAllocationId,
    result: frozenView.result,
  };
}