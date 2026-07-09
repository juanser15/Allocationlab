import { useState } from "react";
import { useListSessions, useGenerateReport } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Download, Search, FileText, FileSpreadsheet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

type DownloadFormat = "csv" | "pdf";

export default function Reports() {
  const { toast } = useToast();
  const { data: sessions, isLoading } = useListSessions();
  const generateReport = useGenerateReport();
  const [downloading, setDownloading] = useState<{ id: number; fmt: DownloadFormat } | null>(null);

  const handleDownload = (sessionId: number, fmt: DownloadFormat) => {
    setDownloading({ id: sessionId, fmt });
    generateReport.mutate(
      { data: { format: fmt, sessionId } },
      {
        onSuccess: (result) => {
          window.open(`/api/reports/download/${result.downloadToken}`, "_blank");
          setDownloading(null);
        },
        onError: () => {
          toast({
            title: "Download failed",
            description: "Could not generate the report. Try again.",
            variant: "destructive",
          });
          setDownloading(null);
        },
      }
    );
  };

  if (isLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Execution Reports</h1>
        <p className="text-muted-foreground mt-2">History of past allocation runs and generated reports.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Session History</CardTitle>
          <CardDescription>All pipeline executions recorded in the system.</CardDescription>
        </CardHeader>
        <CardContent>
          {!sessions || sessions.length === 0 ? (
            <div className="text-center py-12 border rounded-md border-dashed">
              <Search className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-muted-foreground">No execution sessions found.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Regime</TableHead>
                  <TableHead className="text-right">Cash %</TableHead>
                  <TableHead className="text-right">Active ETFs</TableHead>
                  <TableHead className="text-right">Download</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => {
                  const loadingCsv = downloading?.id === session.id && downloading.fmt === "csv";
                  const loadingPdf = downloading?.id === session.id && downloading.fmt === "pdf";
                  const anyLoading = downloading?.id === session.id;

                  return (
                    <TableRow key={session.id}>
                      <TableCell className="font-medium">
                        {format(new Date(session.runAt), "MMM dd, yyyy HH:mm")}
                      </TableCell>
                      <TableCell>{session.label || `Run #${session.id}`}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">
                          {session.regimeLabel} ({session.regimeComposite.toFixed(0)})
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{(session.cashWeight * 100).toFixed(1)}%</TableCell>
                      <TableCell className="text-right">{session.activeEtfCount}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={anyLoading}
                            onClick={() => handleDownload(session.id, "csv")}
                            title="Download CSV"
                          >
                            {loadingCsv ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FileSpreadsheet className="h-4 w-4" />
                            )}
                            <span className="ml-1.5">CSV</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={anyLoading}
                            onClick={() => handleDownload(session.id, "pdf")}
                            title="Download PDF"
                          >
                            {loadingPdf ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FileText className="h-4 w-4" />
                            )}
                            <span className="ml-1.5">PDF</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
