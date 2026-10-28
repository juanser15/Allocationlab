import {
  DEFAULT_FORECAST,
  forecastNames,
  type ForecastConfig,
} from "../../../api-server/src/lib/workbench/coordinated-contract";
import { Card, pct } from "./coordinated-ui";

const labels = {
  MOMENTUM: "Absolute momentum",
  RELATIVE_MOMENTUM: "Relative momentum",
  TREND: "Trend quality · signed R²",
  REVERSAL: "Short reversal",
};
export function ForecastDesign({
  value = DEFAULT_FORECAST,
  onChange,
}: {
  value?: ForecastConfig;
  onChange: (v: ForecastConfig) => void;
}) {
  const set = (key: keyof ForecastConfig, v: unknown) =>
    onChange({ ...value, [key]: v });
  const number = (
    key: keyof ForecastConfig,
    label: string,
    min?: number,
    percent = false,
  ) => (
    <label>
      {label}
      <input
        type="number"
        min={min}
        step={percent ? 0.1 : key === "ridge_penalty" ? "any" : 1}
        value={
          Number.isNaN(Number(value[key]))
            ? ""
            : Number(value[key]) * (percent ? 100 : 1)
        }
        onInput={(e) =>
          set(
            key,
            e.currentTarget.value === ""
              ? NaN
              : Number(e.currentTarget.value) / (percent ? 100 : 1),
          )
        }
      />
    </label>
  );
  return (
    <Card title="Asset forecasts">
      <label>
        Forecast model
        <select
          value={value.model}
          onChange={(e) => set("model", e.target.value)}
        >
          {Object.entries(forecastNames).map(([k, name]) => (
            <option key={k} value={k}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {value.model === "HISTORICAL_MEAN" ? (
        <p className="cp-note">
          Reference calculation: historical arithmetic mean of daily returns ×
          252, using the chosen risk/regime training window in Backtesting. The
          original monthly/quarterly objective horizon is preserved. Alternative
          models do not change this reference.
        </p>
      ) : (
        <>
          <div className="cp-fields">
            {number("horizon_sessions", "Forecast horizon · sessions", 1)}
            {value.model === "SIGNAL_RIDGE" &&
              number(
                "training_sessions",
                "Ridge training window · matured dates",
                1,
              )}
            {value.model === "SIGNAL_RIDGE" &&
              number("ridge_penalty", "Ridge penalty · λ", 0)}
          </div>
          <p className="cp-note">
            Forecasts are arithmetic returns over this horizon, after the
            next-close fill. Risk is scaled to the same horizon using daily
            covariance; the capital volatility budget remains annualized. The
            forecast horizon is independent of the rebalance cadence.
          </p>
          <div className="cp-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Use</th>
                  <th>Asset signal</th>
                  <th>Lookback · sessions</th>
                  <th>Skip · recent sessions</th>
                  {value.model === "MANUAL_SCORE" && <th>Manual weight</th>}
                </tr>
              </thead>
              <tbody>
                {value.signals.map((s, i) => {
                  const update = (key: string, v: unknown) =>
                    set(
                      "signals",
                      value.signals.map((q, j) =>
                        j === i ? { ...q, [key]: v } : q,
                      ),
                    );
                  return (
                    <tr key={s.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Enable ${labels[s.id]}`}
                          checked={s.enabled}
                          onChange={(e) => update("enabled", e.target.checked)}
                        />
                      </td>
                      <td>{labels[s.id]}</td>
                      <td>
                        <input
                          type="number"
                          aria-label={`${labels[s.id]} lookback`}
                          min={1}
                          value={
                            Number.isNaN(s.lookback_sessions)
                              ? ""
                              : s.lookback_sessions
                          }
                          onInput={(e) =>
                            update(
                              "lookback_sessions",
                              e.currentTarget.value === ""
                                ? NaN
                                : Number(e.currentTarget.value),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          aria-label={`${labels[s.id]} skip`}
                          min={0}
                          value={
                            Number.isNaN(s.skip_sessions) ? "" : s.skip_sessions
                          }
                          onInput={(e) =>
                            update(
                              "skip_sessions",
                              e.currentTarget.value === ""
                                ? NaN
                                : Number(e.currentTarget.value),
                            )
                          }
                        />
                      </td>
                      {value.model === "MANUAL_SCORE" && (
                        <td>
                          <input
                            type="number"
                            aria-label={`${labels[s.id]} weight`}
                            step="any"
                            value={Number.isNaN(s.weight) ? "" : s.weight}
                            onInput={(e) =>
                              update(
                                "weight",
                                e.currentTarget.value === ""
                                  ? NaN
                                  : Number(e.currentTarget.value),
                              )
                            }
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="cp-note">
            Momentum uses the adjusted-price return; relative momentum uses an
            average-tie rank across eligible assets. Trend uses signed R² of log
            price on time; reversal uses the negative lookback return. These are
            research hypotheses, not validated alpha claims.
          </p>
          {value.model === "MANUAL_SCORE" ? (
            <>
              <div className="cp-fields">
                {number(
                  "manual_base_return",
                  "Base return over forecast horizon (%)",
                  undefined,
                  true,
                )}
                {number(
                  "manual_score_return",
                  "Return per +1 score over forecast horizon (%)",
                  undefined,
                  true,
                )}
              </div>
              <p className="cp-note">
                Expected return = base + score × scale. Scores range from −1 to
                +1; signed manual weights are divided by their absolute sum.
                Momentum and reversal use cross-asset ranks (a single asset uses
                the return sign). This conversion is your assumption, not a
                fitted return estimate.
              </p>
            </>
          ) : (
            <p className="cp-note">
              One pooled Ridge model estimates a separate forecast for each
              asset. Features are standardized using training rows only. The
              penalty applies to slopes; the intercept is unpenalized. Only
              complete, matured labels inside your window are used, with counts
              recorded. No fixed sample quota, automatic window extension or
              automatic hyperparameter search. The window ends at the latest
              date with a fully observed return label; even one training date is
              allowed. Missing historical inputs are reported explicitly.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

export function ForecastEvidence({ result, spec }: { result: any; spec: any }) {
  const latest = result?.decisions?.at(-1),
    forecast = latest?.forecast;
  return (
    <Card title="Asset forecast evidence">
      {!forecast ? (
        <p className="cp-empty">
          Open a portfolio result in Backtesting to inspect its saved forecasts.
        </p>
      ) : (
        <>
          <p>
            {forecastNames[forecast.model as keyof typeof forecastNames]} ·
            cutoff {latest.information_cutoff} ·{" "}
            {forecast.horizon_sessions
              ? `${forecast.horizon_sessions} sessions`
              : "reference cadence horizon"}
          </p>
          <p className="cp-note">
            Saved result · dataset {spec?.dataset_id ?? "REFERENCE"}. Draft
            changes do not recalculate this evidence.
          </p>
          <div className="cp-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Expected horizon return</th>
                  <th>Score / intercept</th>
                </tr>
              </thead>
              <tbody>
                {forecast.predictions.map((p: any) => (
                  <tr key={p.ticker}>
                    <td>{p.ticker}</td>
                    <td>{pct(p.expected_return)}</td>
                    <td>
                      {p.score?.toFixed(3) ??
                        (p.intercept == null ? "—" : pct(p.intercept))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {forecast.training && (
            <p>
              Training: {forecast.training.training_dates} matured dates ·{" "}
              {forecast.training.training_rows} asset/date observations ·
              requested window {forecast.training.requested_sessions} sessions.
              Last training label ended {forecast.training.last_label_end}.
              Pending dates excluded: {forecast.training.excluded_pending_dates}
              ; missing-feature dates excluded:{" "}
              {forecast.training.excluded_missing_dates}.
            </p>
          )}
          {result.forecast_diagnostics && (
            <p>
              Observed forecast/return correlation:{" "}
              {result.forecast_diagnostics.correlation?.toFixed(3) ??
                "Undefined"}{" "}
              · {result.forecast_diagnostics.pairs} matured asset/decision pairs
              within this evaluation. Overlapping outcomes are not independent
              observations.
            </p>
          )}
          <details>
            <summary>Saved forecasts, contributions and diagnostics</summary>
            <pre>
              {JSON.stringify(
                { forecast, diagnostics: result.forecast_diagnostics },
                null,
                2,
              )}
            </pre>
          </details>
        </>
      )}
    </Card>
  );
}
