import { useState, type PropsWithChildren, type ReactNode } from "react";
import { UserButton, useUser } from "@clerk/react";
import { Link, useLocation } from "wouter";
import {
  ChevronDown,
  Menu,
  Newspaper,
  Settings as SettingsIcon,
  Star,
  X,
} from "lucide-react";

import { useI18n } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { preloadRoute } from "@/lib/route-preload";

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

export default function AppShell({ children }: PropsWithChildren) {
  const [location] = useLocation();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const { user } = useUser();
  const { locale, setLocale, text } = useI18n();
  const googleYouTubeImportEnabled = import.meta.env.VITE_ENABLE_GOOGLE_YOUTUBE_IMPORT === "true";
  const displayName = user?.fullName || user?.firstName || user?.primaryEmailAddress?.emailAddress || text("用户", "Reader");
  const showUtilityBar = !location.startsWith("/topics/");

  const contentNav: NavItem[] = [
    { href: "/", label: text("今日日报", "Daily Digest"), icon: <Newspaper /> },
    { href: "/topics/ai-leaders", label: text("专题", "Features"), icon: <Star /> },
  ];

  const manageNav: NavItem[] = [
    { href: "/subscriptions", label: text("关注列表", "Subscriptions"), icon: <img src="/logos/substack.svg" alt="" /> },
    { href: "/podcasts", label: text("Podcast 节目", "Podcast Shows"), icon: <img src="/logos/applepodcasts-9933cc.svg" alt="" /> },
    { href: "/rss", label: text("RSS 订阅", "RSS Feeds"), icon: <img src="/logos/rss.svg" alt="" /> },
    { href: "/youtube", label: text("YouTube 频道", "YouTube Channels"), icon: <img src="/logos/youtube.svg" alt="" /> },
    { href: "/settings", label: text("偏好设置", "Settings"), icon: <SettingsIcon /> },
  ];

  function isActive(href: string) {
    if (href === "/") return location === "/";
    return location === href || location.startsWith(`${href}/`);
  }

  function navGroup(items: NavItem[]) {
    return items.map((item) => (
      <Link
        key={item.href}
        href={item.href}
        className={cn("workspace-nav-item", isActive(item.href) && "is-active")}
        onMouseEnter={() => preloadRoute(item.href)}
        onFocus={() => preloadRoute(item.href)}
        onPointerDown={() => preloadRoute(item.href)}
        onClick={() => setIsMobileNavOpen(false)}
      >
        <span className="workspace-nav-icon" aria-hidden="true">{item.icon}</span>
        <span>{item.label}</span>
      </Link>
    ));
  }

  function renderUserButton() {
    return (
      <UserButton
        userProfileProps={{
          additionalOAuthScopes: googleYouTubeImportEnabled
            ? { google: ["https://www.googleapis.com/auth/youtube.readonly"] }
            : undefined,
        }}
        appearance={{ elements: { avatarBox: "h-full w-full" } }}
      />
    );
  }

  return (
    <div className="workspace-shell paper-noise">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-sm focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
      >
        {text("跳到主要内容", "Skip to main content")}
      </a>

      <aside className={cn("workspace-sidebar", isMobileNavOpen && "is-mobile-open")} aria-label={text("主导航", "Main navigation")}>
        <div className="workspace-sidebar-head">
          <Link href="/" className="workspace-brand">DigestDesk</Link>
          <button
            type="button"
            className="workspace-mobile-toggle"
            aria-expanded={isMobileNavOpen}
            aria-controls="workspace-sidebar-body"
            aria-label={isMobileNavOpen ? text("关闭导航", "Close navigation") : text("打开导航", "Open navigation")}
            onClick={() => setIsMobileNavOpen((open) => !open)}
          >
            {isMobileNavOpen ? <X /> : <Menu />}
          </button>
        </div>

        <div id="workspace-sidebar-body" className="workspace-sidebar-body">
          <div className="workspace-nav-label">{text("内容", "Content")}</div>
          <nav className="workspace-nav-group">{navGroup(contentNav)}</nav>
          <div className="workspace-nav-separator" />
          <div className="workspace-nav-label">{text("管理", "Manage")}</div>
          <nav className="workspace-nav-group">{navGroup(manageNav)}</nav>
        </div>

        <div className="workspace-sidebar-user">
          <span className="workspace-user-avatar">{renderUserButton()}</span>
          <span className="workspace-user-copy">
            <strong>{displayName}</strong>
            <span>{text("DigestDesk 用户", "DigestDesk reader")}</span>
          </span>
          <ChevronDown aria-hidden="true" />
        </div>
      </aside>

      <div className="workspace-surface">
        {showUtilityBar ? (
          <header className="workspace-utility-bar">
            <button
              type="button"
              className="workspace-locale-button"
              onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
              aria-label={locale === "zh" ? "Switch to English" : "切换到中文"}
            >
              {locale === "zh" ? "EN" : "中"}
            </button>
            <div className="workspace-utility-user">
              <span className="workspace-user-avatar">{renderUserButton()}</span>
              <strong>{displayName}</strong>
            </div>
          </header>
        ) : null}
        <main id="main-content" className="workspace-main">{children}</main>
      </div>
    </div>
  );
}
