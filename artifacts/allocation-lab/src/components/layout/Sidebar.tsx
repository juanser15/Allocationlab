import { Link, useLocation } from "wouter";
import {
  Activity,
  Archive,
  BarChart2,
  BookOpen,
  Briefcase,
  FileText,
  Gavel,
  LayoutDashboard,
  LineChart,
  Stethoscope,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Investment Committee", href: "/", icon: LayoutDashboard },
  { name: "Portfolio Construction", href: "/portfolio", icon: Briefcase },
  { name: "Results Dashboard", href: "/results", icon: BarChart2 },
  { name: "Portfolio Diagnostics", href: "/diagnostics", icon: Stethoscope },
  { name: "Backtesting", href: "/backtesting", icon: LineChart },
  { name: "AI Committee", href: "/committee", icon: Gavel },
  { name: "Historical Archive", href: "/archive", icon: Archive },
  { name: "Reports", href: "/reports", icon: FileText },
  { name: "Methodology", href: "/methodology", icon: BookOpen },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <div className="flex h-full w-64 flex-col bg-sidebar border-r border-sidebar-border">
      <div className="flex h-16 items-center px-6 border-b border-sidebar-border bg-sidebar-primary text-sidebar-primary-foreground">
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
                className={cn(
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                  "group flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors"
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
      <div className="border-t border-sidebar-border p-4">
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
