import type { ReactNode } from "react";

interface PageHeaderProps {
  section: string;
  title: string;
  description: string;
  actions?: ReactNode;
}

export function PageHeader({ section, title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">{section}</p>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-primary mt-0.5">{title}</h1>
        <p className="text-muted-foreground mt-1.5 text-sm max-w-2xl">{description}</p>
      </div>
      {actions && <div className="flex gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
