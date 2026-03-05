import { useEffect, useState, type PropsWithChildren } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Newspaper, Rss, PanelLeft, Maximize, Minimize } from "lucide-react";
import { useZenMode } from "@/hooks/useZenMode";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

const contentNav: NavItem[] = [
  { href: "/", label: "今日日报", icon: <Newspaper className="h-4 w-4" /> },
];

const manageNav: NavItem[] = [
  { href: "/subscriptions", label: "关注列表", icon: <Rss className="h-4 w-4" /> },
];

export default function AppShell({ children }: PropsWithChildren) {
  const [location] = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; }
    catch { return false; }
  });
  const { isZen, toggleZenMode } = useZenMode();

  useEffect(() => {
    try { localStorage.setItem("sidebar-collapsed", String(isCollapsed)); }
    catch { /* ignore */ }
  }, [isCollapsed]);

  function handleToggleZen() {
    toggleZenMode();
    if (!isZen) {
      toast("已进入沉浸模式", {
        description: "按 ESC 键即可退出",
        duration: 3000,
        className: "toast-zen",
      });
    }
  }

  return (
    <div className="min-h-screen paper-noise">
      {/* Masthead */}
      <header className={cn(
        "relative transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden",
        isZen ? "max-h-0 opacity-0 border-none" : "max-h-[100px] opacity-100 hairline"
      )}>
        <div className="mx-auto max-w-6xl px-4 py-4 md:px-6">
          <h1 className="text-2xl md:text-3xl font-semibold leading-none">
            <Link href="/">
              <span className="flex items-center gap-3 hover:opacity-90 transition-opacity">
                <span>DigestDesk</span>
                <span className="flex items-center gap-2">
                  <img
                    src="/logos/substack.svg"
                    alt="Substack"
                    className="h-5 w-5"
                  />
                  <img
                    src="/logos/youtube.svg"
                    alt="YouTube"
                    className="h-5 w-5"
                  />
                </span>
              </span>
            </Link>
          </h1>
        </div>
      </header>

      <div className="relative z-50 flex justify-center h-0">
        <div className={cn(
          "absolute transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
          isZen ? "opacity-0 scale-0 pointer-events-none -top-4" : "-top-0 -translate-y-1/2 opacity-100 scale-100"
        )}>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full h-9 w-9 shadow-md"
            onClick={handleToggleZen}
            title={isZen ? "退出禅意模式" : "进入禅意模式"}
          >
            {isZen ? (
              <Minimize className="h-4 w-4" />
            ) : (
              <Maximize className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      <div className={cn(
        "mx-auto max-w-6xl px-4 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
        "py-6"
      )}>
        <div className={cn(
          "grid transition-[grid-template-columns,gap] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
          isZen 
            ? "grid-cols-[0px_1fr] gap-0" 
            : isCollapsed 
              ? "md:grid-cols-[60px_1fr] gap-6" 
              : "md:grid-cols-[240px_1fr] gap-6"
        )}>
          {/* Sidebar */}
          <aside className={cn(
            "md:sticky md:top-6 h-fit overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] whitespace-nowrap",
            isZen ? "opacity-0 -translate-x-4" : "opacity-100 translate-x-0"
          )}>
            <div className="rounded-lg border border-border bg-card/70 backdrop-blur p-2 shadow-sm">
              <div 
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="flex items-center justify-between cursor-pointer hover:bg-accent/50 rounded-md transition-colors px-2 py-2"
                title={isCollapsed ? "展开导航" : "折叠导航"}
              >
                {!isCollapsed && (
                  <span className="text-xs tracking-[0.18em] uppercase text-muted-foreground">导航</span>
                )}
                <PanelLeft className={cn("h-4 w-4 text-muted-foreground transition-transform duration-300", isCollapsed && "mx-auto")} />
              </div>
              
              <nav className="mt-2 grid gap-1">
                {contentNav.map((item) => {
                  const active =
                    location === item.href ||
                    (item.href !== "/" && location.startsWith(item.href));
                  return (
                    <Link key={item.href} href={item.href}>
                      <Button
                        variant={active ? "secondary" : "ghost"}
                        className={cn(
                          "w-full gap-2 transition-all duration-300",
                          active && "border border-border",
                          isCollapsed ? "justify-center px-0" : "justify-start"
                        )}
                        title={isCollapsed ? item.label : ""}
                      >
                        {item.icon}
                        {!isCollapsed && <span>{item.label}</span>}
                      </Button>
                    </Link>
                  );
                })}
              </nav>
              
              {!isCollapsed && (
                <div className="mt-4 text-[10px] tracking-[0.2em] uppercase text-muted-foreground px-2 py-1">
                  管理
                </div>
              )}
              
              <nav className={cn("mb-1 grid gap-1", isCollapsed && "mt-1")}>
                {manageNav.map((item) => {
                  const active =
                    location === item.href ||
                    (item.href !== "/" && location.startsWith(item.href));
                  return (
                    <Link key={item.href} href={item.href}>
                      <Button
                        variant={active ? "secondary" : "ghost"}
                        className={cn(
                          "w-full gap-2 transition-all duration-300",
                          active && "border border-border",
                          isCollapsed ? "justify-center px-0" : "justify-start"
                        )}
                        title={isCollapsed ? item.label : ""}
                      >
                        {item.icon}
                        {!isCollapsed && <span>{item.label}</span>}
                      </Button>
                    </Link>
                  );
                })}
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <main className="min-w-0">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
