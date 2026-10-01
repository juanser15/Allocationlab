import type { ActualBook, StartingPortfolioSelection } from "./starting-portfolio.ts";

export const STARTING_SELECTION_KEY = "allocation-lab:starting-selection:v1";
const MODES = ["ignore", "cash_only", "current", "saved", "manual"] as const;
const BOOK_MODES = ["current", "saved", "manual"];

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const rec = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function parseBook(v: unknown): ActualBook | undefined {
  if (!rec(v) || typeof v.asOf !== "string" || !v.asOf || !rec(v.quantities)) return undefined;
  if (Object.entries(v.quantities).some(([t, q]) => !t.trim() || typeof q !== "number" || !Number.isFinite(q))) return undefined;
  if (typeof v.cash !== "number" || !Number.isFinite(v.cash)) return undefined;
  if (typeof v.nav !== "number" || !Number.isFinite(v.nav) || v.nav <= 0) return undefined;
  return { asOf: v.asOf, quantities: v.quantities as Record<string, number>, cash: v.cash, nav: v.nav };
}

/** Guarded read. Missing key or unreadable payload -> undefined (inherit). Bad book fails closed (no holdings). */
export function readStartingSelection(storage: StorageLike | null | undefined): StartingPortfolioSelection | undefined {
  try {
    const raw = storage?.getItem(STARTING_SELECTION_KEY);
    if (!raw) return undefined;
    const p = JSON.parse(raw);
    if (!rec(p) || p.v !== 1 || !rec(p.selection)) return undefined;
    const mode = p.selection.mode;
    if (typeof mode !== "string" || !(MODES as readonly string[]).includes(mode)) return undefined;
    const sel: StartingPortfolioSelection = { mode: mode as StartingPortfolioSelection["mode"] };
    if (typeof p.selection.sourceLabel === "string") sel.sourceLabel = p.selection.sourceLabel;
    if (BOOK_MODES.includes(mode) || p.selection.holdings !== undefined) {
      const book = parseBook(p.selection.holdings);
      if (book) sel.holdings = book;
    }
    return sel;
  } catch {
    return undefined;
  }
}

/** Only called from explicit user changes; never on mount. */
export function writeStartingSelection(storage: StorageLike | null | undefined, sel: StartingPortfolioSelection): void {
  try {
    storage?.setItem(STARTING_SELECTION_KEY, JSON.stringify({ v: 1, selection: sel }));
  } catch { /* storage unavailable: selection stays in memory only */ }
}
