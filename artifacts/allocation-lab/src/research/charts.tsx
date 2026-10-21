import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import type { Point } from "./api";
const colors = [
  "#163c57",
  "#538a88",
  "#a17f54",
  "#7d77a1",
  "#537c99",
  "#a57a86",
  "#6e804f",
  "#786a5b",
];
export interface Curve {
  id: string;
  label: string;
  points: Point[];
}
export function ResearchChart({
  curves,
  field = "index",
  label,
  height = 270,
}: {
  curves: Curve[];
  field?: "index" | "drawdown" | "spy_exposure" | "cash_allocation";
  label: string;
  height?: number;
}) {
  const data = useMemo(() => {
    const rows = new Map<string, Record<string, string | number>>();
    for (const c of curves)
      for (const p of c.points) {
        const row = rows.get(p.date) ?? { date: p.date };
        row[c.id] = p[field];
        rows.set(p.date, row);
      }
    return [...rows.values()].sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    );
  }, [curves, field]);
  if (!data.length)
    return (
      <p className="pr-empty">
        This series is not available from the completed result.
      </p>
    );
  return (
    <div className="pr-chart" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 10, bottom: 0, left: 0 }}
        >
          <CartesianGrid vertical={false} stroke="#e6ebee" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#697784" }}
            minTickGap={65}
            tickFormatter={(x) => String(x).slice(0, 7)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            width={48}
            tick={{ fontSize: 11, fill: "#697784" }}
            tickFormatter={(x) =>
              field === "index"
                ? Number(x).toFixed(0)
                : new Intl.NumberFormat("en", {
                    style: "percent",
                    maximumFractionDigits: 0,
                  }).format(x)
            }
            axisLine={false}
            tickLine={false}
            domain={
              field === "index"
                ? ["auto", "auto"]
                : field === "spy_exposure" || field === "cash_allocation"
                  ? [0, 1]
                  : undefined
            }
          />
          <Tooltip
            contentStyle={{ fontSize: 12, border: "1px solid #d9e1e6" }}
            formatter={(value: number, name: string) => [
              field === "index"
                ? String(value)
                : new Intl.NumberFormat("en", {
                    style: "percent",
                    maximumFractionDigits: 6,
                  }).format(value),
              name,
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          {curves.map((c, i) => (
            <Line
              key={c.id}
              dataKey={c.id}
              name={c.label}
              stroke={colors[i % colors.length]}
              strokeWidth={1.65}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
