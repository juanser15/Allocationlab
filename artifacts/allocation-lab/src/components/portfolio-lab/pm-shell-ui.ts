export interface PmAction { run: () => void; disabled: boolean; busy: boolean }

export const PM_SECTIONS = [
  { id: "pm-setup", n: 1, label: "Portfolio Setup" },
  { id: "pm-forecast-risk", n: 2, label: "Forecast & Risk" },
  { id: "pm-constraints", n: 3, label: "Constraints" },
  { id: "pm-results", n: 4, label: "Results" },
  { id: "pm-validation", n: 5, label: "Validation" },
  { id: "pm-saved-runs", n: 6, label: "Saved Runs / Replay" },
] as const;

export const PM_SECTION_TARGETS = {
  setup: "pm-setup-body",
  forecastRisk: "pm-forecast-risk-body",
  constraints: "pm-constraints-body",
  results: "pm-results-body",
} as const;

/** Wrap an action for useState setters so React never invokes it as an updater. */
export const storeAction = (a: PmAction | null) => () => a;

export function sameAction(a: PmAction | null, b: PmAction | null): boolean {
  if (a === b) return true;
  return !!a && !!b && a.run === b.run && a.disabled === b.disabled && a.busy === b.busy;
}

export interface TopActionInput {
  registered: PmAction | null;
  fallback: () => void;
  fallbackDisabled: boolean;
  fallbackBusy: boolean;
  inspecting: boolean;
  b2Mode: boolean;
}

const noop = () => undefined;

/**
 * Top-level button state. In B2 mode only the registered action is ever used; until
 * it registers the button is disabled (never the legacy handler). Legacy mode prefers a
 * registered action and otherwise uses the legacy fallback. Inspecting always disables.
 */
export function resolveTopAction(i: TopActionInput): PmAction {
  if (i.b2Mode && !i.registered) return { run: noop, disabled: true, busy: false };
  const base: PmAction = i.registered ?? { run: i.fallback, disabled: i.fallbackDisabled, busy: i.fallbackBusy };
  return { run: base.run, busy: base.busy, disabled: base.disabled || base.busy || i.inspecting };
}
