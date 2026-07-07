import { useListSessions } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Download, Search } from "lucide-react";
import { format } from "date-fns";

export default function Reports() {
  const { data: sessions, isLoading } = useListSessions();

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
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell className="font-medium">
                      {format(new Date(session.runAt), 'MMM dd, yyyy HH:mm')}
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
                      <Button variant="ghost" size="sm" onClick={() => window.open(`/api/reports/download/demo-token?session=${session.id}`, '_blank')}>
                        <Download className="h-4 w-4 mr-2" /> PDF
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
