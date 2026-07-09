import { useEffect } from "react";
import { Info } from "lucide-react";
import { useSettingsDrawer } from "@/context/settings-drawer-context";

const FACTORS = [
  { name: "Momentum", window: "20d / 60d / 120d / 252d blended", desc: "Standard price return over multiple lookback windows to balance responsiveness and noise." },
  { name: "Trend Quality", window: "Regression over trailing price series", desc: "R² of price vs. a linear regression line — rewards smooth, persistent trends." },
  { name: "Realized Volatility", window: "60d", desc: "Inverse of annualized daily-return standard deviation; lower volatility scores higher." },
  { name: "Drawdown", window: "252d high-water mark", desc: "Current price relative to the trailing 252-day high." },
  { name: "Short-Term Mean Reversion", window: "10d moving average", desc: "Deviation of price from its 10-day moving average, used as a timing adjustment." },
];

const REGIME_INPUTS = ["Trend breadth", "Volatility regime", "Liquidity conditions", "Cross-asset breadth"];

export function ModelFactorsSection() {
  const { reportSectionStatus } = useSettingsDrawer();

  useEffect(() => {
    reportSectionStatus("model-factors", { dirty: false, errorCount: 0 });
  }, [reportSectionStatus]);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-gray-900">Model & Factors</h3>
        <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
          Reference view of the factor and regime model that powers every run. These parameters are fixed by
          methodology in the current build — not user-adjustable — so results stay reproducible and auditable.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
        <Info className="h-4 w-4 shrink-0 mt-0.5 text-gray-400" />
        <span>
          Factor weights and windows are locked to the values below for this build. Making them user-adjustable would
          require re-validating the model, so it is deliberately out of scope until a future model version.
        </span>
      </div>

      <div className="border rounded-md divide-y">
        {FACTORS.map((f) => (
          <div key={f.name} className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-900">{f.name}</span>
              <span className="text-xs text-muted-foreground">{f.window}</span>
            </div>
            <p className="text-sm text-gray-600 mt-1">{f.desc}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium text-gray-900">Regime Model Inputs</span>
        <div className="flex flex-wrap gap-2">
          {REGIME_INPUTS.map((r) => (
            <span key={r} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 border border-gray-200">{r}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
