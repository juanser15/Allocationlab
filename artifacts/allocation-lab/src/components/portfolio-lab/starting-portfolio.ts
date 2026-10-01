export interface ActualBook {
  asOf: string;
  quantities: Record<string, number>;
  cash: number;
  nav: number;
}

export type StartingPortfolioSelection = {
  mode: "ignore" | "cash_only" | "current" | "saved" | "manual";
  holdings?: ActualBook;
  sourceLabel?: string;
};

export interface StartingPortfolioContext {
  informationCutoff: string;
  lambdaR: number;
  holdings?: ActualBook;
  objectiveType: string;
  allocationMode: string;
  nav?: number;
}

export interface StartingPortfolioRequest {
  rebalanceRegularization?: {
    lambdaR: number;
    holdings?: ActualBook;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Validate only the persisted actual-book contract; target weights are never translated to shares. */
export function validateActualBook(
  value: unknown,
  cutoff: string,
  signed: boolean,
): { book?: ActualBook; error?: string } {
  if (!isRecord(value)) return { error: "Actual holdings are unavailable; a target allocation is not an actual book." };
  const { asOf, quantities, cash, nav } = value;
  if (typeof asOf !== "string" || !asOf) return { error: "Actual holdings must include their recorded as-of date." };
  if (!cutoff || asOf !== cutoff) return { error: `Holdings as-of ${asOf} must exactly match the information cutoff ${cutoff || "(not selected)"}.` };
  if (!isRecord(quantities) || Object.entries(quantities).some(([ticker, quantity]) =>
    !ticker.trim() || typeof quantity !== "number" || !Number.isFinite(quantity) || (!signed && quantity < 0)))
    return { error: `Actual quantities must map tickers to finite ${signed ? "signed" : "nonnegative"} numbers.` };
  if (typeof cash !== "number" || !Number.isFinite(cash) || (!signed && cash < 0))
    return { error: `Actual cash must be finite${signed ? " (signed cash is allowed)" : " and nonnegative"}.` };
  if (typeof nav !== "number" || !Number.isFinite(nav) || nav <= 0)
    return { error: "Actual NAV must be finite and positive." };
  return {
    book: { asOf, quantities: quantities as Record<string, number>, cash, nav },
  };
}

export function startingPortfolioMode(
  selection: StartingPortfolioSelection | undefined,
  context: StartingPortfolioContext,
): StartingPortfolioSelection["mode"] {
  return selection?.mode ?? (context.lambdaR > 0 ? "manual" : "ignore");
}

export function makeCashOnlyBook(context: StartingPortfolioContext): ActualBook {
  const nav = typeof context.nav === "number" && Number.isFinite(context.nav) && context.nav > 0
    ? context.nav
    : 100;
  return { asOf: context.informationCutoff, quantities: {}, cash: nav, nav };
}

/** Only this exact saved B2 field is a persisted actual book. Target-only records are rejected. */
export function loadSavedActualBook(
  record: unknown,
  cutoff: string,
  signed: boolean,
): { book?: ActualBook; error?: string } {
  if (!isRecord(record)) return { error: "Saved allocation record is unavailable." };
  const request = isRecord(record.request) ? record.request : {};
  const rebalance = isRecord(request.rebalanceRegularization) ? request.rebalanceRegularization : {};
  return validateActualBook(rebalance.holdings, cutoff, signed);
}

/** Undefined inherits the frozen/default B2 policy. Ignore omits only this run's regularization field. */
export function applyStartingPortfolioSelection<T extends StartingPortfolioRequest>(
  request: T,
  selection: StartingPortfolioSelection | undefined,
  context: StartingPortfolioContext,
): T | Omit<T, "rebalanceRegularization"> {
  if (!selection) return request;
  if (selection.mode === "ignore") {
    const { rebalanceRegularization: _omitted, ...rest } = request;
    return rest;
  }
  const book = selection.mode === "cash_only"
    ? makeCashOnlyBook(context)
    : selection.holdings;
  if (!book) throw new Error("Choose a valid actual starting book before applying this selection.");
  const checked = validateActualBook(book, context.informationCutoff, context.allocationMode === "SIGNED_OVERLAY");
  if (!checked.book) throw new Error(checked.error);
  if (context.lambdaR > 0 && context.objectiveType !== "regularized_mean_variance")
    throw new Error("Positive λR requires the regularized_mean_variance objective.");
  return {
    ...request,
    rebalanceRegularization: { ...request.rebalanceRegularization, lambdaR: context.lambdaR, holdings: checked.book },
  };
}

export function parseManualActualBook(
  form: { asOf: string; quantities: string; cash: string; nav: string },
  cutoff: string,
  signed: boolean,
): { book?: ActualBook; error?: string } {
  let quantities: unknown;
  try {
    quantities = JSON.parse(form.quantities);
  } catch {
    return { error: "Actual quantities must be valid ticker-to-quantity JSON." };
  }
  const cash = form.cash.trim() ? Number(form.cash) : Number.NaN;
  const nav = form.nav.trim() ? Number(form.nav) : Number.NaN;
  return validateActualBook({ asOf: form.asOf, quantities, cash, nav }, cutoff, signed);
}