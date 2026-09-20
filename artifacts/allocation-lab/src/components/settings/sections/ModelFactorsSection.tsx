import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetFactorLibraryQueryKey,
  useGetFactorLibrary,
  useUpdateFactorLibrary,
  type FactorDefinition,
  type FactorDefinitionInput,
} from "@workspace/api-client-react";
import { AlertCircle, Check, Loader2, Sigma } from "lucide-react";
import { useSettingsDrawer } from "@/context/settings-drawer-context";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

function toInput(factor: FactorDefinition): FactorDefinitionInput {
  const { currentCoverage: _coverage, availabilityReason: _reason, version: _version, ...input } = factor;
  return input;
}

function sameFactors(left: FactorDefinitionInput[], right: FactorDefinitionInput[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function ModelFactorsSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { reportSectionStatus, restoreDefaultsSignal } = useSettingsDrawer();
  const { data: library, isLoading, isError } = useGetFactorLibrary();
  const updateLibrary = useUpdateFactorLibrary();
  const [draft, setDraft] = useState<FactorDefinitionInput[]>([]);
  const initializedVersion = useRef<string | null>(null);

  useEffect(() => {
    if (library && library.version !== initializedVersion.current) {
      setDraft(library.factors.map(toInput));
      initializedVersion.current = library.version;
    }
  }, [library]);

  const saved = useMemo(() => library?.factors.map(toInput) ?? [], [library]);
  const dirty = !sameFactors(draft, saved);
  const activeCount = draft.filter((factor) => factor.enabled && factor.status === "active").length;
  const errorCount = activeCount === 0 ? 1 : 0;

  useEffect(() => {
    reportSectionStatus("model-factors", { dirty, errorCount });
  }, [dirty, errorCount, reportSectionStatus]);

  useEffect(() => {
    if (!restoreDefaultsSignal || !library) return;
    setDraft(library.factors.map(toInput));
  }, [restoreDefaultsSignal, library]);

  const setSelected = (id: string, selected: boolean) => {
    setDraft((current) =>
      current.map((factor) =>
        factor.id === id
          ? {
              ...factor,
              enabled: selected,
              status: selected ? "active" : "disabled",
            }
          : factor,
      ),
    );
  };

  const save = () => {
    if (activeCount === 0) return;
    updateLibrary.mutate(
      { data: { factors: draft } },
      {
        onSuccess: (updated) => {
          setDraft(updated.factors.map(toInput));
          initializedVersion.current = updated.version;
          queryClient.invalidateQueries({ queryKey: getGetFactorLibraryQueryKey() });
          toast({
            title: "Active Factor Set saved",
            description: `${activeCount} factor${activeCount === 1 ? "" : "s"} selected for future optimizer runs.`,
          });
        },
        onError: (error) => {
          toast({
            title: "Could not save factor selection",
            description: error instanceof Error ? error.message : "The factor library could not be updated.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Sigma className="h-4 w-4 text-primary" />
          <h3 className="text-base font-bold text-gray-900">Model & Factors</h3>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Select the factors included in the Active Factor Set. Only selected factors contribute to future optimizer runs;
          remaining weights are normalized by the active market regime.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 rounded-md border px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading factor library…
        </div>
      )}

      {isError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          The factor library could not be loaded. No selection was changed.
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Active Factor Set</p>
              <p className="text-xs text-muted-foreground">
                Version {library?.version ?? "—"} · {activeCount} of {draft.length} selected
              </p>
            </div>
            <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
              {activeCount} active
            </Badge>
          </div>

          <div className="divide-y rounded-md border">
            {draft.map((factor) => {
              const selected = factor.enabled && factor.status === "active";
              const persisted = library?.factors.find((item) => item.id === factor.id);
              return (
                <div key={factor.id} className="flex items-start gap-3 px-4 py-3">
                  <Switch
                    checked={selected}
                    onCheckedChange={(checked) => setSelected(factor.id, checked)}
                    aria-label={`${selected ? "Remove" : "Add"} ${factor.name} ${selected ? "from" : "to"} Active Factor Set`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{factor.name}</span>
                      <Badge variant="outline" className="text-[10px]">{factor.family}</Badge>
                      {selected && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-700">
                          <Check className="h-3 w-3" /> Selected
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{factor.description}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span>Lookback: {factor.lookback}d</span>
                      <span>Base weight: {(factor.baseWeight * 100).toFixed(1)}%</span>
                      <span>Coverage: {persisted ? `${Math.round(persisted.currentCoverage * 100)}%` : "—"}</span>
                    </div>
                    {persisted?.availabilityReason && (
                      <p className="mt-1 text-xs font-medium text-amber-700">{persisted.availabilityReason}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {activeCount === 0 && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              Select at least one factor before saving.
            </div>
          )}

          <div className="flex items-center justify-between border-t pt-4">
            <p className="max-w-md text-xs text-muted-foreground">
              Advanced formulas, lookbacks, normalization, regime weights and version history remain available in
              Portfolio Lab → Factors & Regimes.
            </p>
            <Button onClick={save} disabled={!dirty || activeCount === 0 || updateLibrary.isPending}>
              {updateLibrary.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Factor Selection
            </Button>
          </div>
        </>
      )}
    </div>
  );
}