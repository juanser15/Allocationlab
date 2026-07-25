import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { DetailDrawer } from "@/components/shared/DetailDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { Compass, Info, TrendingUp, TrendingDown, Activity } from "lucide-react";
import type { RunResult } from "@workspace/api-client-react"; // eslint-disable-line @typescript-eslint/no-unused-vars

interface Props {
  result: RunResult | undefined;
  hasData: boolean;
  hasRun: boolean;
}

function getRegimeBadgeStyle(label: string) {
  switch (label) {
    case "Risk-On": return "bg-green-100 text-green-800 border-green-200";
    case "Constructive": return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "Neutral": return "bg-amber-50 text-amber-800 border-amber-200";
    case "Cautious": return "bg-orange-50 text-orange-800 border-orange-200";
    case "Risk-Off": return "bg-red-100 text-red-800 border-red-200";
    default: return "bg-gray-100 text-gray-800 border-gray-200";
  }
}

function getBarColor(score: number) {
  if (score >= 65) return "bg-green-500";
  if (score >= 45) return "bg-amber-400";
  return "bg-red-500";
}

const REGIME_FACTOR_WEIGHTS: {
  factor: string;
  riskOn: number;
  neutral: number;
  riskOff: number;
  description: string;
}[] = [
  { factor: "Momentum", riskOn: 35, neutral: 25, riskOff: 10, description: "Price momentum signals receive highest weight when market trend is strong (Risk-On)." },
  { factor: "Trend Quality", riskOn: 30, neutral: 25, riskOff: 15, description: "Trend persistence and R² quality are emphasized in trending markets." },
  { factor: "Volatility", riskOn: 10, neutral: 20, riskOff: 35, description: "Low-volatility preference becomes dominant when regime is Risk-Off." },
  { factor: "Drawdown / Risk Fit", riskOn: 10, neutral: 15, riskOff: 25, description: "Drawdown avoidance is prioritized during defensive market regimes." },
  { factor: "Diversification", riskOn: 15, neutral: 15, riskOff: 15, description: "Diversification benefit remains constant across all regimes." },
];

const REGIME_COMPONENTS: {
  key: "trend" | "breadth" | "volatility" | "liquidity";
  label: string;
  description: string;
  methodology: string;
}[] = [
  {
    key: "trend",
    label: "Trend",
    description: "Measures the overall price trend of the universe. High scores indicate broad upward trending.",
    methodology: "Composite of 20D, 60D, and 252D momentum scores aggregated cross-sectionally. A score above 60 signals a bullish trend environment.",
  },
  {
    key: "breadth",
    label: "Breadth",
    description: "Market breadth indicator. Measures the percentage of universe ETFs above key moving averages.",
    methodology: "Proportion of ETFs above their 50D and 200D moving averages, averaged and scaled 0-100. Values above 60 indicate broad participation.",
  },
  {
    key: "volatility",
    label: "Volatility",
    description: "Realized volatility regime. High scores indicate a low-volatility environment (Risk-On).",
    methodology: "Inverse of cross-sectional realized volatility aggregate. EWMA-weighted. Scored 0-100 where 100 = minimal volatility stress.",
  },
  {
    key: "liquidity",
    label: "Liquidity",
    description: "Proxy for market liquidity conditions. Derived from bid-ask spreads and trading volume patterns.",
    methodology: "Proxied from volatility regime and trend breadth. Direct liquidity data requires external feed integration.",
  },
];

export function RegimesTab({ result, hasData, hasRun }: Props) {
  const [componentDetail, setComponentDetail] = useState<typeof REGIME_COMPONENTS[number] | null>(null);

  if (!hasData) return <EmptyState icon={Compass} title="Valid price history is required." description="Upload price data to compute regime scores." />;
  if (!hasRun || !result) return <EmptyState icon={Compass} title="Run Optimizer to compute market regime." description="Regime detection requires a completed optimizer run." />;

  const regime = result.regime;

  return (
    <div className="space-y-6">
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
                <div
                  className={`h-full rounded-full ${getBarColor(regime[componentDetail.key])}`}
                  style={{ width: `${regime[componentDetail.key]}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </DetailDrawer>

      {/* Current regime card */}
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

            {/* Component bars */}
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
                    <div
                      className={`h-full rounded-full transition-all ${getBarColor(regime[comp.key])}`}
                      style={{ width: `${regime[comp.key]}%` }}
                    />
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
            <CardDescription>Three visible portfolio regimes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Risk-On", range: "≥ 60", desc: "Strong trend + breadth. Momentum and trend factors dominant.", active: regime.composite >= 60 },
              { label: "Neutral", range: "40–60", desc: "Mixed signals. Balanced factor weights. Elevated cash buffer.", active: regime.composite >= 40 && regime.composite < 60 },
              { label: "Risk-Off", range: "< 40", desc: "Weak/declining trend. Volatility and drawdown factors dominant.", active: regime.composite < 40 },
            ].map(({ label, range, desc, active }) => (
              <div
                key={label}
                className={`border rounded-md px-3 py-3 ${active ? "border-primary bg-primary/5 shadow-sm" : "border-gray-200"}`}
              >
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

      {/* Adaptive factor weight table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Regime-Adaptive Factor Weights</CardTitle>
          <CardDescription>
            Factor group weights applied by the current regime. Editable in Settings → Model Factors. Versioned and auditable.
          </CardDescription>
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
                    <td className={`text-center px-4 py-2.5 font-bold ${regime.label === "Risk-On" || regime.label === "Constructive" ? "bg-green-50 text-green-700 border border-green-200 rounded" : "text-gray-600"}`}>
                      {row.riskOn}%
                    </td>
                    <td className={`text-center px-4 py-2.5 font-bold ${regime.label === "Neutral" || regime.label === "Cautious" ? "bg-amber-50 text-amber-700 border border-amber-200 rounded" : "text-gray-600"}`}>
                      {row.neutral}%
                    </td>
                    <td className={`text-center px-4 py-2.5 font-bold ${regime.label === "Risk-Off" ? "bg-red-50 text-red-700 border border-red-200 rounded" : "text-gray-600"}`}>
                      {row.riskOff}%
                    </td>
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
            <span>
              Currently active column highlighted in bold. These weights modify factor group scores before composite ranking.
              Regime-weight versioning ensures full reproducibility of historical runs.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Transition history note */}
      <Card className="border-dashed">
        <CardContent className="py-4">
          <Accordion type="single" collapsible>
            <AccordionItem value="transition" className="border-none">
              <AccordionTrigger className="text-xs font-medium text-muted-foreground hover:no-underline py-0">
                Regime Transition History & Persistence Notes
              </AccordionTrigger>
              <AccordionContent className="pt-3 pb-0 text-xs text-muted-foreground space-y-2">
                <p>Full transition history requires multiple historical runs with archived sessions. Navigate to the Archive section of Investment Committee to see regime evolution across stored sessions.</p>
                <p>Regime persistence is measured as the number of consecutive periods with the same regime label. Regime uncertainty is proxied by the distance of the composite score from the 40/60 boundaries.</p>
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
