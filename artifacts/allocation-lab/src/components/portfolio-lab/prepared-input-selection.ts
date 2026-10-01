export type SelectionFilter = "all" | "selected" | "unselected";
export type SelectionMode = "select" | "clear";

export const PREPARED_REPRESENTATIONS = [
  { value: "asset_returns", label: "Assets" },
  { value: "alpha_streams", label: "Alpha Streams" },
  { value: "signals", label: "Signals" },
] as const;

export type SelectionOption = {
  id: string;
  label: string;
  group?: string;
};

export type RepresentationFields = {
  assets: boolean;
  factors: boolean;
  alphaDefinitions: boolean;
};

export function updateBulkSelection(
  current: string[],
  targetIds: string[],
  mode: SelectionMode,
): string[] {
  const targets = new Set(targetIds);
  if (mode === "clear") return current.filter(id => !targets.has(id));
  return Array.from(new Set([...current, ...targetIds]));
}

export function filterSelectionOptions(
  options: SelectionOption[],
  search: string,
  filter: SelectionFilter,
  selectedIds: string[],
): SelectionOption[] {
  const selected = new Set(selectedIds);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  return options.filter(option => {
    const matchesSearch = !normalizedSearch
      || `${option.label} ${option.id} ${option.group ?? ""}`.toLocaleLowerCase().includes(normalizedSearch);
    const matchesFilter = filter === "all"
      || (filter === "selected" ? selected.has(option.id) : !selected.has(option.id));
    return matchesSearch && matchesFilter;
  });
}

export function groupSelectionOptions(
  options: SelectionOption[],
  groupByGroup: boolean,
): Array<{ label: string; options: SelectionOption[] }> {
  if (!groupByGroup) return [{ label: "", options }];
  const groups = new Map<string, SelectionOption[]>();
  for (const option of options) {
    const label = option.group?.trim() || "Sector unavailable / not in Universe";
    groups.set(label, [...(groups.get(label) ?? []), option]);
  }
  return Array.from(groups, ([label, groupedOptions]) => ({ label, options: groupedOptions }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function representationFields(representation: string): RepresentationFields {
  switch (representation) {
    case "asset_returns":
      return { assets: true, factors: false, alphaDefinitions: false };
    case "signals":
      return { assets: true, factors: true, alphaDefinitions: false };
    case "alpha_streams":
      return { assets: true, factors: true, alphaDefinitions: true };
    default:
      return { assets: false, factors: false, alphaDefinitions: false };
  }
}