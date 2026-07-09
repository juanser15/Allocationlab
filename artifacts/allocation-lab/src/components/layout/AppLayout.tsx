import { ReactNode, useState } from "react";
import { Link } from "wouter";
import { Activity, Menu, Settings } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const SettingsButton = (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 text-sidebar-primary-foreground hover:bg-white/10 hover:text-sidebar-primary-foreground"
      asChild
    >
      <Link href="/settings" aria-label="Settings">
        <Settings className="h-5 w-5" />
      </Link>
    </Button>
  );

  return (
    <div className="flex h-screen bg-background">
      {!isMobile && <Sidebar />}
      <div className="flex-1 flex flex-col min-w-0">
        {isMobile ? (
          <div className="flex h-14 items-center gap-3 px-4 border-b border-sidebar-border bg-sidebar-primary text-sidebar-primary-foreground shrink-0">
            <Sheet open={open} onOpenChange={setOpen}>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-sidebar-primary-foreground hover:bg-white/10 hover:text-sidebar-primary-foreground"
                onClick={() => setOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <SheetContent side="left" className="p-0 w-72 bg-sidebar border-sidebar-border">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <Sidebar onNavigate={() => setOpen(false)} />
              </SheetContent>
            </Sheet>
            <Activity className="h-5 w-5 text-accent" />
            <span className="text-base font-bold tracking-tight flex-1">Allocation Lab</span>
            {SettingsButton}
          </div>
        ) : (
          <div className="flex h-12 items-center justify-end px-4 border-b border-sidebar-border bg-sidebar-primary text-sidebar-primary-foreground shrink-0">
            {SettingsButton}
          </div>
        )}
        <main className="flex-1 overflow-y-auto bg-gray-50">
          {children}
        </main>
      </div>
    </div>
  );
}
