import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  loadSavedActualBook,
  makeCashOnlyBook,
  parseManualActualBook,
  startingPortfolioMode,
  validateActualBook,
  type ActualBook,
  type StartingPortfolioContext,
  type StartingPortfolioSelection,
} from "./starting-portfolio";

export type { ActualBook, StartingPortfolioContext, StartingPortfolioSelection } from "./starting-portfolio";

type HistoryAllocation = {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  allocationId: number | null;
};

type Props = {
  engine: "legacy" | "b2";
  context?: StartingPortfolioContext;
  selection?: StartingPortfolioSelection;
  onChange: (selection: StartingPortfolioSelection) => void;
  onOpenSettings?: () => void;
};

const emptyContext: StartingPortfolioContext = {
  informationCutoff: "",
  lambdaR: 0,
  objectiveType: "",
  allocationMode: "CAPITAL_LONG_ONLY",
};

type ManualForm = { asOf: string; quantities: string; cash: string; nav: string };

function bookForm(book?: ActualBook): ManualForm {
  return book
    ? { asOf: book.asOf, quantities: JSON.stringify(book.quantities), cash: String(book.cash), nav: String(book.nav) }
    : { asOf: "", quantities: "{}", cash: "", nav: "" };
}

function entryLabel(entry: HistoryAllocation): string {
  return `Allocation #${entry.allocationId ?? entry.id} · saved ${entry.createdAt}`;
}

