import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { EmptyState } from "@/components/shared/EmptyState";
import { DetailDrawer } from "@/components/shared/DetailDrawer";
import {
  FlaskConical, Info, Compass, TrendingUp, TrendingDown, Activity,
} from "lucide-react";
import type { RunResult } from "@workspace/api-client-react";

interface Props {
  result: RunResult | undefined;
  hasData: boolean;
  hasRun: boolean;
}

// ─── Factor definitions ──────────────────────────────────────────────────────

type FactorKey =
  | "composite" | "mom20" | "mom60" | "mom120" | "mom252"
  | "trendQuality" | "realizedVol60" | "drawdown" | "meanReversion";

const FACTOR_GROUPS: {
  group: string;
  factors: { key: FactorKey; label: string; formula: string; window: string; normalization: string; description: string }[];
}[] = [
  {
    group: "A — Momentum",
    factors: [
      { key: "mom20", label: "Momentum 20D", formula: "Momentum_i(20) = P_i,t / P_i,t−20 − 1", window: "20 trading days", normalization: "Cross-sectional percentile rank within universe", description: "Short-term price momentum. Captures recent trends over approximately one calendar month." },
      { key: "mom60", label: "Momentum 60D", formula: "Momentum_i(60) = P_i,t / P_i,t−60 − 1", window: "60 trading days", normalization: "Cross-sectional percentile rank within universe", description: "Medium-term momentum. Three-month horizon, balances signal persistence with responsiveness." },
      { key: "mom120", label: "Momentum 120D", formula: "Momentum_i(120) = P_i,t / P_i,t−120 − 1", window: "120 trading days", normalization: "Cross-sectional percentile rank within universe", description: "Six-month momentum. Primary institutional momentum horizon with strong academic backing." },
      { key: "mom252", label: "Momentum 252D", formula: "Momentum_i(252) = P_i,t / P_i,t−252 − 1", window: "252 trading days (1 year)", normalization: "Cross-sectional percentile rank within universe", description: "Annual momentum. Skips most recent month by default to avoid short-term reversal bias." },
    ],
  },
  {
    group: "B — Trend Quality",
    factors: [
      { key: "trendQuality", label: "Trend Quality", formula: "TrendQ = f(log-price slope R², persistence, MA distance)", window: "20D & 60D rolling", normalization: "Cross-sectional percentile rank; composite of sub-factors", description: "Composite quality of the price trend. Combines R² of log-price regression, trend persistence score, and distance from 50D/200D moving averages." },
    ],
  },
  {
    group: "C — Volatility",
    factors: [
      { key: "realizedVol60", label: "Realized Volatility 60D", formula: "σ_i(60) = annualized std(daily_returns_i, 60D) × √252", window: "60 trading days", normalization: "Inverse cross-sectional rank (lower vol = higher score)", description: "Annualized realized volatility over 60 trading days. Lower volatility ETFs receive higher scores." },
    ],
  },
  {
    group: "D — Drawdown / Risk Fit",
    factors: [
      { key: "drawdown", label: "Drawdown Risk Fit", formula: "DD_i = (P_i,t − max(P_i, t−252:t)) / max(P_i, t−252:t)", window: "252 trading days", normalization: "Inverse cross-sectional rank (smaller drawdown = higher score)", description: "Current drawdown from 252-day high. Penalizes ETFs that have fallen significantly from recent peaks." },
    ],
  },
  {
    group: "E — Mean Reversion",
    factors: [
      { key: "meanReversion", label: "Mean Reversion", formula: "Z_i(5D) = (R_i,5D − μ_cross) / σ_cross", window: "5 trading days", normalization: "Cross-sectional z-score; low z-score = higher reversion score", description: "Short-term reversal signal. ETFs with recent underperformance relative to peers receive a higher mean-reversion score." },
    ],
  },
];

function getCellColor(val: number) {
  if (val >= 80) return "bg-green-100 text-green-800";
  if (val >= 60) return "bg-green-50 text-green-700";
  if (val >= 40) return "bg-amber-50 text-amber-700";
  if (val >= 20) return "bg-red-50 text-red-700";
  return "bg-red-100 text-red-800";
}

// ─── Regime definitions ──────────────────────────────────────────────────────

