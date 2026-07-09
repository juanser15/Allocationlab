import { useParams } from "wouter";
import { useGetEtfDetail } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartTooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Loader2, ArrowLeft, Info, AlertTriangle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Link } from "wouter";

// ── Helpers ────────────────────────────────────────────────────────────────────

function scoreColor(v: number): string {
  if (v >= 80) return "bg-green-100 text-green-800";
  if (v >= 60) return "bg-green-50 text-green-700";
  if (v >= 40) return "bg-amber-50 text-amber-700";
  if (v >= 20) return "bg-red-50 text-red-700";
  return "bg-red-100 text-red-800";
}

function barWidth(v: number): string { return `${Math.max(2, Math.round(v))}%`; }

function barFill(v: number): string {
  if (v >= 70) return "bg-green-500";
  if (v >= 50) return "bg-green-400";
  if (v >= 35) return "bg-amber-400";
  if (v >= 20) return "bg-orange-400";
  return "bg-red-500";
}

function changeIcon(chg: number) {
  if (chg > 0.005) return <TrendingUp className="h-3.5 w-3.5 text-green-600" />;
  if (chg < -0.005) return <TrendingDown className="h-3.5 w-3.5 text-red-600" />;
  return <Minus className="h-3.5 w-3.5 text-gray-400" />;
}

function statusConfig(status: string) {
  switch (status) {
    case "active": return { label: "Active", cls: "bg-green-100 text-green-800 border-green-200" };
    case "excluded_threshold": return { label: "Below Threshold", cls: "bg-red-100 text-red-800 border-red-200" };
    case "excluded_rank": return { label: "Rank Cutoff", cls: "bg-amber-100 text-amber-800 border-amber-200" };
    case "no_data": return { label: "No Price Data", cls: "bg-gray-100 text-gray-600 border-gray-200" };
    default: return { label: "No Results", cls: "bg-gray-100 text-gray-500 border-gray-200" };
  }
}