export function StartingPortfolioPanel({ engine, context = emptyContext, selection, onChange, onOpenSettings }: Props) {
  const [localSelection, setLocalSelection] = useState<StartingPortfolioSelection | undefined>();
  const previousProp = useRef(selection);
  const [manual, setManual] = useState<ManualForm>(() => bookForm(context.holdings));
  const [history, setHistory] = useState<HistoryAllocation[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingAllocationId, setLoadingAllocationId] = useState<number | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const activeSelection = selection ?? localSelection;
  const mode = startingPortfolioMode(activeSelection, context);
  const signed = context.allocationMode === "SIGNED_OVERLAY";
  const isLegacy = engine === "legacy";

  useEffect(() => {
    if (previousProp.current !== selection) {
      previousProp.current = selection;
      setLocalSelection(selection);
    }
  }, [selection]);

  const currentBook = useMemo(
    () => validateActualBook(context.holdings, context.informationCutoff, signed),
    [context.holdings, context.informationCutoff, signed],
  );
  const manualResult = useMemo(
    () => parseManualActualBook(manual, context.informationCutoff, signed),
    [manual, context.informationCutoff, signed],
  );
  const lambdaError = context.lambdaR > 0 && context.objectiveType !== "regularized_mean_variance"
    ? "Positive λR requires regularized_mean_variance. Change the objective before using a starting book."
    : null;

  const commit = (next: StartingPortfolioSelection) => {
    setLocalSelection(next);
    onChange(next);
  };

  const chooseMode = (nextMode: StartingPortfolioSelection["mode"]) => {
    setMessage(null);
    setSavedError(null);
    if (isLegacy) return;
    if (nextMode === "ignore") {
      commit({ mode: "ignore" });
      return;
    }
    if (nextMode === "cash_only") {
      const book = makeCashOnlyBook(context);
      commit({ mode: "cash_only", holdings: book, sourceLabel: `Explicit cash-only book · NAV ${book.nav}` });
      return;
    }
    if (nextMode === "current") {
      if (!currentBook.book) {
        setMessage(currentBook.error ?? "A dated actual current book is unavailable.");
        return;
      }
      commit({ mode: "current", holdings: currentBook.book, sourceLabel: `Current actual book · ${currentBook.book.asOf}` });
      return;
    }
    if (nextMode === "saved") {
      commit({ mode: "saved" });
      void loadHistory();
      return;
    }
    const parsed = parseManualActualBook(manual, context.informationCutoff, signed);
    commit(parsed.book
      ? { mode: "manual", holdings: parsed.book, sourceLabel: `Manual actual book · ${parsed.book.asOf}` }
      : { mode: "manual" });
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const response = await fetch("/api/portfolio-history", { method: "GET", credentials: "include" });
      if (!response.ok) throw new Error(`Saved portfolio history request failed (${response.status}).`);
      const records: unknown = await response.json();
      if (!Array.isArray(records)) throw new Error("Saved portfolio history returned an invalid response.");
      setHistory(records.filter((value): value is HistoryAllocation =>
        !!value && typeof value === "object" && (value as HistoryAllocation).kind === "allocation" &&
        (value as HistoryAllocation).status === "frozen" && Number.isSafeInteger((value as HistoryAllocation).allocationId) &&
        typeof (value as HistoryAllocation).createdAt === "string"));
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Unable to load saved portfolio history.");
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadAllocation = async (allocationId: number) => {
    setLoadingAllocationId(allocationId);
    setSavedError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/allocations/${allocationId}`, { method: "GET", credentials: "include" });
      if (!response.ok) throw new Error(`Saved allocation request failed (${response.status}).`);
      const record: unknown = await response.json();
      const found = loadSavedActualBook(record, context.informationCutoff, signed);
      if (!found.book) throw new Error(found.error ?? "Saved record does not contain actual holdings.");
      const allocation = record as { createdAt?: unknown; id?: unknown };
      const label = `Allocation #${allocation.id ?? allocationId} · frozen ${String(allocation.createdAt ?? "date not recorded")} · holdings as of ${found.book.asOf}`;
      commit({ mode: "saved", holdings: found.book, sourceLabel: label });
    } catch (error) {
      setSavedError(error instanceof Error ? error.message : "Unable to load actual holdings from this saved record.");
    } finally {
      setLoadingAllocationId(null);
    }
  };

  const updateManual = (next: ManualForm) => {
    setManual(next);
    if (isLegacy) return;
    const parsed = parseManualActualBook(next, context.informationCutoff, signed);
    if (parsed.book)
      commit({ mode: "manual", holdings: parsed.book, sourceLabel: `Manual actual book · ${parsed.book.asOf}` });
    else
      commit({ mode: "manual" });
  };

  const options: { mode: StartingPortfolioSelection["mode"]; label: string; description: string }[] = [
    { mode: "ignore", label: "Ignore starting portfolio", description: "For this run, omit rebalance regularization only. Configured λR and other saved settings remain unchanged." },
    { mode: "cash_only", label: "Cash only", description: "An explicit actual book with no risky quantities; cash equals NAV (current context NAV, or 100 if unavailable)." },
    { mode: "current", label: "Use current holdings", description: "Use only a supplied, dated actual quantities/cash/NAV book. No account or brokerage data is inferred." },
    { mode: "saved", label: "Load saved portfolio", description: "Choose a frozen allocation and load its persisted actual rebalance holdings. Target-only allocations are unavailable." },
    { mode: "manual", label: "Manual", description: "Enter a dated actual quantities, cash and NAV book. Validation is local; no engine calculates holdings." },
  ];

  return <section className="space-y-4 rounded-lg border bg-card p-4" data-testid="starting-portfolio-panel">
    <header>
      <h2 className="text-sm font-semibold">Starting Portfolio</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">B2 λR compares target risky underlying weights with an actual book at the information cutoff. It never converts target weights into shares. Positive λR requires the regularized mean-variance objective and exact-date actual quantities, cash and NAV.</p>
      <p className="mt-1 text-xs text-muted-foreground">Cutoff: <strong>{context.informationCutoff || "Not selected"}</strong> · λR: <strong>{context.lambdaR}</strong> · objective: <strong>{context.objectiveType || "Not selected"}</strong> · mode: <strong>{context.allocationMode}</strong></p>
    </header>

    {isLegacy && <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900" data-testid="starting-portfolio-legacy-note">
      These five choices are visible for clarity but are unsupported by the legacy turnover reference, so they are disabled. Legacy previous weights remain a configured target baseline/optional blend; do not zero priors or disable diversification to imitate “Ignore”.
      {onOpenSettings && <Button type="button" variant="link" className="ml-1 h-auto p-0 text-amber-900 underline" onClick={onOpenSettings}>Edit legacy starting-weight baseline in Settings</Button>}
    </div>}

    {!isLegacy && mode !== "ignore" && lambdaError && <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">{lambdaError}</p>}
    <fieldset className="space-y-3" disabled={isLegacy}>
      <legend className="sr-only">Starting portfolio choice</legend>
      {options.map(option => {
        const unavailableCurrent = option.mode === "current" && !currentBook.book;
        return <label key={option.mode} className={`flex gap-3 rounded border p-3 ${mode === option.mode ? "border-primary bg-primary/[0.035]" : ""} ${unavailableCurrent || isLegacy ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
          <input
            type="radio"
            name="starting-portfolio-mode"
            value={option.mode}
            checked={mode === option.mode}
            disabled={isLegacy || unavailableCurrent}
            onChange={() => chooseMode(option.mode)}
            className="mt-0.5 accent-primary"
          />
          <span className="min-w-0">
            <span className="block text-xs font-semibold">{option.label}</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{option.description}</span>
            {option.mode === "current" && !currentBook.book && <span className="mt-1 block text-[11px] text-amber-800">{currentBook.error}</span>}
          </span>
        </label>;
      })}
    </fieldset>

    {mode === "saved" && !isLegacy && <div className="space-y-2 rounded border p-3">
      <div className="flex items-center justify-between gap-2"><Label htmlFor="starting-portfolio-saved">Frozen allocation · saved creation date</Label><Button type="button" variant="outline" size="sm" disabled={loadingHistory} onClick={() => void loadHistory()}>{loadingHistory ? "Loading…" : "Refresh"}</Button></div>
      {loadingHistory && <p className="text-xs text-muted-foreground">Loading saved allocation history…</p>}
      {historyError && <p className="text-xs text-destructive" role="alert">{historyError}</p>}
      {!loadingHistory && !historyError && history.length === 0 && <p className="text-xs text-muted-foreground">No frozen saved allocations are available.</p>}
      {history.length > 0 && <select id="starting-portfolio-saved" className="h-9 w-full rounded-md border bg-background px-3 text-xs" defaultValue="" disabled={loadingAllocationId !== null} onChange={event => { const id = Number(event.target.value); if (Number.isSafeInteger(id) && id > 0) void loadAllocation(id); }}>
        <option value="" disabled>Choose a saved allocation…</option>
        {history.map(entry => <option key={entry.id} value={entry.allocationId!}>{entryLabel(entry)}</option>)}
      </select>}
      {loadingAllocationId !== null && <p className="text-xs text-muted-foreground">Loading persisted actual holdings…</p>}
      {savedError && <p className="text-xs text-destructive" role="alert">{savedError}</p>}
      {activeSelection?.mode === "saved" && activeSelection.sourceLabel && <p className="text-xs text-muted-foreground">Selected: {activeSelection.sourceLabel}</p>}
    </div>}

    {mode === "manual" && !isLegacy && <div className="grid gap-3 rounded border p-3 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor="starting-portfolio-asof">Actual as-of date · must equal cutoff</Label><Input id="starting-portfolio-asof" type="date" value={manual.asOf} onChange={event => updateManual({ ...manual, asOf: event.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor="starting-portfolio-nav">Actual NAV</Label><Input id="starting-portfolio-nav" type="number" min="0.000001" step="any" value={manual.nav} onChange={event => updateManual({ ...manual, nav: event.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor="starting-portfolio-cash">Actual cash</Label><Input id="starting-portfolio-cash" type="number" step="any" value={manual.cash} onChange={event => updateManual({ ...manual, cash: event.target.value })} /></div>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="starting-portfolio-quantities">Actual quantities · ticker → quantity JSON</Label><Input id="starting-portfolio-quantities" className="font-mono" value={manual.quantities} onChange={event => updateManual({ ...manual, quantities: event.target.value })} placeholder='{"SPY":12.5,"TLT":4}' /></div>
      {manualResult.error && <p className="text-xs text-destructive sm:col-span-2" role="alert">{manualResult.error}</p>}
      {manualResult.book && <p className="text-xs text-green-700 sm:col-span-2">Valid local actual-book fields for cutoff {context.informationCutoff}; no optimization or automated conversion performed.</p>}
    </div>}

    {activeSelection?.holdings && <details className="rounded border p-3 text-xs">
      <summary className="cursor-pointer font-medium">Selected actual book · frozen source metadata</summary>
      <p className="mt-2 text-muted-foreground">{activeSelection.sourceLabel ?? "Source label not recorded"}</p>
      <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(activeSelection.holdings, null, 2)}</pre>
    </details>}
    {message && <p className="text-xs text-destructive" role="alert">{message}</p>}
    {activeSelection && !isLegacy && <p className="text-[11px] text-muted-foreground">Run-only selection: choosing Ignore removes only rebalanceRegularization from this request; it does not save over configured λR or other settings.</p>}
  </section>;
}
