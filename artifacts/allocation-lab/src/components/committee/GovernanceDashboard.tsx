import { useState } from "react";
import {
  useGetGovernanceDashboard,
  useListGovernanceVersions,
  useLockGovernanceVersion,
  useUnlockGovernanceVersion,
  useRerunGovernanceConsistencyCheck,
  useGetGovernanceAuditLog,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  Loader2, ShieldCheck, ShieldAlert, Lock, Unlock, RefreshCw, Download,
  Clock, FileWarning, CheckCircle2, XCircle, History,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { localSettings } from "@/lib/local-settings";

function statusBadge(state: string) {
  const map: Record<string, { label: string; className: string }> = {
    approved: { label: "Approved", className: "bg-green-100 text-green-800" },
    pending: { label: "Pending Approval", className: "bg-amber-100 text-amber-800" },
    draft: { label: "Draft", className: "bg-gray-100 text-gray-700" },
    not_submitted: { label: "Not Submitted", className: "bg-gray-100 text-gray-500" },
  };
  const entry = map[state] ?? { label: state, className: "bg-gray-100 text-gray-700" };
  return <Badge variant="outline" className={entry.className}>{entry.label}</Badge>;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function GovernanceDashboard() {
  const { toast } = useToast();
  const { data: dashboard, isLoading, refetch: refetchDashboard } = useGetGovernanceDashboard();
  const { data: versions, refetch: refetchVersions } = useListGovernanceVersions();
  const { data: auditLog } = useGetGovernanceAuditLog();
  const lockMutation = useLockGovernanceVersion();
  const unlockMutation = useUnlockGovernanceVersion();
  const rerunCheck = useRerunGovernanceConsistencyCheck();
  const [checkResults, setCheckResults] = useState<Record<number, { consistent: boolean; summary: string; changedFactors: string[] }>>({});
  const governanceMode = localSettings.getGovernanceSettings().governanceMode;

  const refreshAll = () => {
    refetchDashboard();
    refetchVersions();
  };

  if (isLoading || !dashboard) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading governance dashboard…
      </div>
    );
  }

  if (dashboard.totalVersions === 0) {
    return (
      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertDescription>
          No saved portfolio versions exist yet. Run a rebalance in Portfolio Construction to generate the first governed version.
        </AlertDescription>
      </Alert>
    );
  }

  const handleLock = (sessionId: number) => {
    lockMutation.mutate(
      { sessionId, data: {} },
      {
        onSuccess: () => { toast({ title: "Version archive-locked" }); refreshAll(); },
        onError: (err: unknown) => toast({ title: "Could not lock version", description: err instanceof Error ? err.message : "Error", variant: "destructive" }),
      }
    );
  };

  const handleUnlock = (sessionId: number) => {
    unlockMutation.mutate(
      { sessionId, data: {} },
      {
        onSuccess: () => { toast({ title: "Archive lock removed" }); refreshAll(); },
        onError: (err: unknown) => toast({ title: "Could not unlock version", description: err instanceof Error ? err.message : "Error", variant: "destructive" }),
      }
    );
  };

  const handleRerunCheck = (sessionId: number) => {
    rerunCheck.mutate(
      { sessionId },
      {
        onSuccess: (result) => {
          setCheckResults((prev) => ({ ...prev, [sessionId]: result }));
          toast({ title: result.consistent ? "Rerun consistent" : "Rerun inconsistent", description: result.summary, variant: result.consistent ? "default" : "destructive" });
        },
        onError: (err: unknown) => toast({ title: "Rerun check failed", description: err instanceof Error ? err.message : "Error", variant: "destructive" }),
      }
    );
  };

  const handleExportAuditLog = () => {
    const rows = [["ID", "Session", "Event", "Actor", "Detail", "Timestamp"]];
    (auditLog ?? []).forEach((e) => rows.push([String(e.id), e.sessionId ? String(e.sessionId) : "—", e.eventType, e.actor, e.detail, e.createdAt]));
    downloadCsv(`governance-audit-log-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  const handleExportGovernanceSummary = () => {
    const rows = [["Session", "Label", "Model Version", "Parameter Version", "Data Timestamp", "Benchmark", "Reproducibility Hash", "Locked", "Committee Status", "Approval State", "Diagnostics Status"]];
    (versions ?? []).forEach((v) =>
      rows.push([
        String(v.sessionId), v.label, v.modelVersion ?? "—", v.parameterVersion ?? "—", v.dataTimestamp ?? "—",
        v.benchmarkTicker ?? "—", v.reproducibilityHash ?? "—", v.locked ? "Yes" : "No", v.committeeStatus, v.approvalState, v.diagnosticsStatus,
      ])
    );
    downloadCsv(`governance-summary-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Versions</p>
            <p className="text-2xl font-semibold text-gray-900 mt-1">{dashboard.totalVersions}</p>
            <p className="text-xs text-muted-foreground mt-1">{dashboard.versionsWithGovernanceRecord} with a governance snapshot</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pending Approvals</p>
            <p className="text-2xl font-semibold text-gray-900 mt-1">{dashboard.pendingApprovals.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stale Data Warnings</p>
            <p className="text-2xl font-semibold text-gray-900 mt-1">{dashboard.staleWarnings.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Locked Versions</p>
            <p className="text-2xl font-semibold text-gray-900 mt-1">{dashboard.lockedVersions.length}</p>
          </CardContent>
        </Card>
      </div>

      {dashboard.governanceNote && (
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>{dashboard.governanceNote}</AlertDescription>
        </Alert>
      )}

      {governanceMode === "strict" && dashboard.missingValidation.length > 0 && (
        <Alert variant="destructive">
          <FileWarning className="h-4 w-4" />
          <AlertDescription>
            Strict governance mode: {dashboard.missingValidation.length} version(s) have missing validation items. See the table below.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={handleExportGovernanceSummary}>
          <Download className="mr-2 h-3.5 w-3.5" /> Export Governance Summary
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportAuditLog}>
          <Download className="mr-2 h-3.5 w-3.5" /> Export Audit Log
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Version Status &amp; Change History</CardTitle>
          <CardDescription>Every saved portfolio version's governance record, approval state, and archive lock status.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Model / Parameter</TableHead>
                <TableHead>Data Timestamp</TableHead>
                <TableHead>Committee</TableHead>
                <TableHead>Diagnostics</TableHead>
                <TableHead>Validation</TableHead>
                <TableHead>Lock</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(versions ?? []).map((v) => {
                const check = checkResults[v.sessionId];
                return (
                  <TableRow key={v.sessionId}>
                    <TableCell className="font-medium">
                      {v.label}
                      {v.isStale && <Badge variant="outline" className="ml-2 bg-amber-100 text-amber-800"><Clock className="h-3 w-3 mr-1" />Stale</Badge>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {v.hasGovernanceRecord ? (
                        <>
                          {v.modelVersion} / {v.parameterVersion}
                          <div className="text-muted-foreground font-mono">{v.reproducibilityHash}</div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">No snapshot recorded</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{v.dataTimestamp ?? "—"}</TableCell>
                    <TableCell>{statusBadge(v.approvalState)}</TableCell>
                    <TableCell className="text-xs">
                      {v.diagnosticsStatus === "computed" ? (
                        <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> Computed</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground"><XCircle className="h-3.5 w-3.5" /> {v.diagnosticsStatus.replace(/_/g, " ")}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {v.missingValidationItems.length === 0 ? (
                        <span className="text-green-700">Complete</span>
                      ) : (
                        <span className="text-amber-700">{v.missingValidationItems.length} item(s) missing</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {v.locked ? (
                        <Badge variant="outline" className="bg-gray-900 text-white"><Lock className="h-3 w-3 mr-1" /> Locked</Badge>
                      ) : (
                        <Badge variant="outline">Unlocked</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-1 whitespace-nowrap">
                      {v.hasGovernanceRecord && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={rerunCheck.isPending}
                          onClick={() => handleRerunCheck(v.sessionId)}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {v.hasGovernanceRecord && (v.locked ? (
                        <Button size="sm" variant="outline" onClick={() => handleUnlock(v.sessionId)} disabled={unlockMutation.isPending}>
                          <Unlock className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => handleLock(v.sessionId)} disabled={lockMutation.isPending}>
                          <Lock className="h-3.5 w-3.5" />
                        </Button>
                      ))}
                      {check && (
                        <div className={`text-xs mt-1 text-left ${check.consistent ? "text-green-700" : "text-red-700"}`}>
                          {check.consistent ? "Reproducible" : `Changed: ${check.changedFactors.join("; ")}`}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" /> Audit Trail</CardTitle>
          <CardDescription>Every governance event — snapshots, lock/unlock, and rerun checks — timestamped and attributed.</CardDescription>
        </CardHeader>
        <CardContent>
          {(dashboard.recentAuditEvents.length === 0) ? (
            <p className="text-sm text-muted-foreground">No governance events recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {dashboard.recentAuditEvents.map((e) => (
                <div key={e.id} className="text-sm border-b border-gray-100 pb-2 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">{e.eventType.replace(/_/g, " ")}</span>
                    <span className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-muted-foreground">{e.detail}</p>
                  <p className="text-xs text-muted-foreground">by {e.actor}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Separator />
      <p className="text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 inline mr-1" />
        Backtest integrity is computed live in Research Lab against current inputs and is not stored per saved version — this dashboard reports that honestly rather than fabricating a per-version backtest score.
      </p>
    </div>
  );
}
