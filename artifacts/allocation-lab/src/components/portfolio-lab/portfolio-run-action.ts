export interface RunAction {
  run: () => void;
  disabled: boolean;
  busy: boolean;
}

export type RunActionChange = (action: RunAction | null) => void;

/** Register and unregister an action without invoking its run callback. */
export function registerRunAction(
  latestCallback: () => RunActionChange | undefined,
  action: RunAction,
): () => void {
  latestCallback()?.(action);
  return () => latestCallback()?.(null);
}