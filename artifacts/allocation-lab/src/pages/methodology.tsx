import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CheckSquare, Square } from "lucide-react";

export default function Methodology() {
  const cycles = [
    { id: 1, label: "Core UI scaffold & navigation", done: true },
    { id: 2, label: "Price data upload & Yahoo Finance integration", done: true },
    { id: 3, label: "Factor computation engine (8 factors)", done: true },
    { id: 4, label: "Regime estimation & allocation constructor", done: true },
    { id: 5, label: "Results dashboard with factor heatmap", done: true },
    { id: 6, label: "Report generation (CSV + PDF)", done: true },
    { id: 7, label: "Session history & reporting", done: true },
    { id: 8, label: "10-component Market Health module + IC Summary + Watchlist", done: true },
    { id: 9, label: "Portfolio Diagnostics (vol, HHI, ENB, risk contributions, correlation heatmap, tracking error)", done: true },
    { id: 10, label: "Historical regime trend chart, session comparison & Dollar/Rates components", done: false },
  ];

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Methodology & Documentation</h1>
        <p className="text-muted-foreground mt-2">Underlying logic for the Allocation Lab v2 model.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-8">

          {/* Factor Definitions */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-primary border-b pb-2">Factor Definitions</h2>
            <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
              <div>
                <h3 className="font-bold text-gray-900">Momentum (20d, 60d, 120d, 252d)</h3>
                <p>Standard price return over the specified lookback window. Captures multiple timeframes to smooth short-term noise while maintaining responsiveness to trend shifts.</p>
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Trend Quality</h3>
                <p>R² of the price series versus a linear regression line. Penalizes volatile, jagged trends and rewards smooth, persistent price movement.</p>
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Realized Volatility (60d)</h3>
                <p>Inverse of the annualized standard deviation of daily returns over 60 days. Higher scores indicate lower volatility (a positive signal for inclusion).</p>
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Drawdown</h3>
                <p>Current price relative to the 252-day high. Higher scores indicate smaller drawdowns from peak.</p>
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Short-term Mean Reversion</h3>
                <p>Deviation of price from the 10-day moving average. Used as a short-term timing adjustment to avoid buying extended spikes.</p>
              </div>
            </div>
          </section>

          <Separator />

          {/* Market Regime */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-primary border-b pb-2">Market Health Framework (Iteration 2)</h2>
            <p className="text-sm text-gray-700">
              The regime model evaluates 10 components across three tiers. Only <strong>computed</strong> and <strong>proxy</strong> signals contribute to the composite; unavailable signals are clearly flagged.
            </p>

            <div className="space-y-4 text-sm">
              <div>
                <h3 className="font-semibold text-green-700 uppercase tracking-wide text-xs mb-2">Computed — derived directly from uploaded price data</h3>
                <div className="space-y-2 text-gray-700">
                  <div><span className="font-semibold">Trend (25%):</span> Percentage of universe ETFs above their 50-day and 200-day moving averages, blended 60/40.</div>
                  <div><span className="font-semibold">Breadth (20%):</span> Advance-decline ratio of the ETF universe over 20 trading days.</div>
                  <div><span className="font-semibold">Volatility (20%):</span> Inverse of average 20-day realized volatility across the universe; mapped to 0–100.</div>
                  <div><span className="font-semibold">Liquidity (10%):</span> Short-term cross-sectional return dispersion. Lower dispersion signals tighter conditions.</div>
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-amber-700 uppercase tracking-wide text-xs mb-2">Proxy — ETF-derived estimates (partial signal strength)</h3>
                <div className="space-y-2 text-gray-700">
                  <div><span className="font-semibold">Credit (10%):</span> XLF 20-day momentum relative to the universe median. Financials outperformance signals credit support.</div>
                  <div><span className="font-semibold">Commodities (8%):</span> XLE + XLB average relative momentum vs. the universe. Signals inflation/growth demand.</div>
                  <div><span className="font-semibold">Cross-Asset Confirmation (7%):</span> Average pairwise 20-day return correlation. Higher = broader participation and trend confirmation.</div>
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-gray-500 uppercase tracking-wide text-xs mb-2">Unavailable — require external data not in current upload</h3>
                <div className="space-y-2 text-gray-500">
                  <div><span className="font-semibold">Dollar:</span> Requires DXY or currency ETF (UUP/FXE). Add to price upload to activate.</div>
                  <div><span className="font-semibold">Rates:</span> Requires Treasury yield data via IEF or TLT. Add to price upload to activate.</div>
                  <div><span className="font-semibold">Earnings Revision:</span> Requires external EPS consensus data. Cannot be derived from prices alone.</div>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 rounded-md p-3 text-xs text-gray-600 border">
              <strong>Confidence score:</strong> Computed and proxy components each carry a weight (computed = 2 pts, proxy = 1 pt). Confidence = actual earned points / maximum possible (11 pts), scaled to 0–100%. A confidence below 60% means key macro dimensions are missing and external judgment should supplement the model.
            </div>
          </section>

          <Separator />

          {/* Allocation Algorithm */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-primary border-b pb-2">Allocation Algorithm</h2>
            <p className="text-sm text-gray-700 leading-relaxed">
              Target weights are determined by a score-weighted approach with continuity constraints.
              ETFs are ranked by Composite factor score; the top N (per the target in Constraints) receive
              allocations proportional to their scores. Changes from prior month weights are dampened
              (30% continuity pull) to reduce turnover. Cash is dynamically adjusted: higher regime composite
              scores pull cash toward the lower bound; weaker conditions push it toward the upper bound.
            </p>
            <div className="bg-gray-50 rounded-md p-3 text-xs text-gray-600 border">
              <strong>Validation:</strong> All factor and regime scores are computed from real uploaded price data only.
              ETFs with fewer than 21 rows of price history are excluded. No synthetic or placeholder values are used.
              If fewer than the target active ETFs meet the inclusion threshold, the model does not fill positions artificially.
            </div>
          </section>
        </div>

        {/* Build Progress sidebar */}
        <div className="md:col-span-1">
          <Card className="sticky top-8 bg-gray-50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
                  Build Progress
                </CardTitle>
                <span className="text-xs font-semibold text-primary bg-primary/10 rounded px-2 py-0.5">
                  {cycles.filter((c) => c.done).length} / {cycles.length}
                </span>
              </div>
              <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${(cycles.filter((c) => c.done).length / cycles.length) * 100}%` }}
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {cycles.map((cycle) => (
                  <div key={cycle.id} className="flex items-start gap-1.5">
                    {cycle.done ? (
                      <CheckSquare className="h-3.5 w-3.5 text-green-600 mt-0.5 shrink-0" />
                    ) : (
                      <Square className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
                    )}
                    <span className={`text-xs leading-tight ${cycle.done ? "text-gray-400 line-through" : "text-gray-700 font-medium"}`}>
                      {cycle.id}. {cycle.label}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
