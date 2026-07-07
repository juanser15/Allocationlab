import { useGetLatestResults, useGenerateReport } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Download, DollarSign, Activity, FileDown, PieChart as PieChartIcon } from "lucide-react";
import { Link } from "wouter";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

export default function ResultsDashboard() {
  const { data: result, isLoading } = useGetLatestResults();
  const generateReport = useGenerateReport();
  const { toast } = useToast();

  if (isLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!result) {
    return (
      <div className="p-8 max-w-5xl mx-auto h-[calc(100vh-4rem)] flex flex-col items-center justify-center text-center">
        <PieChartIcon className="h-16 w-16 text-gray-300 mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">No Results Available</h2>
        <p className="text-muted-foreground mb-6 max-w-md">
          You haven't run the allocation pipeline yet. Configure your portfolio and run the rebalance workflow to see results here.
        </p>
        <Button asChild size="lg">
          <Link href="/">Go to Investment Committee</Link>
        </Button>
      </div>
    );
  }

  const handleDownload = (format: 'pdf' | 'png' | 'csv') => {
    generateReport.mutate(
      { data: { format, sessionId: result.sessionId } },
      {
        onSuccess: (data) => {
          window.open(`/api/reports/download/${data.downloadToken}`, '_blank');
        },
        onError: () => {
          toast({ title: "Failed to generate report", variant: "destructive" });
        }
      }
    );
  };

  const getRegimeColor = (score: number) => {
    if (score >= 60) return "bg-green-500";
    if (score >= 40) return "bg-accent";
    return "bg-destructive";
  };

  const getCellColorClass = (val: number) => {
    if (val >= 80) return "bg-green-100 text-green-800";
    if (val >= 60) return "bg-green-50 text-green-700";
    if (val >= 40) return "bg-amber-50 text-amber-700";
    if (val >= 20) return "bg-red-50 text-red-700";
    return "bg-red-100 text-red-800";
  };

  const donutData = [
    { name: "Cash", value: result.cashWeight * 100, color: "#1B2F5B" },
    ...result.allocations
      .filter(a => a.weight > 0)
      .map((a, i) => ({ 
        name: a.ticker, 
        value: a.weight * 100, 
        color: ["#D4AF37", "#4A5568", "#64748B", "#A0AEC0", "#CBD5E1", "#E2E8F0"][i % 6] 
      }))
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">Results Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            Allocation generated {new Date(result.runAt).toLocaleDateString()}
            {result.label && ` • ${result.label}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleDownload('csv')} disabled={generateReport.isPending}>
            <FileDown className="mr-2 h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" onClick={() => handleDownload('pdf')} disabled={generateReport.isPending}>
            <Download className="mr-2 h-4 w-4" /> PDF Report
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Regime Card */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex justify-between items-start">
              <CardTitle className="text-lg">Market Regime</CardTitle>
              <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-sm py-1">
                {result.regime.label}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 mt-4">
              {[
                { label: "Composite", value: result.regime.composite },
                { label: "Trend", value: result.regime.trend },
                { label: "Breadth", value: result.regime.breadth },
                { label: "Volatility", value: result.regime.volatility },
                { label: "Liquidity", value: result.regime.liquidity }
              ].map(indicator => (
                <div key={indicator.label} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className={indicator.label === "Composite" ? "font-bold text-gray-900" : "text-gray-600"}>{indicator.label}</span>
                    <span className="font-medium">{indicator.value.toFixed(1)}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${getRegimeColor(indicator.value)}`} 
                      style={{ width: `${indicator.value}%` }} 
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* KPI Cards */}
        <div className="space-y-6 md:col-span-2 grid grid-cols-2 gap-4">
          <Card className="col-span-1 mt-6 md:mt-0">
            <CardContent className="pt-6">
              <div className="flex justify-between items-start">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground flex items-center">
                    <DollarSign className="h-4 w-4 mr-1 text-primary/60" /> Cash Reserve
                  </p>
                  <p className="text-4xl font-bold text-primary">{(result.cashWeight * 100).toFixed(1)}%</p>
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm">
                <Badge variant="secondary" className={result.cashChange > 0 ? "bg-green-100 text-green-800" : result.cashChange < 0 ? "bg-red-100 text-red-800" : "bg-gray-100"}>
                  {result.cashChange > 0 ? "+" : ""}{(result.cashChange * 100).toFixed(1)}% vs prior
                </Badge>
              </div>
            </CardContent>
          </Card>
          <Card className="col-span-1 mt-0">
            <CardContent className="pt-6">
              <div className="flex justify-between items-start">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground flex items-center">
                    <Activity className="h-4 w-4 mr-1 text-primary/60" /> Active ETFs
                  </p>
                  <p className="text-4xl font-bold text-primary">{result.activeEtfCount}</p>
                </div>
              </div>
              <div className="mt-4 text-sm text-muted-foreground">
                Target: {result.activeEtfCount}
              </div>
            </CardContent>
          </Card>
          <Card className="col-span-2">
            <CardContent className="pt-6 h-[220px]">
              <div className="h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {donutData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
                    <Legend verticalAlign="middle" align="right" layout="vertical" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Allocation Table */}
      <Card>
        <CardHeader>
          <CardTitle>Final Allocation</CardTitle>
          <CardDescription>Target weights and changes versus prior month.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead className="text-right">Comp Score</TableHead>
                <TableHead className="text-right">Prior</TableHead>
                <TableHead className="text-right">New Weight</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-primary/5 font-medium border-b-2 border-primary/20">
                <TableCell>CASH</TableCell>
                <TableCell>Cash Reserve</TableCell>
                <TableCell>Cash</TableCell>
                <TableCell className="text-right">-</TableCell>
                <TableCell className="text-right">{(result.cashPriorWeight * 100).toFixed(1)}%</TableCell>
                <TableCell className="text-right text-primary font-bold">{(result.cashWeight * 100).toFixed(1)}%</TableCell>
                <TableCell className="text-right">
                  <span className={result.cashChange > 0 ? "text-green-600" : result.cashChange < 0 ? "text-red-600" : "text-gray-500"}>
                    {result.cashChange > 0 ? "+" : ""}{(result.cashChange * 100).toFixed(1)}%
                  </span>
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="outline" className="bg-gray-100">BASE</Badge>
                </TableCell>
              </TableRow>
              {result.allocations.sort((a,b) => b.weight - a.weight).map((etf) => (
                <TableRow key={etf.ticker} className={!etf.active ? "opacity-60 bg-gray-50/50" : ""}>
                  <TableCell className="font-medium">{etf.ticker}</TableCell>
                  <TableCell>{etf.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{etf.sector}</TableCell>
                  <TableCell className="text-right font-mono">{etf.factorScores.composite.toFixed(1)}</TableCell>
                  <TableCell className="text-right">{(etf.priorWeight * 100).toFixed(1)}%</TableCell>
                  <TableCell className={`text-right font-medium ${etf.active ? 'text-gray-900' : 'text-gray-400'}`}>
                    {(etf.weight * 100).toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-right">
                    {Math.abs(etf.change) > 0.0001 ? (
                      <span className={etf.change > 0 ? "text-green-600" : "text-red-600"}>
                        {etf.change > 0 ? "+" : ""}{(etf.change * 100).toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {etf.active ? (
                      <Badge variant="outline" className="bg-accent/10 text-accent border-accent/20">ACTIVE</Badge>
                    ) : (
                      <Badge variant="outline" className="text-gray-400 border-gray-200">OUT</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Factor Heatmap */}
      <Card>
        <CardHeader>
          <CardTitle>Factor Score Heatmap</CardTitle>
          <CardDescription>Underlying component scores for all evaluated ETFs (0-100 scale).</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="text-xs uppercase tracking-wider text-muted-foreground">
                <TableHead>Ticker</TableHead>
                <TableHead className="text-center">Comp</TableHead>
                <TableHead className="text-center">Mom20</TableHead>
                <TableHead className="text-center">Mom60</TableHead>
                <TableHead className="text-center">Mom120</TableHead>
                <TableHead className="text-center">Mom252</TableHead>
                <TableHead className="text-center">TrendQ</TableHead>
                <TableHead className="text-center">RealVol</TableHead>
                <TableHead className="text-center">Drawdn</TableHead>
                <TableHead className="text-center">MeanRev</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.allocations.sort((a,b) => b.factorScores.composite - a.factorScores.composite).map((etf) => (
                <TableRow key={etf.ticker} className="border-b border-gray-100 hover:bg-transparent">
                  <TableCell className="font-medium border-r border-gray-100">{etf.ticker}</TableCell>
                  <TableCell className={`text-center font-bold border-r border-gray-100 ${getCellColorClass(etf.factorScores.composite)}`}>
                    {etf.factorScores.composite.toFixed(0)}
                  </TableCell>
                  <TableCell className={`text-center ${getCellColorClass(etf.factorScores.mom20)}`}>{etf.factorScores.mom20.toFixed(0)}</TableCell>
                  <TableCell className={`text-center ${getCellColorClass(etf.factorScores.mom60)}`}>{etf.factorScores.mom60.toFixed(0)}</TableCell>
                  <TableCell className={`text-center ${getCellColorClass(etf.factorScores.mom120)}`}>{etf.factorScores.mom120.toFixed(0)}</TableCell>
                  <TableCell className={`text-center ${getCellColorClass(etf.factorScores.mom252)}`}>{etf.factorScores.mom252.toFixed(0)}</TableCell>
                  <TableCell className={`text-center ${getCellColorClass(etf.factorScores.trendQuality)}`}>{etf.factorScores.trendQuality.toFixed(0)}</TableCell>
                  <TableCell className={`text-center ${getCellColorClass(etf.factorScores.realizedVol60)}`}>{etf.factorScores.realizedVol60.toFixed(0)}</TableCell>
                  <TableCell className={`text-center ${getCellColorClass(etf.factorScores.drawdown)}`}>{etf.factorScores.drawdown.toFixed(0)}</TableCell>
                  <TableCell className={`text-center ${getCellColorClass(etf.factorScores.meanReversion)}`}>{etf.factorScores.meanReversion.toFixed(0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      <div className="text-center pb-8 pt-4">
        <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
          Methodology note: Allocations are constructed using a score-weighted algorithmic approach with continuity constraints. 
          Cash targets are dynamically adjusted based on the aggregate market regime score.
        </p>
      </div>
    </div>
  );
}
