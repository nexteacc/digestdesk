import { useEffect, useState, type PropsWithChildren } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { UserButton } from "@clerk/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Newspaper, PanelLeft, Maximize, Minimize, Settings as SettingsIcon, Github, ChevronDown } from "lucide-react";
import { useI18n } from "@/contexts/I18nContext";
import { useZenMode } from "@/hooks/useZenMode";
import { preloadRoute } from "@/lib/route-preload";

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
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
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

  function handleNavIntent(href: string) {
    preloadRoute(href);
  }

  return (
    <div className="min-h-screen paper-noise">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-sm focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
      >
        Skip to main content
      </a>

      {/* Masthead */}
      <header className={cn(
        "relative overflow-hidden transition-[max-height,opacity,border-color,box-shadow] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
        isZen ? "max-h-0 opacity-0 border-none" : "max-h-[140px] md:max-h-[100px] opacity-100 hairline"
      )}>
        <div className="mx-auto max-w-6xl px-4 py-3 md:px-6 md:py-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 md:flex-nowrap md:gap-4">
            <h1 className="min-w-0 text-2xl md:text-3xl font-semibold leading-none">
              <Link href="/">
                <span className="flex items-center gap-2 md:gap-3 hover:opacity-90 transition-opacity">
                  <span>DigestDesk</span>
                  <span className="hidden md:flex items-center gap-2">
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

            <div className="order-3 flex w-full items-center justify-between gap-2 md:order-none md:w-auto md:justify-end">
              <div className="flex items-center gap-2 md:hidden">
                <img src="/logos/substack.svg" alt="Substack" className="h-4 w-4" />
                <img src="/logos/applepodcasts-9933cc.svg" alt="Podcast" className="h-4 w-4" />
                <img src="/logos/youtube.svg" alt="YouTube" className="h-4 w-4" />
                <img src="/logos/rss.svg" alt="RSS" className="h-4 w-4" />
              </div>
              <div className="flex items-center gap-1 rounded-full border border-border bg-card/70 p-1">
                <a
                  href="https://github.com/nexteacc/digestdesk"
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-7 md:w-7"
                  title={text("开源代码", "Open Source")}
                >
                  <Github className="h-4 w-4" />
                </a>
                <div className="h-4 w-[1px] bg-border mx-0.5" />
                <Button
                  variant={locale === "zh" ? "default" : "ghost"}
                  size="sm"
                  className="h-10 rounded-full px-3 text-xs md:h-7 md:px-2.5"
                  onClick={() => setLocale("zh")}
                >
                  中文
                </Button>
                <Button
                  variant={locale === "en" ? "default" : "ghost"}
                  size="sm"
                  className="h-10 rounded-full px-3 text-xs md:h-7 md:px-2.5"
                  onClick={() => setLocale("en")}
                >
                  EN
                </Button>
              </div>
            </div>
            <UserButton
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
          "absolute transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
          isZen ? "opacity-0 scale-0 pointer-events-none -top-4" : "-top-0 -translate-y-1/2 opacity-100 scale-100"
        )}>
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 rounded-full shadow-md md:h-9 md:w-9"
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
        "mx-auto max-w-6xl px-4 transition-[padding] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
        "py-4 md:py-6"
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
            "mb-4 h-fit overflow-hidden transition-[opacity,transform,margin] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] md:sticky md:top-6 md:mb-0 md:whitespace-nowrap",
            isZen ? "opacity-0 -translate-x-4" : "opacity-100 translate-x-0"
          )}>
            <div className="rounded-lg border border-border bg-card/70 backdrop-blur p-2 shadow-sm">
              <button
                type="button"
                aria-expanded={isMobileNavOpen}
                aria-controls="sidebar-navigation"
                onClick={() => setIsMobileNavOpen(!isMobileNavOpen)}
                className="flex min-h-11 w-full items-center justify-between rounded-md px-3 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
                title={isMobileNavOpen ? text("收起导航", "Collapse navigation") : text("展开导航", "Expand navigation")}
              >
                <span className="text-xs tracking-[0.18em] uppercase text-muted-foreground">{text("导航", "Navigation")}</span>
                <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-300", isMobileNavOpen && "rotate-180")} />
              </button>

              <button
                type="button"
                aria-expanded={!isCollapsed}
                aria-controls="sidebar-navigation"
                onClick={() => setIsCollapsed(!isCollapsed)}
                className={cn(
                  "hidden w-full items-center rounded-md px-3 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex",
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
              </button>
              
              <div className={cn(
                "overflow-hidden transition-[max-height,opacity] duration-300 md:max-h-none md:overflow-visible md:opacity-100",
                isMobileNavOpen ? "max-h-[520px] opacity-100" : "max-h-0 opacity-0"
              )}>
                <nav id="sidebar-navigation" className="mt-2 grid gap-1">
                  {contentNav.map((item) => {
                    const active =
                      location === item.href ||
                      (item.href !== "/" && location.startsWith(item.href));
                    return (
                      <Button
                        key={item.href}
                        asChild
                        variant={active ? "secondary" : "ghost"}
                        className={cn(
                          "h-11 w-full transition-[background-color,color,border-color,box-shadow,transform] duration-300 md:h-9",
                          active && "border border-border",
                          isCollapsed ? "md:justify-center md:px-0 justify-start px-3 gap-3" : "justify-start px-3 gap-3"
                        )}
                        title={isCollapsed ? item.label : ""}
                        onMouseEnter={() => handleNavIntent(item.href)}
                        onFocus={() => handleNavIntent(item.href)}
                        onPointerDown={() => handleNavIntent(item.href)}
                        onTouchStart={() => handleNavIntent(item.href)}
                      >
                        <Link href={item.href}>
                          <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                            {item.icon}
                          </div>
                          <span className={cn(isCollapsed && "md:hidden")}>{item.label}</span>
                        </Link>
                      </Button>
                    );
                  })}
                </nav>
                
                <div className={cn(
                  "mt-4 text-[10px] tracking-[0.2em] uppercase text-muted-foreground px-3 py-1",
                  isCollapsed && "md:hidden"
                )}>
                  {text("管理", "Manage")}
                </div>
                
                <nav className={cn("mb-1 grid gap-1", isCollapsed && "md:mt-1")}>
                  {manageNav.map((item) => {
                    const active =
                      location === item.href ||
                      (item.href !== "/" && location.startsWith(item.href));
                    return (
                      <Button
                        key={item.href}
                        asChild
                        variant={active ? "secondary" : "ghost"}
                        className={cn(
                          "h-11 w-full transition-[background-color,color,border-color,box-shadow,transform] duration-300 md:h-9",
                          active && "border border-border",
                          isCollapsed ? "md:justify-center md:px-0 justify-start px-3 gap-3" : "justify-start px-3 gap-3"
                        )}
                        title={isCollapsed ? item.label : ""}
                        onMouseEnter={() => handleNavIntent(item.href)}
                        onFocus={() => handleNavIntent(item.href)}
                        onPointerDown={() => handleNavIntent(item.href)}
                        onTouchStart={() => handleNavIntent(item.href)}
                      >
                        <Link href={item.href}>
                          <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                            {item.icon}
                          </div>
                          <span className={cn(isCollapsed && "md:hidden")}>{item.label}</span>
                        </Link>
                      </Button>
                    );
                  })}
                </nav>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <main id="main-content" className="min-w-0">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
