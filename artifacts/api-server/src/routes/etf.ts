import { Router, type IRouter } from "express";
import { db, sessionsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { GetEtfDetailResponse } from "@workspace/api-zod";
import { parseCsv } from "../lib/calculator";
import { getLatestPriceData } from "./prices";
import { getUniverseConfig } from "./universe";
import { getConstraintsConfig } from "./constraints";

const router: IRouter = Router();

type FactorKey = "mom20" | "mom60" | "mom120" | "mom252" | "trendQuality" | "realizedVol60" | "drawdown" | "meanReversion";
const FACTOR_LABELS: Record<FactorKey, string> = {
  mom20: "Momentum 20d",
  mom60: "Momentum 60d",
  mom120: "Momentum 120d",
  mom252: "Momentum 252d",
  trendQuality: "Trend Quality",
  realizedVol60: "Low Volatility (60d)",
  drawdown: "Drawdown",
  meanReversion: "Mean Reversion",
};

function findWeakestFactor(scores: Record<string, number>): string {
  let minKey: FactorKey = "mom20";
  let minVal = Infinity;
  for (const key of Object.keys(FACTOR_LABELS) as FactorKey[]) {
    if ((scores[key] ?? 100) < minVal) {
      minVal = scores[key] ?? 100;
      minKey = key;
    }
  }
  return FACTOR_LABELS[minKey];
}

function findStrongestFactors(scores: Record<string, number>): string[] {
  const ranked = (Object.keys(FACTOR_LABELS) as FactorKey[])
    .filter((_k) => true)
    .map((k) => ({ key: k, label: FACTOR_LABELS[k], val: scores[k] ?? 50 }))
    .sort((a, b) => b.val - a.val);
  return ranked.slice(0, 2).map((r) => `${r.label} (${r.val.toFixed(0)})`);
}

function buildExplanation(
  ticker: string,
  etfName: string,
  alloc: Record<string, unknown> | null,
  rank: number | null,
  totalScored: number,
  latestResult: Record<string, unknown> | null,
  constraints: { minInclusionThreshold: number; targetActiveEtfs: number } | null,
  inclusionStatus: string
): string {
  if (inclusionStatus === "no_results" || !latestResult) {
    return "No allocation run has been executed yet. Run the pipeline from the Investment Committee to see ETF-specific analysis.";
  }
  if (inclusionStatus === "no_data" || !alloc) {
    return `${ticker} had insufficient price history to compute factor scores. Ensure ${ticker} appears in your uploaded price CSV with at least 21 trading days of data.`;
  }

  const scores = alloc.factorScores as Record<string, number> | null;
  const composite = scores?.composite ?? 0;
  const weight = (alloc.weight as number) * 100;
  const priorWeight = (alloc.priorWeight as number) * 100;
  const change = (alloc.change as number) * 100;
  const regime = latestResult.regime as Record<string, unknown>;
  const regimeLabel = regime?.label as string ?? "Unknown";
  const regimeComposite = regime?.composite as number ?? 50;
  const cashPct = (latestResult.cashWeight as number) * 100;
  const threshold = constraints?.minInclusionThreshold ?? 40;
  const targetN = constraints?.targetActiveEtfs ?? 8;

  if (inclusionStatus === "active" && scores) {
    const strongest = findStrongestFactors(scores);
    const changeDesc =
      Math.abs(change) < 0.05
        ? "unchanged"
        : change > 0
        ? `up ${change.toFixed(1)}pp from ${priorWeight.toFixed(1)}%`
        : `down ${Math.abs(change).toFixed(1)}pp from ${priorWeight.toFixed(1)}%`;
    return (
      `${ticker} is included at ${weight.toFixed(1)}% (${changeDesc}). ` +
      `It ranked ${rank}${ordinal(rank!)} of ${totalScored} scored ETFs with a composite score of ${composite.toFixed(1)}. ` +
      `Leading factors: ${strongest.join(" and ")}. ` +
      `Cash was set at ${cashPct.toFixed(1)}% reflecting a ${regimeLabel} regime (composite ${regimeComposite.toFixed(1)}).`
    );
  }

  if (inclusionStatus === "excluded_threshold" && scores) {
    const weakest = findWeakestFactor(scores);
    const gap = threshold - composite;
    return (
      `${ticker} scored ${composite.toFixed(1)}, falling ${gap.toFixed(1)} points below the inclusion threshold of ${threshold}. ` +
      `It ranked ${rank}${ordinal(rank!)} of ${totalScored} scored ETFs. ` +
      `The weakest contributing factor was ${weakest} (${(scores[Object.keys(FACTOR_LABELS).find(k => FACTOR_LABELS[k as FactorKey] === weakest) ?? "mom20"] ?? 0).toFixed(0)}). ` +
      `No weight was allocated. The composite score would need to rise by at least ${gap.toFixed(1)} points to cross the threshold.`
    );
  }

  if (inclusionStatus === "excluded_rank" && scores) {
    return (
      `${ticker} scored ${composite.toFixed(1)} — above the ${threshold}-point threshold — but ranked ${rank}${ordinal(rank!)} of ${totalScored} eligible ETFs. ` +
      `The model targets ${targetN} active positions, so ${ticker} was not included despite meeting the score minimum. ` +
      `It appears on the near-miss watchlist. To enter the portfolio, it would need to improve its rank by displacing a currently held position.`
    );
  }

  return `${ticker} (${etfName}) status: ${inclusionStatus}.`;
}

function ordinal(n: number): string {
  if (n === 1) return "st";
  if (n === 2) return "nd";
  if (n === 3) return "rd";
  return "th";
}

router.get("/etf/:ticker", async (req, res): Promise<void> => {
  const { ticker } = req.params;

  if (!ticker) {
    res.status(400).json({ error: "Ticker is required." });
    return;
  }

  const universe = await getUniverseConfig();
  const etfMeta = (universe.etfs as Array<{ ticker: string; name: string; sector: string; priorWeight: number; enabled: boolean }>).find(
    (e) => e.ticker === ticker.toUpperCase()
  );

  if (!etfMeta) {
    res.status(404).json({ error: `ETF ${ticker} is not in the configured universe.` });
    return;
  }

  const constraints = await getConstraintsConfig();

  // --- Latest session data ---
  const allSessions = await db
    .select()
    .from(sessionsTable)
    .orderBy(desc(sessionsTable.runAt))
    .limit(10);

  const latest = allSessions[0] ?? null;
  const latestResult = latest ? (latest.resultJson as Record<string, unknown>) : null;

  let weight = 0;
  let priorWeight = etfMeta.priorWeight;
  let change = 0;
  let active = false;
  let factorScores: Record<string, number> | null = null;
  let rank: number | null = null;
  let totalScored = 0;
  let inclusionStatus: "active" | "excluded_threshold" | "excluded_rank" | "no_data" | "no_results" = "no_results";
  let alloc: Record<string, unknown> | null = null;

  if (latestResult) {
    const allocs = (latestResult.allocations as Array<Record<string, unknown>>) ?? [];
    alloc = allocs.find((a) => a.ticker === ticker.toUpperCase()) ?? null;

    if (alloc) {
      weight = alloc.weight as number;
      priorWeight = alloc.priorWeight as number;
      change = alloc.change as number;
      active = alloc.active as boolean;
      factorScores = (alloc.factorScores as Record<string, number>) ?? null;

      const scoredAllocs = allocs
        .filter((a) => (a.factorScores as Record<string, number> | undefined)?.composite !== undefined)
        .sort((a, b) => {
          const sa = (a.factorScores as Record<string, number>).composite;
          const sb = (b.factorScores as Record<string, number>).composite;
          return sb - sa;
        });
      totalScored = scoredAllocs.length;
      const rankIdx = scoredAllocs.findIndex((a) => a.ticker === ticker.toUpperCase());
      rank = rankIdx >= 0 ? rankIdx + 1 : null;

      const watchlist = (latestResult.watchlist as Array<{ ticker: string }>) ?? [];
      const isOnWatchlist = watchlist.some((w) => w.ticker === ticker.toUpperCase());

      if (active) {
        inclusionStatus = "active";
      } else if (factorScores && factorScores.composite < constraints.minInclusionThreshold) {
        inclusionStatus = "excluded_threshold";
      } else if (isOnWatchlist) {
        inclusionStatus = "excluded_rank";
      } else {
        inclusionStatus = "no_data";
      }
    } else {
      inclusionStatus = "no_data";
    }
  }

  const explanation = buildExplanation(ticker.toUpperCase(), etfMeta.name, alloc, rank, totalScored, latestResult, constraints, inclusionStatus);

  // --- Score history across sessions ---
  const scoreHistory: Array<{
    sessionId: number;
    runAt: string;
    composite: number;
    rank: number;
    active: boolean;
    weight: number;
  }> = [];

  for (const session of allSessions) {
    const result = session.resultJson as Record<string, unknown>;
    const allocs = (result.allocations as Array<Record<string, unknown>>) ?? [];
    const etfAlloc = allocs.find((a) => a.ticker === ticker.toUpperCase());
    if (!etfAlloc) continue;
    const fs = etfAlloc.factorScores as Record<string, number> | undefined;
    if (!fs?.composite) continue;

    const sorted = allocs
      .filter((a) => (a.factorScores as Record<string, number> | undefined)?.composite !== undefined)
      .sort((a, b) => (b.factorScores as Record<string, number>).composite - (a.factorScores as Record<string, number>).composite);
    const rIdx = sorted.findIndex((a) => a.ticker === ticker.toUpperCase());

    scoreHistory.push({
      sessionId: session.id,
      runAt: session.runAt instanceof Date ? session.runAt.toISOString() : String(session.runAt),
      composite: Math.round(fs.composite * 100) / 100,
      rank: rIdx >= 0 ? rIdx + 1 : 99,
      active: (etfAlloc.active as boolean) ?? false,
      weight: Math.round(((etfAlloc.weight as number) ?? 0) * 10000) / 10000,
    });
  }

  // --- Price history (last 90 points) ---
  const priceData = await getLatestPriceData();
  const priceHistory: Array<{ date: string; price: number; returnPct: number | null }> = [];
  let priceDataStart: string | null = null;
  let priceDataEnd: string | null = null;
  let lookbackRows = 0;

  if (priceData) {
    try {
      const rows = parseCsv(priceData.csvContent);
      const tickerRows = rows.filter((r) => r.prices[ticker.toUpperCase()] !== undefined).slice(-90);
      lookbackRows = tickerRows.length;

      for (let i = 0; i < tickerRows.length; i++) {
        const price = tickerRows[i].prices[ticker.toUpperCase()];
        const prev = i > 0 ? tickerRows[i - 1].prices[ticker.toUpperCase()] : null;
        priceHistory.push({
          date: tickerRows[i].date,
          price: Math.round(price * 100) / 100,
          returnPct: prev && prev > 0 ? Math.round(((price - prev) / prev) * 100000) / 100000 : null,
        });
      }

      if (tickerRows.length > 0) {
        priceDataStart = tickerRows[0].date;
        priceDataEnd = tickerRows[tickerRows.length - 1].date;
      }
    } catch {
      // ignore parse errors
    }
  }

  res.json(
    GetEtfDetailResponse.parse({
      ticker: ticker.toUpperCase(),
      name: etfMeta.name,
      sector: etfMeta.sector,
      weight,
      priorWeight,
      change,
      active,
      inclusionStatus,
      rank,
      totalScored,
      factorScores,
      explanation,
      priceHistory,
      scoreHistory,
      lookbackRows,
      priceDataEnd,
      priceDataStart,
    })
  );
});

export default router;
