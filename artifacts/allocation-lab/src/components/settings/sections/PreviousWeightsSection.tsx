import { useState, useRef, useEffect, useMemo } from "react";
import { useGetUniverse, useUpdateUniverse } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Download, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SectionShell } from "../SectionShell";
import { useSettingsDrawer } from "@/context/settings-drawer-context";

interface WeightRow {
  ticker: string;
  priorWeight: number;
}

export function PreviousWeightsSection() {
  const { toast } = useToast();
  const { reportSectionStatus, restoreDefaultsSignal } = useSettingsDrawer();
  const { data: universe, isLoading, refetch } = useGetUniverse();
  const updateUniverse = useUpdateUniverse();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [weights, setWeights] = useState<WeightRow[]>([]);
  const [cashWeight, setCashWeight] = useState(0);
  const [savedWeights, setSavedWeights] = useState<WeightRow[]>([]);
  const [savedCash, setSavedCash] = useState(0);
  const initialized = useRef(false);
  const lastRestoreSignal = useRef(restoreDefaultsSignal);

  useEffect(() => {
    if (universe && !initialized.current) {
      const w = universe.etfs.map((e: any) => ({ ticker: e.ticker, priorWeight: e.priorWeight }));
      setWeights(w);
      setSavedWeights(w.map((x: WeightRow) => ({ ...x })));
      setCashWeight(universe.cashPriorWeight);
      setSavedCash(universe.cashPriorWeight);
      initialized.current = true;
    }
  }, [universe]);

  useEffect(() => {
    if (restoreDefaultsSignal !== lastRestoreSignal.current) {
      lastRestoreSignal.current = restoreDefaultsSignal;
      initialized.current = false;
      refetch();
    }
  }, [restoreDefaultsSignal, refetch]);

  const dirty = useMemo(
    () => JSON.stringify(weights) !== JSON.stringify(savedWeights) || cashWeight !== savedCash,
    [weights, savedWeights, cashWeight, savedCash]
  );

  const total = useMemo(() => weights.reduce((s, w) => s + w.priorWeight, 0) + cashWeight, [weights, cashWeight]);

  const errors = useMemo(() => {
    const errs: string[] = [];
    if (Math.abs(total - 1) > 0.005) {
      errs.push(`Previous weights + cash must sum to 100%. Current total: ${(total * 100).toFixed(1)}%.`);
    }
    if (weights.some((w) => w.priorWeight < 0) || cashWeight < 0) errs.push("Weights cannot be negative.");
    return errs;
  }, [total, weights, cashWeight]);

  useEffect(() => {
    reportSectionStatus("previous-weights", { dirty, errorCount: errors.length });
  }, [dirty, errors, reportSectionStatus]);

  const handleChange = (idx: number, value: number) => {
    setWeights((prev) => prev.map((w, i) => (i === idx ? { ...w, priorWeight: value } : w)));
  };

  const handleSave = () => {
    if (!universe || errors.length > 0) return;
    const mergedEtfs = universe.etfs.map((e: any) => {
      const w = weights.find((x) => x.ticker === e.ticker);
      return { ...e, priorWeight: w ? w.priorWeight : e.priorWeight };
    });
    updateUniverse.mutate(
      { data: { etfs: mergedEtfs, cashPriorWeight: cashWeight } },
      {
        onSuccess: () => {
          setSavedWeights(weights.map((w) => ({ ...w })));
          setSavedCash(cashWeight);
          toast({ title: "Starting portfolio baseline saved" });
        },
        onError: () => toast({ title: "Error saving starting portfolio baseline", variant: "destructive" }),
      }
    );
  };

  const handleCancel = () => {
    setWeights(savedWeights.map((w) => ({ ...w })));
    setCashWeight(savedCash);
  };
  const handleResetSection = () => { initialized.current = false; refetch(); };

  const handleExport = () => {
    const payload = { etfs: weights, cashPriorWeight: cashWeight };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
      a.download = "starting-portfolio.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (Array.isArray(parsed.etfs)) {
          setWeights((prev) =>
            prev.map((w) => {
              const match = parsed.etfs.find((p: any) => p.ticker === w.ticker);
              return match ? { ...w, priorWeight: match.priorWeight } : w;
            })
          );
        }
        if (typeof parsed.cashPriorWeight === "number") setCashWeight(parsed.cashPriorWeight);
        toast({ title: "Starting portfolio baseline imported", description: "Review and save to apply." });
      } catch {
        toast({ title: "Import failed", description: "File is not a valid starting-portfolio baseline export.", variant: "destructive" });
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };

  if (isLoading || weights.length === 0) {
    return <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <SectionShell
      title="Starting Portfolio"
      description="The configured prior-month target-weight baseline used for weight changes in the results dashboard and reports. This is not an actual quantities/cash/NAV holdings book."
      dirty={dirty}
      errors={errors}
      onSave={handleSave}
      onCancel={handleCancel}
      onResetSection={handleResetSection}
      saving={updateUniverse.isPending}
      saveLabel="Save Starting Portfolio"
    >
      <div className="border rounded-md overflow-hidden overflow-x-auto">
        <Table>
          <TableHeader className="bg-gray-50">
            <TableRow>
              <TableHead>Ticker</TableHead>
              <TableHead className="w-32 text-right">Starting Weight (%)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {weights.map((w, idx) => (
              <TableRow key={w.ticker}>
                <TableCell className="font-medium">{w.ticker}</TableCell>
                <TableCell className="text-right">
                  <Input
                    type="number"
                    step="0.1"
                    className="w-24 ml-auto text-right"
                    value={(w.priorWeight * 100).toFixed(1)}
                    onChange={(e) => handleChange(idx, parseFloat(e.target.value) / 100)}
                  />
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-gray-50 font-medium">
              <TableCell className="text-right">CASH</TableCell>
              <TableCell className="text-right">
                <Input
                  type="number"
                  step="0.1"
                  className="w-24 ml-auto text-right"
                  value={(cashWeight * 100).toFixed(1)}
                  onChange={(e) => setCashWeight(parseFloat(e.target.value) / 100)}
                />
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-right text-sm text-muted-foreground">Total</TableCell>
              <TableCell className={`text-right text-sm font-medium ${Math.abs(total - 1) > 0.005 ? "text-destructive" : "text-green-700"}`}>
                {(total * 100).toFixed(1)}%
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="mr-1.5 h-3.5 w-3.5" />Export
        </Button>
        <Input type="file" accept=".json" ref={fileInputRef} onChange={handleImport} className="hidden" id="weights-import" />
        <Button variant="outline" size="sm" asChild>
          <Label htmlFor="weights-import" className="cursor-pointer flex items-center">
            <Upload className="mr-1.5 h-3.5 w-3.5" />Import
          </Label>
        </Button>
      </div>
    </SectionShell>
  );
}

function Label({ htmlFor, className, children }: { htmlFor: string; className?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className={className}>{children}</label>;
}
