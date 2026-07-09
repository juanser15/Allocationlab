import { useGetLatestResults, useGetUniverse } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/PageHeader";
import Backtesting from "./backtesting";

export default function ResearchLab() {
  const { data: universe, isLoading: loadingUniverse } = useGetUniverse();
  const { data: result } = useGetLatestResults();

  const scoreByTicker = new Map((result?.allocations ?? []).map((a) => [a.ticker, a.factorScores.composite]));

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto space-y-6">
      <PageHeader
        section="5 · Research Lab"
        title="Research Lab"
        description="Explore individual ETFs in depth and stress-test the model with bias-resistant backtesting."
      />

      <Tabs defaultValue="explorer">
        <TabsList>
          <TabsTrigger value="explorer">ETF Explorer</TabsTrigger>
          <TabsTrigger value="backtesting">Backtesting</TabsTrigger>
        </TabsList>

        <TabsContent value="explorer" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>ETF Universe</CardTitle>
              <CardDescription>Click any ticker to open its price chart, factor breakdown, and score history.</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingUniverse ? (
                <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : (
                <Table>
                  <TableHeader className="bg-gray-50">
                    <TableRow>
                      <TableHead>Ticker</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Sector</TableHead>
                      <TableHead className="text-center">Enabled</TableHead>
                      <TableHead className="text-right">Latest Composite</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(universe?.etfs ?? []).map((etf) => (
                      <TableRow key={etf.ticker}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/etf/${etf.ticker}`}
                            className="inline-flex items-center gap-0.5 hover:text-accent hover:underline transition-colors group"
                          >
                            {etf.ticker}
                            <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                          </Link>
                        </TableCell>
                        <TableCell>{etf.name}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{etf.sector}</TableCell>
                        <TableCell className="text-center">
                          {etf.enabled ? (
                            <span className="text-xs px-2 py-0.5 rounded border bg-accent/10 text-accent border-accent/20">Yes</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded border text-gray-400 border-gray-200">No</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {scoreByTicker.has(etf.ticker) ? scoreByTicker.get(etf.ticker)!.toFixed(1) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="backtesting" className="pt-0">
          <Backtesting embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
