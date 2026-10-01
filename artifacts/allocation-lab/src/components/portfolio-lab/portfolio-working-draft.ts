export const B2_WORKING_DRAFT_KEY = "allocation-lab:b2-working-draft:v1";
export const B3_WORKING_DRAFT_KEY = "allocation-lab:b3-working-draft:v1";

export interface WorkingDraftSnapshot {
  version: 1;
  values: Record<string, unknown>;
}

export function readWorkingDraft(raw: string | null): WorkingDraftSnapshot | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const snapshot = parsed as Partial<WorkingDraftSnapshot>;
    if (snapshot.version !== 1 || !snapshot.values || typeof snapshot.values !== "object" || Array.isArray(snapshot.values))
      return null;
    return { version: 1, values: snapshot.values as Record<string, unknown> };
  } catch {
    return null;
  }
}

export function readWorkingDraftValue<T>(
  raw: string | null,
  field: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): T {
  const value = readWorkingDraft(raw)?.values[field];
  return isValid(value) ? value : fallback;
}

export function writeWorkingDraftValue(raw: string | null, field: string, value: unknown): string {
  const current = readWorkingDraft(raw);
  return JSON.stringify({
    version: 1,
    values: { ...current?.values, [field]: value },
  });
}

export function isCurrentViewRequest({
  requestedView,
  currentView,
  requestGeneration,
  currentGeneration,
}: {
  requestedView: string;
  currentView: string;
  requestGeneration: number;
  currentGeneration: number;
}): boolean {
  return requestedView === currentView && requestGeneration === currentGeneration;
}