import { useEffect, useState, type PropsWithChildren } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Newspaper, Rss, PanelLeft } from "lucide-react";

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

  useEffect(() => {
    try { localStorage.setItem("sidebar-collapsed", String(isCollapsed)); }
    catch { /* ignore */ }
  }, [isCollapsed]);

  return (
    <div className="min-h-screen paper-noise">
      {/* Masthead */}
      <header className="hairline">
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

      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
        <div className={cn(
          "grid gap-6 transition-all duration-300",
          isCollapsed ? "md:grid-cols-[60px_1fr]" : "md:grid-cols-[240px_1fr]"
        )}>
          {/* Sidebar */}
          <aside className="md:sticky md:top-6 h-fit overflow-hidden">
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
              
              <Separator className="my-1" />
              
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
              
              {!isCollapsed && <Separator className="my-2" />}
              
              {!isCollapsed && (
                <div className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground px-2 py-1">
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
