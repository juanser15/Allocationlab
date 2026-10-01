import { useState } from "react";
import { Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  HISTORY_KINDS, filterHistory, historyReplayAvailable, sortHistory, statusLabel,
  type HistoryKind, type HistorySelection, type PortfolioHistoryEntry, type HistoryStatus,
} from "./portfolio-history-state";

const tone: Record<HistoryStatus, string> = {
  frozen: "bg-sky-50 text-sky-700 border-sky-200",
  queued: "bg-amber-50 text-amber-700 border-amber-200",
  running: "bg-amber-50 text-amber-700 border-amber-200",
  completed: "bg-green-50 text-green-700 border-green-200",
  failed: "bg-red-50 text-red-700 border-red-200",
};

interface Props {
  entries: PortfolioHistoryEntry[];
  loading: boolean;
  error: boolean;
  refreshing: boolean;
  selection: HistorySelection | null;
  onRefresh: () => void;
  onInspect: (entry: PortfolioHistoryEntry) => void;
}

/** Read-only saved records. Selecting a row only inspects; it never submits, validates or replays. */
export function PmSavedHistory({ entries, loading, error, refreshing, selection, onRefresh, onInspect }: Props) {
  const [kind, setKind] = useState<HistoryKind | "all">("all");
  const rows = sortHistory(filterHistory(entries, kind));
  return (
    <div className="space-y-3" data-testid="pm-saved-history">
      <div className="flex items-center gap-2 flex-wrap">
        {(["all", ...HISTORY_KINDS] as const).map(k => (
          <Button key={k} size="sm" variant={kind === k ? "default" : "outline"}
            onClick={() => setKind(k)} data-testid={`filter-history-${k}`} className="h-7 text-xs capitalize">{k}</Button>
        ))}
        <Button size="sm" variant="ghost" onClick={onRefresh} disabled={refreshing}
          data-testid="button-refresh-history" className="h-7 text-xs ml-auto">
          <RefreshCw className={`mr-1.5 h-3 w-3 ${refreshing ? "animate-spin" : ""}`} /> Refresh list (read-only)
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Inspecting a record loads its saved result. It does not start an optimization, validation or replay.
      </p>
      {loading && <div className="text-sm text-muted-foreground flex items-center"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading saved records</div>}
      {error && (
        <div className="text-sm text-destructive flex items-center gap-2"><AlertCircle className="h-4 w-4" /> Saved history could not be loaded.
          <Button size="sm" variant="outline" onClick={onRefresh} className="h-7 text-xs">Retry</Button></div>
      )}
      {!loading && !error && rows.length === 0 && (
        <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground text-center">No saved records match this filter.</div>
      )}
      <div className="space-y-1.5">
        {rows.map(r => {
          const active = selection?.kind === r.kind && selection.id === r.id;
          return (
            <div key={`${r.kind}:${r.id}`} data-testid={`row-history-${r.kind}-${r.id}`}
              className={`flex items-center gap-3 flex-wrap rounded-md border px-3 py-2 text-xs ${active ? "border-primary bg-primary/5" : "bg-white"}`}>
              <span className="uppercase tracking-wider font-medium w-24">{r.kind}</span>
              <span className="font-mono">{r.id}</span>
              <span className="text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
              <Badge variant="outline" className={`text-[10px] ${tone[r.status]}`}>{statusLabel(r.status)}</Badge>
              <span className="text-muted-foreground">Repr: {r.representation ?? "legacy"}</span>
              <span className="text-muted-foreground">Exec: {r.executionMode ?? "n/a"}</span>
               <span className="text-muted-foreground">Replay: {historyReplayAvailable(r) ? "available" : "unavailable"}</span>
              <Button size="sm" variant="outline" className="h-7 text-xs ml-auto"
                onClick={() => onInspect(r)} data-testid={`button-inspect-${r.kind}-${r.id}`}>
                {active ? "Inspecting" : "Inspect saved record"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