function ordinal(n: number): string {
  if (n === 1) return "1st"; if (n === 2) return "2nd"; if (n === 3) return "3rd";
  return `${n}th`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleString("default", { month: "short" })} ${d.getDate()}`;
}

function InfoTip({ tip }: { tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-3.5 w-3.5 text-muted-foreground/50 inline-block cursor-default ml-1 shrink-0" />
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-xs leading-relaxed">{tip}</TooltipContent>
    </Tooltip>
  );
}

const FACTOR_META: Array<{
  key: string;
  label: string;
  shortLabel: string;
  tip: string;
}> = [
  { key: "composite", label: "Composite", shortLabel: "Composite", tip: "Weighted average of all 8 factor scores. Used directly for ETF selection and ranking." },
  { key: "mom20",    label: "Momentum 20d",     shortLabel: "Mom 20d",  tip: "20-day price return relative to universe peers. Captures short-term trend direction." },
  { key: "mom60",    label: "Momentum 60d",     shortLabel: "Mom 60d",  tip: "60-day price return. Balances responsiveness and noise — primary momentum signal." },
  { key: "mom120",   label: "Momentum 120d",    shortLabel: "Mom 120d", tip: "4-month return. Captures intermediate-term trend with less short-term noise." },
  { key: "mom252",   label: "Momentum 252d",    shortLabel: "Mom 252d", tip: "12-month return. Long-duration trend signal; classic Jegadeesh-Titman momentum." },
  { key: "trendQuality", label: "Trend Quality", shortLabel: "Trend Q", tip: "R² of price series against a 120-day linear regression. Rewards smooth, persistent trends; penalizes choppy movement." },
  { key: "realizedVol60", label: "Low Volatility (60d)", shortLabel: "Low Vol", tip: "Inverse of 60-day annualized realized volatility. Higher scores = lower vol = safer carry. Favours calm, persistent movers." },
  { key: "drawdown", label: "Drawdown",          shortLabel: "Drawdown", tip: "Proximity to 252-day high. Higher scores indicate smaller peak-to-current drawdown. Filters out damaged positions." },
  { key: "meanReversion", label: "Mean Reversion", shortLabel: "Mean Rev", tip: "Short-term dip-buying signal: excess below the 20-day MA. A high score means the ETF is stretched below its MA — used as a small contrarian timing adjustment." },
];

// ── Custom price chart tooltip ─────────────────────────────────────────────────

function PriceTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded shadow-sm px-3 py-2 text-xs">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-semibold text-gray-900">${payload[0]?.value?.toFixed(2)}</p>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function EtfDetail() {
  const params = useParams<{ ticker: string }>();
  const ticker = (params?.ticker ?? "").toUpperCase();
  const { data: etf, isLoading, error } = useGetEtfDetail(ticker);

  if (!ticker) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <p className="text-muted-foreground">No ticker specified.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-8 max-w-5xl mx-auto flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-muted-foreground text-sm">Loading {ticker} data...</span>
      </div>
    );
  }

  if (error || !etf) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <Link href="/results" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary mb-6">
          <ArrowLeft className="h-4 w-4" /> Results Dashboard
        </Link>
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-8 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-3" />
            <p className="text-sm font-medium text-amber-800 mb-1">{ticker} not found in the configured universe.</p>
            <p className="text-xs text-amber-700">Check the ETF universe in Portfolio Construction.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const sc = etf.factorScores;
  const status = statusConfig(etf.inclusionStatus);
  const hasPrices = etf.priceHistory.length > 0;
  const hasScores = !!sc;
  const hasHistory = etf.scoreHistory.length > 1;

  // Index price history to 100 at start for a normalized view
  const startPrice = hasPrices ? etf.priceHistory[0].price : 1;
  const chartData = etf.priceHistory.map((pt) => ({
    date: shortDate(pt.date),
    fullDate: pt.date,
    price: pt.price,
    indexed: Math.round((pt.price / startPrice) * 10000) / 100,
  }));

  // Compute return over displayed window
  const windowReturn = hasPrices
    ? ((etf.priceHistory[etf.priceHistory.length - 1].price - startPrice) / startPrice) * 100
    : 0;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/results" className="hover:text-primary transition-colors flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Results Dashboard
        </Link>
        <span>·</span>
        <Link href="/portfolio" className="hover:text-primary transition-colors">Portfolio Construction</Link>
        <span>·</span>
        <span className="text-gray-900 font-medium">{ticker}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-primary">{ticker}</h1>
            <Badge variant="outline" className={`${status.cls} text-xs font-semibold px-2 py-1`}>
              {status.label}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1">{etf.name} · <span className="text-gray-500">{etf.sector}</span></p>
          {etf.rank && (
            <p className="text-sm text-muted-foreground mt-1">
              Ranked <strong className="text-gray-800">{ordinal(etf.rank)}</strong> of {etf.totalScored} scored ETFs
              {hasPrices && etf.priceDataEnd && ` · Price data through ${etf.priceDataEnd}`}
            </p>
          )}
        </div>
        {etf.lookbackRows > 0 && (
          <div className="text-right shrink-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Price History</p>
            <p className="font-semibold text-gray-700">{etf.lookbackRows} trading days</p>
            <p className="text-xs text-muted-foreground">{etf.priceDataStart} → {etf.priceDataEnd}</p>
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Current Weight</p>
            <p className="text-3xl font-bold text-primary mt-1">
              {etf.active ? `${(etf.weight * 100).toFixed(1)}%` : "0.0%"}
            </p>
            <div className="flex items-center gap-1 mt-1 text-xs">
              {changeIcon(etf.change)}
              <span className={etf.change > 0.005 ? "text-green-600" : etf.change < -0.005 ? "text-red-600" : "text-gray-400"}>
                {etf.change > 0 ? "+" : ""}{(etf.change * 100).toFixed(1)}pp vs prior
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              Composite Score
              <InfoTip tip="Weighted average of all 8 factor scores. Scale 0-100, cross-sectional rank across the universe." />
            </p>
            {hasScores ? (
              <>
                <p className="text-3xl font-bold text-primary mt-1">{sc.composite.toFixed(1)}</p>
                <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${barFill(sc.composite)}`} style={{ width: barWidth(sc.composite) }} />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground mt-2 italic">No score data</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              Universe Rank
              <InfoTip tip="Rank by composite score among all ETFs that received a score this run. 1 = highest-scoring." />
            </p>
            {etf.rank ? (
              <>
                <p className="text-3xl font-bold text-primary mt-1">{ordinal(etf.rank)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">of {etf.totalScored} scored</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground mt-2 italic">Not scored</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Prior Weight</p>
            <p className="text-3xl font-bold text-gray-600 mt-1">{(etf.priorWeight * 100).toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground mt-0.5">previous month target</p>
          </CardContent>
        </Card>
      </div>

      {/* Explanation */}
      <Card className="border-l-4 border-l-primary/40 bg-primary/3">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Info className="h-4 w-4 text-primary/70" />
            Investment Committee Narrative
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-800 leading-relaxed">{etf.explanation}</p>
        </CardContent>
      </Card>

      {/* Price chart + Factor scores */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Price chart */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base">{ticker} Price Chart</CardTitle>
                <CardDescription className="text-xs">
                  Last {etf.priceHistory.length} trading days · adjusted close
                </CardDescription>
              </div>
              {hasPrices && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Period return</p>
                  <p className={`text-sm font-semibold ${windowReturn >= 0 ? "text-green-700" : "text-red-600"}`}>
                    {windowReturn >= 0 ? "+" : ""}{windowReturn.toFixed(1)}%
                  </p>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!hasPrices ? (
              <div className="h-52 flex items-center justify-center text-sm text-muted-foreground italic">
                No price data available for {ticker}.
                <br />Add {ticker} to your uploaded price CSV.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ left: -12, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "#9ca3af" }}
                    tickLine={false}
                    axisLine={false}
                    interval={Math.floor(chartData.length / 5)}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#9ca3af" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `$${v}`}
                    domain={["auto", "auto"]}
                    width={48}
                  />
                  <RechartTooltip content={<PriceTooltip />} />
                  <ReferenceLine y={startPrice} stroke="#e5e7eb" strokeDasharray="3 3" />
                  <Line
                    type="monotone"
                    dataKey="price"
                    stroke="#1B2F5B"
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 3, fill: "#1B2F5B" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Factor breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Factor Score Breakdown</CardTitle>
            <CardDescription className="text-xs">
              0–100 cross-sectional rank within the ETF universe
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!hasScores ? (
              <div className="h-52 flex items-center justify-center text-sm text-muted-foreground italic">
                Factor scores not available — insufficient price history or no pipeline run.
              </div>
            ) : (
              <div className="space-y-2.5">
                {FACTOR_META.map(({ key, shortLabel, tip }) => {
                  const val = sc[key as keyof typeof sc] as number;
                  if (key === "composite") return null;
                  return (
                    <div key={String(key)} className="space-y-0.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1 text-gray-600 font-medium">
                          {shortLabel}
                          <InfoTip tip={tip} />
                        </span>
                        <span className={`font-bold tabular-nums rounded px-1.5 py-0.5 text-[11px] ${scoreColor(val)}`}>
                          {val.toFixed(0)}
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${barFill(val)}`}
                          style={{ width: barWidth(val) }}
                        />
                      </div>
                    </div>
                  );
                })}

                {/* Composite summary */}
                <div className="border-t pt-2 mt-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-800 font-bold flex items-center gap-1">
                      Composite
                      <InfoTip tip="Weighted sum: Mom20 (20%) + Mom60 (20%) + Mom120 (15%) + Mom252 (15%) + TrendQ (10%) + LowVol (10%) + Drawdown (5%) + MeanRev (5%)" />
                    </span>
                    <span className={`font-bold tabular-nums rounded px-1.5 py-0.5 text-[11px] ${scoreColor(sc.composite)}`}>
                      {sc.composite.toFixed(1)}
                    </span>
                  </div>
                  <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden mt-0.5">
                    <div
                      className={`h-full rounded-full transition-all ${barFill(sc.composite)}`}
                      style={{ width: barWidth(sc.composite) }}
                    />
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Score history */}
      {hasHistory && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Score History</CardTitle>
            <CardDescription className="text-xs">Composite score and rank across recent pipeline runs</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="text-left pb-2 font-semibold pr-4">Run Date</th>
                  <th className="text-right pb-2 font-semibold pr-4">Composite</th>
                  <th className="text-right pb-2 font-semibold pr-4">Rank</th>
                  <th className="text-right pb-2 font-semibold pr-4">Weight</th>
                  <th className="text-center pb-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {etf.scoreHistory.map((h, i) => (
                  <tr key={h.sessionId} className={`border-b border-gray-50 ${i === 0 ? "bg-primary/3" : ""}`}>
                    <td className="py-2 pr-4 text-gray-700">
                      {new Date(h.runAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
                      {i === 0 && <span className="ml-2 text-[10px] text-primary font-semibold uppercase">latest</span>}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${scoreColor(h.composite)}`}>
                        {h.composite.toFixed(1)}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-600 tabular-nums">{ordinal(h.rank)}</td>
                    <td className="py-2 pr-4 text-right text-gray-600 tabular-nums">
                      {h.weight > 0 ? `${(h.weight * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className="py-2 text-center">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${h.active ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-500 border-gray-200"}`}
                      >
                        {h.active ? "Active" : "Out"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Insufficient data notice */}
      {etf.lookbackRows < 21 && (
        <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Only <strong>{etf.lookbackRows}</strong> price rows available for {ticker}.
            The model requires at least 21 rows to compute factor scores.
            Ensure {ticker} has sufficient history in your uploaded price CSV.
          </span>
        </div>
      )}
    </div>
  );
}