function getRegimeBadgeStyle(label: string) {
  switch (label) {
    case "Risk-On":      return "bg-green-100 text-green-800 border-green-200";
    case "Constructive": return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "Neutral":      return "bg-amber-50 text-amber-800 border-amber-200";
    case "Cautious":     return "bg-orange-50 text-orange-800 border-orange-200";
    case "Risk-Off":     return "bg-red-100 text-red-800 border-red-200";
    default:             return "bg-gray-100 text-gray-800 border-gray-200";
  }
}

function getBarColor(score: number) {
  if (score >= 65) return "bg-green-500";
  if (score >= 45) return "bg-amber-400";
  return "bg-red-500";
}

const REGIME_FACTOR_WEIGHTS = [
  { factor: "Momentum",           riskOn: 35, neutral: 25, riskOff: 10, description: "Price momentum signals receive highest weight when market trend is strong (Risk-On)." },
  { factor: "Trend Quality",      riskOn: 30, neutral: 25, riskOff: 15, description: "Trend persistence and R² quality are emphasized in trending markets." },
  { factor: "Volatility",         riskOn: 10, neutral: 20, riskOff: 35, description: "Low-volatility preference becomes dominant when regime is Risk-Off." },
  { factor: "Drawdown / Risk Fit",riskOn: 10, neutral: 15, riskOff: 25, description: "Drawdown avoidance is prioritized during defensive market regimes." },
  { factor: "Diversification",    riskOn: 15, neutral: 15, riskOff: 15, description: "Diversification benefit remains constant across all regimes." },
];

const REGIME_COMPONENTS: {
  key: "trend" | "breadth" | "volatility" | "liquidity";
  label: string;
  description: string;
  methodology: string;
}[] = [
  { key: "trend",      label: "Trend",      description: "Measures the overall price trend of the universe. High scores indicate broad upward trending.",   methodology: "Composite of 20D, 60D, and 252D momentum scores aggregated cross-sectionally. A score above 60 signals a bullish trend environment." },
  { key: "breadth",    label: "Breadth",    description: "Market breadth indicator. Measures the percentage of universe ETFs above key moving averages.",   methodology: "Proportion of ETFs above their 50D and 200D moving averages, averaged and scaled 0–100. Values above 60 indicate broad participation." },
  { key: "volatility", label: "Volatility", description: "Realized volatility regime. High scores indicate a low-volatility environment (Risk-On).",         methodology: "Inverse of cross-sectional realized volatility aggregate. EWMA-weighted. Scored 0–100 where 100 = minimal volatility stress." },
  { key: "liquidity",  label: "Liquidity",  description: "Proxy for market liquidity conditions. Derived from bid-ask spreads and trading volume patterns.", methodology: "Proxied from volatility regime and trend breadth. Direct liquidity data requires external feed integration." },
];

