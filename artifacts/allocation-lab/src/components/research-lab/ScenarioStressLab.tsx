import { useState } from "react";
import {
  useGetScenarioStressMeta,
  useRunScenarioStress,
} from "@workspace/api-client-react";
import type {
  MacroShockInput,
  CustomEtfShockInput,
  ScenarioStressResult,
  EtfShockContribution,
  ScenarioStressMeta,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/shared/EmptyState";
import { AlertTriangle, Info, HelpCircle, Sliders, History, Loader2, CircleCheck, CircleX } from "lucide-react";

const MACRO_LABELS: Record<string, string> = {
  equityBeta: "Equity beta (SPX-like shock)",
  rates: "Rates",
  usd: "US dollar",
  oilCommodities: "Oil / commodities",
  volatility: "Volatility",
  creditSpreads: "Credit spreads",
};

function pct(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function InfoTip({ tip }: { tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">{tip}</TooltipContent>
    </Tooltip>
  );
}

const BASIS_LABEL: Record<string, string> = {
  "historical-beta": "Historical beta",
  "correlation-shock": "Correlation shock",
  "direct-etf-shock": "Direct ETF shock",
  "historical-replay": "Historical replay",
  excluded: "Excluded",
};

function ContributionTable({ rows, title }: { rows: EtfShockContribution[]; title: string }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-gray-700 mb-1.5">{title}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ticker</TableHead>
            <TableHead>Weight</TableHead>
            <TableHead>Assumed return</TableHead>
            <TableHead>Contribution</TableHead>
            <TableHead>Basis</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.ticker}>
              <TableCell className="font-medium">{r.ticker}<span className="text-muted-foreground font-normal"> — {r.name}</span></TableCell>
              <TableCell>{(r.weight * 100).toFixed(1)}%</TableCell>
              <TableCell className={r.assumedReturnPct < 0 ? "text-red-700" : "text-emerald-700"}>{pct(r.assumedReturnPct)}</TableCell>
              <TableCell className={r.contributionPct < 0 ? "text-red-700" : "text-emerald-700"}>{pct(r.contributionPct)}</TableCell>
              <TableCell>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-[10px] cursor-help">{BASIS_LABEL[r.basis] ?? r.basis}</Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">{r.basisDetail}</TooltipContent>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ResultPanel({ result }: { result: ScenarioStressResult }) {
  if (!result.hasSufficientData) {
    return (
      <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>{result.insufficientReason ?? "Insufficient data to run this scenario."}</span>
      </div>
    );
  }

  return (
    <div className="space-y-5 pt-1">
      <div className="grid sm:grid-cols-3 gap-3">
        <Card className="border-l-4 border-l-primary/40">
          <CardContent className="py-3.5">
            <p className="text-xs text-muted-foreground mb-1">Portfolio impact</p>
            <p className={`text-2xl font-bold tabular-nums ${(result.portfolioImpactPct ?? 0) < 0 ? "text-red-700" : "text-emerald-700"}`}>
              {pct(result.portfolioImpactPct)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3.5">
            <p className="text-xs text-muted-foreground mb-1">Cash weight</p>
            <p className="text-2xl font-bold tabular-nums text-gray-900">{(result.cashWeight * 100).toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3.5">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              Cash buffer adequacy <InfoTip tip="Whether the current cash allocation is judged sufficient to absorb the modeled drawdown without forced liquidation." />
            </p>
            <div className="flex items-center gap-1.5">
              {result.cashBufferAdequate === null ? (
                <span className="text-sm text-muted-foreground">N/A</span>
              ) : result.cashBufferAdequate ? (
                <><CircleCheck className="h-4 w-4 text-emerald-600" /><span className="text-sm font-semibold text-emerald-700">Adequate</span></>
              ) : (
                <><CircleX className="h-4 w-4 text-red-600" /><span className="text-sm font-semibold text-red-700">Thin</span></>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{result.cashBufferNote}</p>

      {result.warnings.length > 0 && (
        <div className="space-y-1.5">
          {result.warnings.map((w) => (
            <div
              key={w.id}
              className={`flex items-start gap-2 rounded border px-3 py-2 text-xs ${
                w.severity === "fail" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {w.message}
            </div>
          ))}
        </div>
      )}

      {result.bucketContributions.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-1.5">Bucket contributions</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {result.bucketContributions.map((b) => (
              <div key={b.key} className="flex items-center justify-between rounded border border-gray-100 px-3 py-2 text-xs">
                <span className="font-medium text-gray-800">{b.label}</span>
                <span className="flex items-center gap-3 tabular-nums">
                  <span className="text-muted-foreground">{(b.weight * 100).toFixed(1)}% wt</span>
                  <span className={b.contributionPct < 0 ? "text-red-700 font-semibold" : "text-emerald-700 font-semibold"}>{pct(b.contributionPct)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ContributionTable rows={result.largestRiskDrivers} title="Largest risk drivers" />
      <ContributionTable rows={result.etfContributions} title="All ETF/cash contributions" />

      {result.watchItems.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-1.5">Watch items</p>
          <ul className="space-y-1">
            {result.watchItems.map((w, i) => (
              <li key={i} className="text-xs text-gray-700 flex items-start gap-1.5">
                <span className="text-gray-400 mt-0.5">•</span>{w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.excludedTickers.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Excluded from shock modeling: {result.excludedTickers.map((e) => `${e.ticker} (${e.reason})`).join("; ")}
        </div>
      )}

      <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-gray-400" />
        <span>
          <Badge variant="outline" className="mr-2 text-[10px] align-middle">Methodology</Badge>
          {result.basisSummary}
        </span>
      </div>
    </div>
  );
}

function VersionSelect({
  versions,
  value,
  onChange,
}: {
  versions: { id: number; label: string; runAt: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-56">
        <SelectValue placeholder="Portfolio version" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="current">Current allocation</SelectItem>
        {versions.map((v) => (
          <SelectItem key={v.id} value={String(v.id)}>{v.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ScenarioAnalysisSection({ meta }: { meta: ScenarioStressMeta }) {
  const [versionId, setVersionId] = useState("current");
  const [shocks, setShocks] = useState<Record<string, string>>({});
  const [customTicker, setCustomTicker] = useState("");
  const [customPct, setCustomPct] = useState("");
  const [customShocks, setCustomShocks] = useState<CustomEtfShockInput[]>([]);
  const mutation = useRunScenarioStress();

  const addCustomShock = () => {
    const t = customTicker.trim().toUpperCase();
    const p = Number(customPct);
    if (!t || !Number.isFinite(p) || p === 0) return;
    setCustomShocks((prev) => [...prev.filter((c) => c.ticker !== t), { ticker: t, magnitudePct: p }]);
    setCustomTicker("");
    setCustomPct("");
  };

  const run = () => {
    const macroShocks: MacroShockInput[] = Object.entries(shocks)
      .filter(([, v]) => v !== "" && Number.isFinite(Number(v)) && Number(v) !== 0)
      .map(([key, v]) => ({ key: key as MacroShockInput["key"], magnitudePct: Number(v) }));
    mutation.mutate({
      data: {
        mode: "scenario",
        versionId: versionId === "current" ? null : Number(versionId),
        macroShocks,
        customEtfShocks: customShocks,
      },
    });
  };

  const hasAnyShock = Object.values(shocks).some((v) => v !== "" && Number(v) !== 0) || customShocks.length > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Sliders className="h-4 w-4 text-primary" />
          Scenario Analysis
          <InfoTip tip="Apply user-defined macro shocks (or direct ETF-level shocks) to the current or a saved portfolio version to see the modeled impact." />
        </CardTitle>
        <CardDescription>Define shocks by magnitude, choose a portfolio version, and run.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <VersionSelect versions={meta.versions} value={versionId} onChange={setVersionId} />

        <div>
          <p className="text-xs font-semibold text-gray-700 mb-2">Macro shocks (%)</p>
          <div className="grid sm:grid-cols-3 gap-3">
            {meta.proxies.map((p) => (
              <div key={p.key} className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  {MACRO_LABELS[p.key] ?? p.label}
                  <InfoTip tip={p.available ? p.description : `${p.description} (unavailable: no price data for ${p.candidateTickers.join("/")})`} />
                </Label>
                <Input
                  type="number"
                  step="0.5"
                  placeholder={p.available ? "e.g. -10" : "unavailable"}
                  disabled={!p.available}
                  value={shocks[p.key] ?? ""}
                  onChange={(e) => setShocks((s) => ({ ...s, [p.key]: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-700 mb-2">Custom ETF shocks</p>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Ticker</Label>
              <Input value={customTicker} onChange={(e) => setCustomTicker(e.target.value)} className="h-8 w-24 text-sm" placeholder="XLK" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Shock %</Label>
              <Input type="number" step="0.5" value={customPct} onChange={(e) => setCustomPct(e.target.value)} className="h-8 w-24 text-sm" placeholder="-15" />
            </div>
            <Button variant="outline" size="sm" onClick={addCustomShock}>Add</Button>
          </div>
          {customShocks.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {customShocks.map((c) => (
                <Badge key={c.ticker} variant="secondary" className="text-xs cursor-pointer" onClick={() => setCustomShocks((prev) => prev.filter((x) => x.ticker !== c.ticker))}>
                  {c.ticker} {pct(c.magnitudePct)} ✕
                </Badge>
              ))}
            </div>
          )}
        </div>

        <Button onClick={run} disabled={!hasAnyShock || mutation.isPending}>
          {mutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
          Run Scenario
        </Button>

        {mutation.data && <ResultPanel result={mutation.data} />}
      </CardContent>
    </Card>
  );
}

function StressTestingSection({ meta }: { meta: ScenarioStressMeta }) {
  const [versionId, setVersionId] = useState("current");
  const [scenarioId, setScenarioId] = useState(meta.scenarios.find((s) => s.available)?.id ?? meta.scenarios[0]?.id ?? "");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const mutation = useRunScenarioStress();

  const selected = meta.scenarios.find((s) => s.id === scenarioId);
  const isCustom = scenarioId === "custom-window";

  const run = () => {
    mutation.mutate({
      data: {
        mode: "stress",
        versionId: versionId === "current" ? null : Number(versionId),
        scenarioId,
        customStart: isCustom ? customStart : undefined,
        customEnd: isCustom ? customEnd : undefined,
      },
    });
  };

  const canRun = isCustom ? Boolean(customStart && customEnd) : Boolean(selected?.available);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          Stress Testing
          <InfoTip tip="Replay a predefined historical macro window (or a custom date range) against the current or a saved portfolio version using observed correlations from your uploaded price data." />
        </CardTitle>
        <CardDescription>Choose a historical stress window and a portfolio version, and run.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <VersionSelect versions={meta.versions} value={versionId} onChange={setVersionId} />
          <div className="space-y-1">
            <Label className="text-xs">Scenario</Label>
            <Select value={scenarioId} onValueChange={setScenarioId}>
              <SelectTrigger className="w-72">
                <SelectValue placeholder="Select a scenario" />
              </SelectTrigger>
              <SelectContent>
                {meta.scenarios.map((s) => (
                  <SelectItem key={s.id} value={s.id} disabled={s.id !== "custom-window" && !s.available}>
                    {s.label}{s.id !== "custom-window" && !s.available ? " (unavailable)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {selected && !isCustom && (
          <p className="text-xs text-muted-foreground">
            {selected.description} ({selected.startDate} – {selected.endDate})
            {!selected.available && selected.reason && <span className="text-amber-700"> — {selected.reason}</span>}
          </p>
        )}

        {isCustom && (
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Start date</Label>
              <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">End date</Label>
              <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="h-8 text-sm" />
            </div>
          </div>
        )}

        <Button onClick={run} disabled={!canRun || mutation.isPending}>
          {mutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
          Run Stress Test
        </Button>

        {mutation.data && <ResultPanel result={mutation.data} />}
      </CardContent>
    </Card>
  );
}

export function ScenarioStressLab() {
  const { data: meta, isLoading } = useGetScenarioStressMeta();

  if (isLoading) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!meta || !meta.hasAllocation) {
    return (
      <EmptyState
        icon={Sliders}
        title="No portfolio to stress test yet"
        description="Run the pipeline in Investment Committee (or save a version in Portfolio Lab) to generate an allocation before running scenario analysis or stress tests."
        actionLabel="Go to Investment Committee"
        actionHref="/"
      />
    );
  }

  return (
    <div className="space-y-6">
      <ScenarioAnalysisSection meta={meta} />
      <StressTestingSection meta={meta} />
    </div>
  );
}
