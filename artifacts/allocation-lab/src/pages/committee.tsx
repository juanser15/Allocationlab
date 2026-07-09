import { useGetCommittee } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, AlertTriangle, Info, Download, ShieldAlert, ArrowRight,
  TrendingUp, TrendingDown, Scale, Layers, Gavel,
} from "lucide-react";
import { Link } from "wouter";

const STANCE_CLASS: Record<string, string> = {
  support: "bg-green-100 text-green-800 border-green-300",
  modify: "bg-amber-100 text-amber-800 border-amber-300",
  reject: "bg-red-100 text-red-800 border-red-300",
};

const STANCE_LABEL: Record<string, string> = {
  support: "Supports",
  modify: "Modifies",
  reject: "Rejects",
};

const PERSONA_ICON: Record<string, typeof TrendingUp> = {
  macro_strategist: Layers,
  momentum_analyst: TrendingUp,
  risk_manager: Scale,
  portfolio_construction_analyst: TrendingDown,
};

function StanceBadge({ stance }: { stance: string }) {
  return (
    <Badge variant="outline" className={STANCE_CLASS[stance] ?? ""}>
      {STANCE_LABEL[stance] ?? stance}
    </Badge>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 60 ? "bg-green-600" : value >= 35 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-semibold text-gray-600 tabular-nums">{value}%</span>
    </div>
  );
}

export default function Committee() {
  const { data: committee, isLoading, error } = useGetCommittee();

  const downloadMemo = () => {
    if (!committee) return;
    const blob = new Blob([committee.memo], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `committee-memo-session-${committee.sessionId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">AI Investment Committee</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            A deterministic, rule-based synthesis of the current session's regime, factor, diagnostics, watchlist, and
            backtest integrity data — every statement traces back to a computed number, nothing is generated or fabricated.
          </p>
        </div>
        {committee && (
          <Button variant="outline" size="sm" onClick={downloadMemo} className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> Export Committee Memo
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-3 text-muted-foreground text-sm py-12 justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          Convening committee...
        </div>
      )}

      {error && !isLoading && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-10 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-3" />
            <p className="text-sm font-medium text-amber-800 mb-1">No committee data available yet.</p>
            <p className="text-xs text-amber-700 max-w-md mx-auto">
              Run the allocation pipeline first to generate the regime, diagnostics, and allocation data the committee needs.
            </p>
            <div className="flex items-center justify-center gap-1 mt-4 text-xs">
              <Link href="/" className="text-primary underline inline-flex items-center gap-1">
                Run the pipeline <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && committee && (
        <>
          {/* CIO Synthesis */}
          <Card className="border-l-4 border-l-primary">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Gavel className="h-4 w-4 text-primary" />
                  CIO Final Recommendation
                </CardTitle>
                <div className="flex items-center gap-3">
                  <StanceBadge stance={committee.cio.stance} />
                  <ConfidenceBar value={committee.cio.confidence} />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-800 leading-relaxed">{committee.cio.summary}</p>
              {committee.cio.dissent.length > 0 && (
                <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 mb-2 flex items-center gap-1.5">
                    <ShieldAlert className="h-3.5 w-3.5" /> Dissenting Views
                  </p>
                  <ul className="space-y-1.5 text-xs text-amber-800">
                    {committee.cio.dissent.map((d, i) => (
                      <li key={i}>&bull; {d}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Guardrail notes */}
          {committee.dataQualityNotes.length > 0 && (
            <div className="space-y-2">
              {committee.dataQualityNotes.map((n, i) => (
                <div key={i} className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs text-gray-700">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-gray-400" />
                  {n}
                </div>
              ))}
            </div>
          )}

          {/* Persona Debate */}
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Committee Debate</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {committee.recommendations.map((r) => {
                const Icon = PERSONA_ICON[r.personaId] ?? Layers;
                return (
                  <Card key={r.personaId}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Icon className="h-4 w-4 text-primary/70" />
                          {r.personaLabel}
                        </CardTitle>
                        <StanceBadge stance={r.stance} />
                      </div>
                      <CardDescription className="pt-1">
                        <ConfidenceBar value={r.confidence} />
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm text-gray-800 leading-relaxed">{r.summary}</p>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Evidence</p>
                        <ul className="space-y-1 text-xs text-gray-600">
                          {r.evidence.map((e, i) => (
                            <li key={i} className="flex gap-1.5">
                              <span className="text-gray-300">&bull;</span>
                              <span>{e}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="rounded bg-gray-50 border border-gray-100 px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Key Concern</p>
                        <p className="text-xs text-gray-700 leading-snug">{r.keyConcern}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Methodology footnote */}
          <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-gray-400" />
            <span>
              <Badge variant="outline" className="mr-2 text-[10px] align-middle">Methodology</Badge>
              Each persona's stance, confidence, and evidence are derived deterministically from the latest session's
              regime scores, factor scores, portfolio diagnostics, watchlist, and backtest integrity audit (when
              available). Confidence is automatically downgraded — with a stated reason — whenever underlying data is
              incomplete or the backtest integrity check has not passed.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
