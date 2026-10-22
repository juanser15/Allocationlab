import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
export const models = {
  CURRENT: "Current regime score",
  TREND: "Trend · 200-day average",
  TREND_VOL: "Trend + volatility",
  HMM: "HMM · two volatility states",
};
export const names: Record<string, string> = {
  SPY: "US equities",
  EFA: "Developed markets",
  EEM: "Emerging markets",
  IEF: "7–10 year Treasuries",
  TLT: "20+ year Treasuries",
  GLD: "Gold",
  DBC: "Commodities",
  VNQ: "US real estate",
};
export const pct = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : "—";
export function Card({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="cp-card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
export function MetricCards({ metrics }: { metrics: any }) {
  return (
    <div className="cp-metrics">
      {[
        ["Net CAGR", pct(metrics.cagr)],
        ["Realized volatility", pct(metrics.volatility)],
        ["Maximum drawdown", pct(metrics.max_drawdown)],
        ["Net Sharpe", metrics.net_sharpe?.toFixed(2) ?? "—"],
      ].map(([label, value]) => (
        <div key={label}>
          <small>{label}</small>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}
export function ResearchChart({
  points,
  field = "index",
  benchmark,
}: {
  points: any[];
  field?: "index" | "drawdown" | "exposure";
  benchmark?: any[];
}) {
  const passive = new Map(benchmark?.map((p) => [p.date, p.index]));
  const data = points.map((p) => ({ ...p, passive: passive.get(p.date) }));
  return (
    <div
      className="cp-chart"
      role="img"
      aria-label={
        benchmark
          ? "SPY/cash policy versus passive SPY"
          : field === "index"
            ? "Portfolio value, starting at 100"
            : field === "drawdown"
              ? "Drawdown"
              : "Actual ETF exposure"
      }
    >
      <ResponsiveContainer width="100%" height={250}>
        {field === "index" ? (
          <LineChart data={data}>
            <CartesianGrid vertical={false} stroke="#e5eaee" />
            <XAxis dataKey="date" minTickGap={65} />
            <YAxis domain={["auto", "auto"]} />
            <Tooltip formatter={(v: any) => Number(v).toFixed(2)} />
            <Legend />
            <Line
              dataKey="index"
              name={benchmark ? "SPY/cash policy" : "Portfolio"}
              dot={false}
              isAnimationActive={false}
              stroke="#265e72"
              strokeWidth={2}
            />
            {benchmark && (
              <Line
                dataKey="passive"
                name="Passive SPY"
                dot={false}
                isAnimationActive={false}
                stroke="#ad8554"
                strokeWidth={2}
              />
            )}
          </LineChart>
        ) : (
          <AreaChart data={data}>
            <CartesianGrid vertical={false} stroke="#e5eaee" />
            <XAxis dataKey="date" minTickGap={65} />
            <YAxis tickFormatter={pct} />
            <Tooltip formatter={(v: any) => pct(Number(v))} />
            <Area
              dataKey={field}
              stroke="#265e72"
              fill="#dcebf0"
              isAnimationActive={false}
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
export async function researchApi(path: string, body?: unknown) {
  const token = sessionStorage.getItem("allocationlab.workbench.preview-token");
  const response = await fetch("/api/workbench/coordinated" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      value.error?.message ??
        value.message ??
        "The research request could not be completed.",
    );
  return value;
}
