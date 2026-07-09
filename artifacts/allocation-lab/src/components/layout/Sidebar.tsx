import { Link, useLocation } from "wouter";
import {
  Activity,
  Briefcase,
  FlaskConical,
  Gavel,
  LayoutDashboard,
  LineChart,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Market Monitor", href: "/market-monitor", icon: LineChart },
  { name: "Portfolio Lab", href: "/portfolio-lab", icon: Briefcase },
  { name: "Research Lab", href: "/research-lab", icon: FlaskConical },
  { name: "Investment Committee", href: "/investment-committee", icon: Gavel },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();

  return (
    <div className="flex h-full w-64 flex-col bg-sidebar border-r border-sidebar-border">
      <div className="flex h-16 items-center px-6 border-b border-sidebar-border bg-sidebar-primary text-sidebar-primary-foreground shrink-0">
        <Activity className="mr-2 h-6 w-6 text-accent" />
        <span className="text-lg font-bold tracking-tight">Allocation Lab</span>
      </div>
      <div className="flex-1 overflow-y-auto py-4">
        <nav className="space-y-1 px-3">
          {navigation.map((item) => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                  "group flex items-center rounded-md px-3 py-2.5 sm:py-2 text-sm font-medium transition-colors"
                )}
              >
                <item.icon
                  className={cn(
                    isActive ? "text-accent" : "text-sidebar-foreground/60 group-hover:text-sidebar-accent-foreground",
                    "mr-3 h-5 w-5 flex-shrink-0 transition-colors"
                  )}
                  aria-hidden="true"
                />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="border-t border-sidebar-border p-4 shrink-0">
        <div className="flex items-center">
          <div className="ml-3">
            <p className="text-xs font-medium text-sidebar-foreground">Allocation Lab v2</p>
            <p className="text-xs text-sidebar-foreground/60">Institutional Grade</p>
          </div>
        </div>
      </div>
    </div>
  );
}
