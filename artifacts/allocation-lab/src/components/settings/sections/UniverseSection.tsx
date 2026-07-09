import { useState, useRef, useEffect, useMemo } from "react";
import { useGetUniverse, useUpdateUniverse } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { ExternalLink } from "lucide-react";
import { SectionShell } from "../SectionShell";
import { useSettingsDrawer } from "@/context/settings-drawer-context";

function EtfLink({ ticker }: { ticker: string }) {
  return (
    <Link href={`/etf/${ticker}`} className="inline-flex items-center gap-0.5 hover:text-accent hover:underline transition-colors group">
      {ticker}
      <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
    </Link>
  );
}

interface EtfRow {
  ticker: string;
  name: string;
  sector: string;
  priorWeight: number;
  enabled: boolean;
}

export function UniverseSection() {
  const { toast } = useToast();
  const { reportSectionStatus, restoreDefaultsSignal } = useSettingsDrawer();
  const { data: universe, isLoading, refetch } = useGetUniverse();
  const updateUniverse = useUpdateUniverse();

  const [etfs, setEtfs] = useState<EtfRow[]>([]);
  const [savedEtfs, setSavedEtfs] = useState<EtfRow[]>([]);
  const [newTicker, setNewTicker] = useState("");
  const initialized = useRef(false);
  const lastRestoreSignal = useRef(restoreDefaultsSignal);

  useEffect(() => {
    if (universe && !initialized.current) {
      setEtfs(universe.etfs.map((e: any) => ({ ...e })));
      setSavedEtfs(universe.etfs.map((e: any) => ({ ...e })));
      initialized.current = true;
    }
  }, [universe]);

  useEffect(() => {
    if (restoreDefaultsSignal !== lastRestoreSignal.current) {
      lastRestoreSignal.current = restoreDefaultsSignal;
      refetch().then((r: any) => {
        if (r.data) {
          initialized.current = false;
        }
      });
    }
  }, [restoreDefaultsSignal, refetch]);

  const dirty = useMemo(() => JSON.stringify(etfs) !== JSON.stringify(savedEtfs), [etfs, savedEtfs]);

  const errors = useMemo(() => {
    const errs: string[] = [];
    const tickers = etfs.map((e) => e.ticker.trim().toUpperCase());
    const dupes = tickers.filter((t, i) => tickers.indexOf(t) !== i);
    if (dupes.length > 0) errs.push(`Duplicate ticker(s): ${[...new Set(dupes)].join(", ")}`);
    if (etfs.some((e) => !/^[A-Z]{1,6}$/.test(e.ticker.trim().toUpperCase()))) {
      errs.push("Every ticker must be 1-6 letters (e.g. XLK, EEM).");
    }
    if (etfs.filter((e) => e.enabled).length === 0) errs.push("At least one ETF must be enabled.");
    return errs;
  }, [etfs]);

  useEffect(() => {
    reportSectionStatus("universe", { dirty, errorCount: errors.length });
  }, [dirty, errors, reportSectionStatus]);

  const handleChange = (index: number, field: keyof EtfRow, value: any) => {
    setEtfs((prev) => prev.map((e, i) => (i === index ? { ...e, [field]: value } : e)));
  };

  const handleAdd = () => {
    const t = newTicker.trim().toUpperCase();
    if (!t) return;
    setEtfs((prev) => [...prev, { ticker: t, name: t, sector: "Unclassified", priorWeight: 0, enabled: true }]);
    setNewTicker("");
  };

  const handleRemove = (index: number) => {
    setEtfs((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    if (errors.length > 0 || !universe) return;
    updateUniverse.mutate(
      { data: { etfs, cashPriorWeight: universe.cashPriorWeight } },
      {
        onSuccess: () => {
          setSavedEtfs(etfs.map((e) => ({ ...e })));
          toast({ title: "Universe saved" });
        },
        onError: () => toast({ title: "Error saving universe", variant: "destructive" }),
      }
    );
  };

  const handleCancel = () => setEtfs(savedEtfs.map((e) => ({ ...e })));
  const handleResetSection = () => {
    initialized.current = false;
    refetch();
  };

  if (isLoading || etfs.length === 0) {
    return (
      <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
    );
  }

  return (
    <SectionShell
      title="Universe"
      description="Define which ETFs are eligible for allocation. Disabled ETFs are excluded from every run. Prior-month weights are managed separately under Previous Weights."
      dirty={dirty}
      errors={errors}
      onSave={handleSave}
      onCancel={handleCancel}
      onResetSection={handleResetSection}
      saving={updateUniverse.isPending}
      saveLabel="Save Universe"
    >
      <div className="border rounded-md overflow-hidden overflow-x-auto">
        <Table>
          <TableHeader className="bg-gray-50">
            <TableRow>
              <TableHead className="w-16">Enabled</TableHead>
              <TableHead>Ticker</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Sector</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {etfs.map((etf, idx) => (
              <TableRow key={idx} className={etf.enabled ? "" : "opacity-50"}>
                <TableCell>
                  <Switch checked={etf.enabled} onCheckedChange={(c) => handleChange(idx, "enabled", c)} />
                </TableCell>
                <TableCell className="font-medium"><EtfLink ticker={etf.ticker} /></TableCell>
                <TableCell>
                  <Input
                    value={etf.name}
                    onChange={(e) => handleChange(idx, "name", e.target.value)}
                    className="h-8 text-sm"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={etf.sector}
                    onChange={(e) => handleChange(idx, "sector", e.target.value)}
                    className="h-8 text-sm"
                  />
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleRemove(idx)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder="Add ticker (e.g. IYT)"
          value={newTicker}
          onChange={(e) => setNewTicker(e.target.value)}
          className="h-8 text-sm w-48"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
        />
        <Button size="sm" variant="outline" onClick={handleAdd} disabled={!newTicker.trim()}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />Add ETF
        </Button>
      </div>
    </SectionShell>
  );
}
