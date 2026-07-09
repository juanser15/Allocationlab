import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Save, RotateCcw, AlertCircle } from "lucide-react";

interface SectionShellProps {
  title: string;
  description: string;
  children: ReactNode;
  dirty: boolean;
  errors: string[];
  onSave: () => void;
  onCancel: () => void;
  onResetSection: () => void;
  saving?: boolean;
  saveLabel?: string;
}

export function SectionShell({
  title,
  description,
  children,
  dirty,
  errors,
  onSave,
  onCancel,
  onResetSection,
  saving,
  saveLabel = "Save Changes",
}: SectionShellProps) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-gray-900">{title}</h3>
        <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>

      {errors.length > 0 && (
        <div className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2.5 space-y-1">
          {errors.map((err, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{err}</span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-5">{children}</div>

      <div className="flex items-center justify-between gap-2 pt-4 border-t">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={onResetSection}
          type="button"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Reset Section
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={!dirty} type="button">
            Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={!dirty || saving || errors.length > 0} type="button">
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
