import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";

export default function Methodology() {
  const cycles = [
    { id: 1, label: "Core UI scaffold & navigation", done: true },
    { id: 2, label: "Price data upload integration", done: true },
    { id: 3, label: "Factor computation engine implementation", done: true },
    { id: 4, label: "Regime estimation logic", done: true },
    { id: 5, label: "Allocation constructor algorithm", done: false },
    { id: 6, label: "Results dashboard with score heatmap", done: false },
    { id: 7, label: "Report generation (CSV export)", done: false },
    { id: 8, label: "Report generation (PDF/PNG)", done: false },
    { id: 9, label: "Session history tracking", done: false },
    { id: 10, label: "Final polish and validation", done: false },
  ];

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Methodology & Documentation</h1>
        <p className="text-muted-foreground mt-2">Underlying logic for the Allocation Lab v2 model.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-8">
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-primary border-b pb-2">Factor Definitions</h2>
            <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
              <div>
                <h3 className="font-bold text-gray-900">Momentum (20d, 60d, 120d, 252d)</h3>
                <p>Standard price return over the specified lookback window. Captures multiple timeframes to smooth out short-term noise while maintaining responsiveness to trend shifts.</p>
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Trend Quality</h3>
                <p>R² of the price series versus a linear regression line. Penalizes volatile, jagged trends and rewards smooth, persistent price movement.</p>
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Realized Volatility (60d)</h3>
                <p>Inverse of the annualized standard deviation of daily returns over 60 days. Higher scores indicate lower volatility.</p>
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Drawdown</h3>
                <p>Current price relative to the 252-day high. Higher scores indicate smaller drawdowns.</p>
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Short-term Mean Reversion</h3>
                <p>Deviation of price from the 10-day moving average. Used as a short-term timing adjustment to avoid buying extended spikes.</p>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-primary border-b pb-2">Market Regime Logic</h2>
            <p className="text-sm text-gray-700">
              The regime model dictates the base cash allocation and adjusts risk tolerance dynamically.
            </p>
            <ul className="list-disc list-inside text-sm text-gray-700 ml-4 space-y-2">
              <li><strong>Trend:</strong> Percentage of universe ETFs trading above their 50-day and 200-day moving averages.</li>
              <li><strong>Breadth:</strong> Advance-decline metrics across the ETF universe.</li>
              <li><strong>Volatility:</strong> VIX proxy derived from aggregate realized volatility of the universe.</li>
              <li><strong>Liquidity:</strong> Recent trading volume ratio versus historical norms.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-primary border-b pb-2">Allocation Algorithm</h2>
            <p className="text-sm text-gray-700 leading-relaxed">
              Target weights are determined by a score-weighted approach subject to continuity constraints. 
              The system ranks ETFs by their Composite factor score. The top N ETFs (defined in Constraints) 
              receive allocations proportional to their scores. Changes from prior month weights are dampened 
              to reduce turnover, ensuring smooth transitions unless regime shifts are severe. Sector concentration 
              caps are applied if Diversification is enabled.
            </p>
          </section>
        </div>

        <div className="md:col-span-1">
          <Card className="sticky top-8 bg-gray-50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base uppercase tracking-wider text-muted-foreground">Build Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {cycles.map((cycle) => (
                  <div key={cycle.id} className="flex items-start space-x-2">
                    <Checkbox checked={cycle.done} disabled className="mt-0.5" />
                    <label className={`text-sm leading-tight ${cycle.done ? 'text-gray-400 line-through' : 'text-gray-700 font-medium'}`}>
                      {cycle.id}. {cycle.label}
                    </label>
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
