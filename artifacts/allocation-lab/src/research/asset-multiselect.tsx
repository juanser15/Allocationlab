import { useEffect, useId, useMemo, useRef, useState } from "react";
import "./asset-multiselect.css";

/** Pure helpers (exported for lightweight checks). */
export function availableOptions(capEtfs: unknown): string[] {
  if (!Array.isArray(capEtfs)) return [];
  return [...new Set(capEtfs.filter((t): t is string => typeof t === "string" && t.length > 0))];
}
export function reconcileSelection(selected: string[], available: string[]) {
  const set = new Set(available);
  const kept = selected.filter((t) => set.has(t));
  return { kept, removed: selected.filter((t) => !set.has(t)) };
}
export function filterOptions(options: string[], query: string, labels: Record<string, string> = {}) {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((t) => t.toLowerCase().includes(q) || (labels[t] ?? "").toLowerCase().includes(q));
}
export function chipSummary(selected: string[], max = 4) {
  return { shown: selected.slice(0, max), more: Math.max(0, selected.length - max) };
}

export function AssetMultiselect({
  options,
  value,
  onChange,
  labels = {},
  loading = false,
  error = "",
  unavailableCount = 0,
}: {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  labels?: Record<string, string>;
  loading?: boolean;
  error?: string;
  unavailableCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const available = useMemo(() => new Set(options), [options]);
  const selectedValid = value.filter((t) => available.has(t));
  const visible = useMemo(() => filterOptions(options, query, labels), [options, query, labels]);
  const { shown, more } = chipSummary(selectedValid);
  const disabled = loading || !!error || options.length === 0;

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (refocus) trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(true); }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  useEffect(() => { if (disabled && open) close(false); }, [disabled, open]);

  const toggle = (t: string, on: boolean) =>
    onChange(on ? options.filter((o) => o === t || value.includes(o)) : value.filter((v) => v !== t));

  return (
    <div className="am-root" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="am-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        disabled={disabled}
        onClick={() => (open ? close(true) : setOpen(true))}
        data-testid="button-asset-multiselect"
      >
        <span className="am-count">
          {loading ? "Loading assets…" : error ? "Assets unavailable" : `${selectedValid.length} of ${options.length} selected`}
        </span>
        <span className="am-caret" aria-hidden>▾</span>
      </button>
      {selectedValid.length > 0 && (
        <ul className="am-chips" aria-label="Selected assets">
          {shown.map((t) => <li key={t} title={labels[t] ?? t}>{t}</li>)}
          {more > 0 && <li className="am-more">+{more} more</li>}
        </ul>
      )}
      {unavailableCount > 0 && (
        <p className="am-warn" role="status">
          {unavailableCount} earlier selection{unavailableCount === 1 ? " is" : "s are"} not in the active dataset and will not be used.
        </p>
      )}
      {open && (
        <div id={`${id}-panel`} className="am-panel" role="dialog" aria-label="Select eligible assets">
          <input
            ref={search}
            type="search"
            className="am-search"
            placeholder="Search ticker or name"
            aria-label="Search assets by ticker or name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="input-asset-search"
          />
          <div className="am-tools">
            <button type="button" onClick={() => onChange([...options])} data-testid="button-asset-select-all">
              Select all {options.length} available
            </button>
            <button type="button" onClick={() => onChange([])} disabled={value.length === 0} data-testid="button-asset-clear">
              Clear all
            </button>
            <small aria-live="polite">{visible.length} shown · {selectedValid.length} selected</small>
          </div>
          <div className="am-list" role="group" aria-label="Available assets">
            {visible.length === 0 ? (
              <p className="am-empty">No asset in the active dataset matches “{query}”.</p>
            ) : (
              visible.map((t) => (
                <label key={t} className="am-option">
                  <input
                    type="checkbox"
                    checked={value.includes(t)}
                    onChange={(e) => toggle(t, e.target.checked)}
                    data-testid={`checkbox-asset-${t}`}
                  />
                  <strong>{t}</strong>
                  <span>{labels[t] ?? ""}</span>
                </label>
              ))
            )}
          </div>
          <div className="am-foot">
            <button type="button" className="cp-primary" onClick={() => close(true)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
