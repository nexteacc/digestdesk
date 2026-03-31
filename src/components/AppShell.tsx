import { useEffect, useState, type PropsWithChildren } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { UserButton } from "@clerk/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Newspaper, PanelLeft, Maximize, Minimize, Settings as SettingsIcon, Github } from "lucide-react";
import { useI18n } from "@/contexts/I18nContext";
import { useZenMode } from "@/hooks/useZenMode";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

export default function AppShell({ children }: PropsWithChildren) {
  const [location] = useLocation();
  const googleYouTubeImportEnabled =
    import.meta.env.VITE_ENABLE_GOOGLE_YOUTUBE_IMPORT === "true";
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; }
    catch { return false; }
  });
  const { locale, setLocale, text } = useI18n();
  const { isZen, toggleZenMode } = useZenMode();

  const contentNav: NavItem[] = [
    { href: "/", label: text("今日日报", "Daily Digest"), icon: <Newspaper className="h-4 w-4" /> },
  ];

  const manageNav: NavItem[] = [
    { href: "/subscriptions", label: text("关注列表", "Subscriptions"), icon: <img src="/logos/substack.svg" alt="Substack" className="h-4 w-4" /> },
    { href: "/podcasts", label: text("Podcast 节目", "Podcast Shows"), icon: <img src="/logos/applepodcasts-9933cc.svg" alt="Podcast" className="h-4 w-4" /> },
    { href: "/rss", label: text("RSS 订阅", "RSS Feeds"), icon: <img src="/logos/rss.svg" alt="RSS" className="h-4 w-4" /> },
    { href: "/youtube", label: text("YouTube 频道", "YouTube Channels"), icon: <img src="/logos/youtube.svg" alt="YouTube" className="h-4 w-4" /> },
    { href: "/settings", label: text("偏好设置", "Settings"), icon: <SettingsIcon className="h-4 w-4" /> },
  ];

  useEffect(() => {
    try { localStorage.setItem("sidebar-collapsed", String(isCollapsed)); }
    catch { /* ignore */ }
  }, [isCollapsed]);

  function handleToggleZen() {
    toggleZenMode();
    if (!isZen) {
      toast(text("已进入沉浸模式", "Zen mode enabled"), {
        description: text("按 ESC 键即可退出", "Press ESC to exit"),
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
          <div className="flex items-center justify-between gap-4">
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
                      src="/logos/applepodcasts-9933cc.svg"
                      alt="Podcast"
                      className="h-5 w-5"
                    />
                    <img
                      src="/logos/youtube.svg"
                      alt="YouTube"
                      className="h-5 w-5"
                    />
                    <img
                      src="/logos/rss.svg"
                      alt="RSS"
                      className="h-5 w-5"
                    />
                  </span>
                </span>
              </Link>
            </h1>

            <div className="flex items-center gap-1 rounded-full border border-border bg-card/70 p-1">
              <a
                href="https://github.com/nexteacc/digestdesk"
                target="_blank"
                rel="noreferrer"
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                title={text("开源代码", "Open Source")}
              >
                <Github className="h-4 w-4" />
              </a>
              <div className="h-4 w-[1px] bg-border mx-0.5" />
              <Button
                variant={locale === "zh" ? "default" : "ghost"}
                size="sm"
                className="h-7 rounded-full px-2.5 text-xs"
                onClick={() => setLocale("zh")}
              >
                中文
              </Button>
              <Button
                variant={locale === "en" ? "default" : "ghost"}
                size="sm"
                className="h-7 rounded-full px-2.5 text-xs"
                onClick={() => setLocale("en")}
              >
                EN
              </Button>
            </div>
            <UserButton
              afterSignOutUrl="/"
              userProfileProps={{
                additionalOAuthScopes: googleYouTubeImportEnabled
                  ? {
                      google: ["https://www.googleapis.com/auth/youtube.readonly"],
                    }
                  : undefined,
              }}
            />
            </div>
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
            title={isZen ? text("退出沉浸模式", "Exit zen mode") : text("进入沉浸模式", "Enter zen mode")}
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
                className={cn(
                  "flex items-center cursor-pointer hover:bg-accent/50 rounded-md transition-colors px-3 py-2",
                  isCollapsed ? "justify-center" : "justify-between"
                )}
                title={isCollapsed ? text("展开导航", "Expand navigation") : text("折叠导航", "Collapse navigation")}
              >
                {!isCollapsed && (
                  <span className="text-xs tracking-[0.18em] uppercase text-muted-foreground">{text("导航", "Navigation")}</span>
                )}
                <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                  <PanelLeft className={cn("h-4 w-4 text-muted-foreground transition-transform duration-300")} />
                </div>
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
                          "w-full transition-all duration-300",
                          active && "border border-border",
                          isCollapsed ? "justify-center px-0" : "justify-start px-3 gap-3"
                        )}
                        title={isCollapsed ? item.label : ""}
                      >
                        <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                          {item.icon}
                        </div>
                        {!isCollapsed && <span>{item.label}</span>}
                      </Button>
                    </Link>
                  );
                })}
              </nav>
              
              {!isCollapsed && (
                <div className="mt-4 text-[10px] tracking-[0.2em] uppercase text-muted-foreground px-3 py-1">
                  {text("管理", "Manage")}
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
                          "w-full transition-all duration-300",
                          active && "border border-border",
                          isCollapsed ? "justify-center px-0" : "justify-start px-3 gap-3"
                        )}
                        title={isCollapsed ? item.label : ""}
                      >
                        <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                          {item.icon}
                        </div>
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