// ─── Section header ──────────────────────────────────────────────────────────

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="pt-4">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      <div className="border-b border-gray-200 mt-3" />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FactorsRegimesTab({ result, hasData, hasRun }: Props) {
  const [drawerFactor, setDrawerFactor] = useState<{
    label: string; formula: string; window: string; normalization: string; description: string;
  } | null>(null);
  const [componentDetail, setComponentDetail] = useState<typeof REGIME_COMPONENTS[number] | null>(null);

  if (!hasData) return <EmptyState icon={FlaskConical} title="Valid price history is required." description="Upload price data to compute factor and regime scores." />;
  if (!hasRun || !result) return <EmptyState icon={FlaskConical} title="Run Optimizer to generate factor and regime scores." description="Factor heatmap, rankings, and regime analysis are computed by the optimizer pipeline." />;

  const allocs = result.allocations.slice().sort((a, b) => b.factorScores.composite - a.factorScores.composite);
  const regime = result.regime;

  return (
    <div className="space-y-6">
      {/* ── Factor drawer ── */}
      <DetailDrawer
        open={!!drawerFactor}
        onOpenChange={(o) => !o && setDrawerFactor(null)}
        title={drawerFactor?.label ?? "Factor Detail"}
      >
        {drawerFactor && (
          <div className="space-y-5 text-sm">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Definition</h4>
              <p className="text-gray-700 leading-relaxed">{drawerFactor.description}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Formula</h4>
              <pre className="font-mono text-xs bg-gray-50 border rounded p-3 whitespace-pre-wrap">{drawerFactor.formula}</pre>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Data Window</h4>
              <p className="text-gray-700">{drawerFactor.window}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Normalization</h4>
              <p className="text-gray-700">{drawerFactor.normalization}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Contribution to Composite</h4>
              <p className="text-gray-700">Composite = regime-weighted average of all factor group scores. Weights are set by the current market regime and editable in Settings → Model Factors.</p>
            </div>
          </div>
        )}
      </DetailDrawer>

      {/* ── Regime drawer ── */}
      <DetailDrawer
        open={!!componentDetail}
        onOpenChange={(o) => !o && setComponentDetail(null)}
        title={componentDetail ? `Regime Component: ${componentDetail.label}` : ""}
      >
        {componentDetail && (
          <div className="space-y-5 text-sm">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Description</h4>
              <p className="text-gray-700 leading-relaxed">{componentDetail.description}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Methodology</h4>
              <p className="text-gray-700 leading-relaxed">{componentDetail.methodology}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Current Score</h4>
              <div className="text-3xl font-bold text-primary">{regime[componentDetail.key].toFixed(1)}</div>
              <div className="mt-2 h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${getBarColor(regime[componentDetail.key])}`} style={{ width: `${regime[componentDetail.key]}%` }} />
              </div>
            </div>
          </div>
        )}
      </DetailDrawer>

      {/* ════════════════════════════════════════
          SECTION 1 — FACTORS
      ════════════════════════════════════════ */}
      <SectionHeader title="Factor Analysis" description="Cross-sectional factor scores and rankings across the full ETF universe." />

      {/* Normalization note */}
      <div className="flex items-start gap-2 rounded border border-blue-100 bg-blue-50/50 px-4 py-3 text-xs text-blue-800">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-400" />
        <div className="space-y-1">
          <p><strong>Normalization:</strong> All raw values are cross-sectionally ranked within the active universe at each computation date.</p>
          <p className="font-mono text-[11px] bg-blue-100/60 rounded px-2 py-1">
            PercentileScore_i = percentile_rank(x_i, universe) × 100
          </p>
          <p>Scores 0–100 where 100 = strongest signal within universe.</p>
        </div>
      </div>

      {/* Factor groups accordion */}
      <Accordion type="multiple" defaultValue={["A — Momentum", "B — Trend Quality", "C — Volatility", "D — Drawdown / Risk Fit", "E — Mean Reversion"]}>
        {FACTOR_GROUPS.map(({ group, factors }) => (
          <AccordionItem key={group} value={group}>
            <AccordionTrigger className="text-sm font-semibold text-primary hover:no-underline px-0">
              {group}
            </AccordionTrigger>
            <AccordionContent className="pt-2 pb-4">
              <div className="space-y-3">
                {factors.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setDrawerFactor(f)}
                    className="w-full text-left border rounded-md px-4 py-3 hover:border-primary/40 hover:bg-gray-50/80 transition-all"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-900">{f.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{f.description}</p>
                        <p className="font-mono text-[10px] text-gray-500 mt-1 truncate">{f.formula}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Window</p>
                        <p className="text-xs text-gray-700">{f.window}</p>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-1">
                      {allocs.slice(0, 8).map((a) => {
                        const score = a.factorScores[f.key];
                        return (
                          <div key={a.ticker} className={`text-center text-[10px] font-medium rounded px-1 py-0.5 ${getCellColor(score)}`}>
                            {a.ticker}: {score.toFixed(0)}
                          </div>
                        );
                      })}
                    </div>
                  </button>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {/* Factor heatmap */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Factor Heatmap — Full Universe</CardTitle>
          <CardDescription>All ETFs ranked by composite score. Click any row to see factor details.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader className="bg-gray-50 sticky top-0">
              <TableRow>
                <TableHead className="text-[10px] text-center w-8">#</TableHead>
                <TableHead className="text-[10px]">Ticker</TableHead>
                <TableHead className="text-[10px] text-center bg-primary/5 border-r">Composite</TableHead>
                <TableHead className="text-[10px] text-center">Mom 20D</TableHead>
                <TableHead className="text-[10px] text-center">Mom 60D</TableHead>
                <TableHead className="text-[10px] text-center">Mom 120D</TableHead>
                <TableHead className="text-[10px] text-center">Mom 252D</TableHead>
                <TableHead className="text-[10px] text-center">Trend Q</TableHead>
                <TableHead className="text-[10px] text-center">Vol 60D</TableHead>
                <TableHead className="text-[10px] text-center">Drawdown</TableHead>
                <TableHead className="text-[10px] text-center">MeanRev</TableHead>
                <TableHead className="text-[10px] text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocs.map((etf, idx) => (
                <TableRow
                  key={etf.ticker}
                  className="hover:bg-gray-50/70 cursor-pointer border-b border-gray-100"
                  onClick={() => {
                    const group = FACTOR_GROUPS.find((g) => g.factors.some((f) => etf.factorScores[f.key] !== undefined));
                    if (group) setDrawerFactor(group.factors[0]);
                  }}
                >
                  <TableCell className="text-center text-[10px] text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell className="font-semibold text-xs text-primary border-r">{etf.ticker}</TableCell>
                  <TableCell className={`text-center text-xs font-bold border-r ${getCellColor(etf.factorScores.composite)}`}>{etf.factorScores.composite.toFixed(0)}</TableCell>
                  <TableCell className={`text-center text-xs ${getCellColor(etf.factorScores.mom20)}`}>{etf.factorScores.mom20.toFixed(0)}</TableCell>
                  <TableCell className={`text-center text-xs ${getCellColor(etf.factorScores.mom60)}`}>{etf.factorScores.mom60.toFixed(0)}</TableCell>
                  <TableCell className={`text-center text-xs ${getCellColor(etf.factorScores.mom120)}`}>{etf.factorScores.mom120.toFixed(0)}</TableCell>
                  <TableCell className={`text-center text-xs ${getCellColor(etf.factorScores.mom252)}`}>{etf.factorScores.mom252.toFixed(0)}</TableCell>
                  <TableCell className={`text-center text-xs ${getCellColor(etf.factorScores.trendQuality)}`}>{etf.factorScores.trendQuality.toFixed(0)}</TableCell>
                  <TableCell className={`text-center text-xs ${getCellColor(etf.factorScores.realizedVol60)}`}>{etf.factorScores.realizedVol60.toFixed(0)}</TableCell>
                  <TableCell className={`text-center text-xs ${getCellColor(etf.factorScores.drawdown)}`}>{etf.factorScores.drawdown.toFixed(0)}</TableCell>
                  <TableCell className={`text-center text-xs ${getCellColor(etf.factorScores.meanReversion)}`}>{etf.factorScores.meanReversion.toFixed(0)}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={etf.active ? "text-[10px] bg-green-50 text-green-700 border-green-200" : "text-[10px] text-gray-400"}>
                      {etf.active ? "ACTIVE" : "OUT"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ════════════════════════════════════════
          SECTION 2 — MARKET REGIME
      ════════════════════════════════════════ */}
      <SectionHeader title="Market Regime" description="Systematic regime detection from trend, breadth, volatility, and liquidity signals." />

      {/* Current regime + map */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 border-l-4 border-l-primary">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Current Market Regime
            </CardTitle>
            <CardDescription>Determined from composite of trend, breadth, volatility, and liquidity signals.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-4 flex-wrap">
              <div className={`inline-flex items-center px-4 py-2 rounded-full text-base font-semibold border ${getRegimeBadgeStyle(regime.label)}`}>
                {regime.label === "Risk-On" ? <TrendingUp className="h-4 w-4 mr-2" /> : regime.label === "Risk-Off" ? <TrendingDown className="h-4 w-4 mr-2" /> : <Activity className="h-4 w-4 mr-2" />}
                {regime.label}
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-primary">{regime.composite.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">Composite / 100</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {REGIME_COMPONENTS.map((comp) => (
                <button
                  key={comp.key}
                  onClick={() => setComponentDetail(comp)}
                  className="w-full text-left border rounded-md px-4 py-3 hover:border-primary/40 hover:bg-gray-50/80 transition-all"
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-semibold text-gray-700">{comp.label}</span>
                    <span className="text-sm font-bold text-gray-900 tabular-nums">{regime[comp.key].toFixed(0)}</span>
                  </div>
                  <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${getBarColor(regime[comp.key])}`} style={{ width: `${regime[comp.key]}%` }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5 line-clamp-1">{comp.description}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Regime Map</CardTitle>
            <CardDescription>Three portfolio regime states.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Risk-On",  range: "≥ 60", desc: "Strong trend + breadth. Momentum and trend factors dominant.",        active: regime.composite >= 60 },
              { label: "Neutral",  range: "40–60", desc: "Mixed signals. Balanced factor weights. Elevated cash buffer.",       active: regime.composite >= 40 && regime.composite < 60 },
              { label: "Risk-Off", range: "< 40",  desc: "Weak/declining trend. Volatility and drawdown factors dominant.",    active: regime.composite < 40 },
            ].map(({ label, range, desc, active }) => (
              <div key={label} className={`border rounded-md px-3 py-3 ${active ? "border-primary bg-primary/5 shadow-sm" : "border-gray-200"}`}>
                <div className="flex items-center justify-between mb-1">
                  <Badge variant="outline" className={`text-[10px] ${getRegimeBadgeStyle(label)}`}>{label}</Badge>
                  {active && <Badge className="text-[10px] bg-primary text-white">CURRENT</Badge>}
                  <span className="text-[10px] text-muted-foreground">{range}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">{desc}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Regime-adaptive factor weights */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Regime-Adaptive Factor Weights</CardTitle>
          <CardDescription>Factor group weights applied by the current regime. Editable in Settings → Model Factors.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-700">Factor Group</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-green-700 bg-green-50/50">Risk-On</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-amber-700 bg-amber-50/50">Neutral</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-red-700 bg-red-50/50">Risk-Off</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-500">Notes</th>
                </tr>
              </thead>
              <tbody>
                {REGIME_FACTOR_WEIGHTS.map((row, i) => (
                  <tr key={row.factor} className={`border-b ${i % 2 === 0 ? "bg-white" : "bg-gray-50/40"}`}>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{row.factor}</td>
                    <td className={`text-center px-4 py-2.5 font-bold ${regime.label === "Risk-On" || regime.label === "Constructive" ? "bg-green-50 text-green-700" : "text-gray-600"}`}>{row.riskOn}%</td>
                    <td className={`text-center px-4 py-2.5 font-bold ${regime.label === "Neutral" || regime.label === "Cautious" ? "bg-amber-50 text-amber-700" : "text-gray-600"}`}>{row.neutral}%</td>
                    <td className={`text-center px-4 py-2.5 font-bold ${regime.label === "Risk-Off" ? "bg-red-50 text-red-700" : "text-gray-600"}`}>{row.riskOff}%</td>
                    <td className="px-4 py-2.5 text-[11px] text-muted-foreground">{row.description}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-300 bg-gray-100/60 font-bold">
                  <td className="px-4 py-2 text-gray-700">Total</td>
                  <td className="text-center px-4 py-2 text-green-700">100%</td>
                  <td className="text-center px-4 py-2 text-amber-700">100%</td>
                  <td className="text-center px-4 py-2 text-red-700">100%</td>
                  <td className="px-4 py-2 text-[11px] text-muted-foreground">Sum-to-one constraint</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>Currently active column highlighted. Regime-weight versioning ensures full reproducibility of historical runs.</span>
          </div>
        </CardContent>
      </Card>

      {/* Transition note */}
      <Card className="border-dashed">
        <CardContent className="py-4">
          <Accordion type="single" collapsible>
            <AccordionItem value="transition" className="border-none">
              <AccordionTrigger className="text-xs font-medium text-muted-foreground hover:no-underline py-0">
                Regime Transition History & Persistence Notes
              </AccordionTrigger>
              <AccordionContent className="pt-3 pb-0 text-xs text-muted-foreground space-y-2">
                <p>Full transition history requires multiple historical runs with archived sessions. Navigate to the Archive section of Investment Committee to see regime evolution across stored sessions.</p>
                <div className="flex items-start gap-2 mt-2 border rounded px-3 py-2 bg-gray-50">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>Regime components: Trend ({regime.trend.toFixed(0)}) · Breadth ({regime.breadth.toFixed(0)}) · Volatility ({regime.volatility.toFixed(0)}) · Liquidity ({regime.liquidity.toFixed(0)})</span>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
