import { useMemo } from "react";
import type { RunResult } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { AlertCircle, Activity } from "lucide-react";

interface Props {
  result: RunResult;
  factorIds: string[];
}

function computeCorrelation(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 5) return null; // Too few observations

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denominator === 0) return null;
  return (n * sumXY - sumX * sumY) / denominator;
}

export function FactorCorrelationMatrix({ result, factorIds }: Props) {
  const matrix = useMemo(() => {
    // Collect vectors for each factor
    const vectors: Record<string, (number | null)[]> = {};
    for (const factorId of factorIds) {
      vectors[factorId] = [];
    }

    for (const alloc of result.allocations) {
      const contribMap = new Map(alloc.factorContributions.map(c => [c.factorId, c.normalizedValue]));
      for (const factorId of factorIds) {
        const val = contribMap.get(factorId);
        vectors[factorId].push(val !== undefined ? val : null);
      }
    }

    const n = factorIds.length;
    const mat: (number | null)[][] = Array.from({ length: n }, () => Array(n).fill(null));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          mat[i][j] = 1;
        } else if (j < i) {
          mat[i][j] = mat[j][i];
        } else {
          // Compute correlation
          const x: number[] = [];
          const y: number[] = [];
          for (let k = 0; k < result.allocations.length; k++) {
            const valX = vectors[factorIds[i]][k];
            const valY = vectors[factorIds[j]][k];
            if (valX !== null && valY !== null) {
              x.push(valX);
              y.push(valY);
            }
          }
          mat[i][j] = computeCorrelation(x, y);
        }
      }
    }

    return mat;
  }, [result, factorIds]);

  if (factorIds.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center">
          <Activity className="h-8 w-8 mb-2 opacity-20" />
          <p className="text-sm">No active factors to correlate.</p>
        </CardContent>
      </Card>
    );
  }

  const getCellColor = (val: number | null) => {
    if (val === null) return "bg-gray-50 text-gray-400";
    if (val > 0.7) return "bg-red-100 text-red-900 font-semibold";
    if (val > 0.4) return "bg-red-50 text-red-800";
    if (val < -0.7) return "bg-green-100 text-green-900 font-semibold";
    if (val < -0.4) return "bg-green-50 text-green-800";
    return "bg-white text-gray-700";
  };

  return (
    <Card>
      <CardHeader className="pb-3 border-b">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-primary">
          <Activity className="h-4 w-4" /> Evidence-Based Correlation
        </CardTitle>
        <CardDescription>
          Cross-sectional redundancy check. Computed client-side from persisted run evidence ({result.allocations.length} universe observations).
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4 overflow-x-auto p-0">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="p-2 border-b border-r bg-gray-50/50"></th>
              {factorIds.map((id, i) => {
                const fName = result.allocations[0]?.factorContributions.find(c => c.factorId === id)?.factorName || id;
                return (
                  <th key={id} className="p-2 border-b text-left text-[10px] font-semibold text-gray-600 bg-gray-50/50 truncate max-w-[80px]" title={fName}>
                    {fName}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {factorIds.map((idX, i) => {
              const fNameX = result.allocations[0]?.factorContributions.find(c => c.factorId === idX)?.factorName || idX;
              return (
                <tr key={idX} className="border-b last:border-0 hover:bg-gray-50/30">
                  <td className="p-2 border-r text-[10px] font-semibold text-gray-600 bg-gray-50/50 truncate max-w-[120px]" title={fNameX}>
                    {fNameX}
                  </td>
                  {factorIds.map((idY, j) => {
                    const val = matrix[i][j];
                    return (
                      <td key={idY} className={`p-2 text-center tabular-nums text-[11px] border-l ${getCellColor(val)}`}>
                        {val === null ? "—" : val.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="p-3 text-[10px] text-muted-foreground flex items-start gap-2 bg-gray-50/50 border-t">
          <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
          <span>Values &gt; 0.7 indicate high redundancy. Values &lt; -0.7 indicate strong diversification. Requires ≥5 valid paired observations.</span>
        </div>
      </CardContent>
    </Card>
  );
}
