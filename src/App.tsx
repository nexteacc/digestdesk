import { Show, useAuth } from "@clerk/react";
import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Router, Route, Switch, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import ErrorBoundary from "@/components/ErrorBoundary";
import AppShell from "@/components/AppShell";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { I18nProvider } from "@/contexts/I18nContext";
import { ZenModeProvider } from "@/hooks/useZenMode";
import { ensureCurrentUser } from "@/lib/api";
import {
  loadDailyDigestPage,
  loadNotFoundPage,
  loadPodcastFeedsPage,
  loadPrivacyPolicyPage,
  loadPublicHomePage,
  loadRssFeedsPage,
  loadSettingsPage,
  loadSubscriptionsPage,
  loadTermsOfServicePage,
  loadYouTubeFeedsPage,
} from "@/lib/route-preload";

const DailyDigest = lazy(loadDailyDigestPage);
const SubscriptionsPage = lazy(loadSubscriptionsPage);
const RssFeedsPage = lazy(loadRssFeedsPage);
const YouTubeFeedsPage = lazy(loadYouTubeFeedsPage);
const PodcastFeedsPage = lazy(loadPodcastFeedsPage);
const SettingsPage = lazy(loadSettingsPage);
const NotFound = lazy(loadNotFoundPage);
const PublicHome = lazy(loadPublicHomePage);
const PrivacyPolicyPage = lazy(loadPrivacyPolicyPage);
const TermsOfServicePage = lazy(loadTermsOfServicePage);

function RouteFallback() {
  return (
    <div className="space-y-6 py-2">
      <div className="h-7 w-48 rounded bg-muted animate-pulse" />
      <div className="space-y-3">
        <div className="h-32 rounded-lg bg-muted/60 animate-pulse" />
        <div className="h-32 rounded-lg bg-muted/40 animate-pulse" />
        <div className="h-32 rounded-lg bg-muted/30 animate-pulse" />
      </div>
    </div>
  );
}

// #13 — chunk 加载失败时可重试，不摧毁整个应用
class RouteErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      const isZh = (localStorage.getItem("digestdesk-locale") || "en") === "zh";
      return (
        <div className="py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {isZh ? "页面加载失败，请检查网络后重试" : "Failed to load page. Check your connection and try again."}
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="mt-4 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md"
          >
            {isZh ? "重试" : "Retry"}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// #19 + #20 — 路由切换后移焦点到内容区 + aria-live 播报
const ROUTE_TITLES: Record<string, [string, string]> = {
  "/": ["今日日报", "Daily Digest"],
  "/subscriptions": ["关注列表", "Subscriptions"],
  "/rss": ["RSS 订阅", "RSS Feeds"],
  "/youtube": ["YouTube 频道", "YouTube Channels"],
  "/podcasts": ["Podcast 节目", "Podcast Shows"],
  "/settings": ["偏好设置", "Settings"],
};

function RouteAnnouncer() {
  const [location] = useLocation();
  const [announcement, setAnnouncement] = useState("");
  const isFirstRender = useRef(true);

  const getTitle = useCallback(() => {
    const pair = ROUTE_TITLES[location];
    if (!pair) return "";
    const isZh = (localStorage.getItem("digestdesk-locale") || "en") === "zh";
    return isZh ? pair[0] : pair[1];
  }, [location]);

  useEffect(() => {
    // 首次渲染不播报
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const title = getTitle();
    let announceTimer: ReturnType<typeof setTimeout> | undefined;
    if (title) {
      announceTimer = setTimeout(() => setAnnouncement(title), 0);
    }

    // 将焦点移到内容区
    const main = document.getElementById("main-content");
    if (main) {
      main.setAttribute("tabindex", "-1");
      main.focus({ preventScroll: true });
    }

    return () => {
      if (announceTimer) {
        clearTimeout(announceTimer);
      }
    };
  }, [location, getTitle]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {announcement}
    </div>
  );
}

function AppRouter() {
  const { isSignedIn } = useAuth();

  return (
    <Router hook={useHashLocation}>
      <Switch>
        <Route path="/privacy">
          <Suspense fallback={<RouteFallback />}>
            <PrivacyPolicyPage />
          </Suspense>
        </Route>
        <Route path="/terms">
          <Suspense fallback={<RouteFallback />}>
            <TermsOfServicePage />
          </Suspense>
        </Route>
        <Route>
          {isSignedIn ? <AuthenticatedApp /> : (
            <Suspense fallback={<RouteFallback />}>
              <Switch>
                <Route path="/" component={PublicHome} />
                <Route component={NotFound} />
              </Switch>
            </Suspense>
          )}
        </Route>
      </Switch>
    </Router>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ZenModeProvider>
        <I18nProvider>
          <ThemeProvider defaultTheme="light">
            <TooltipProvider>
              <Toaster />
              <Show when="signed-in">
                <AppRouter />
              </Show>
              <Show when="signed-out">
                <AppRouter />
              </Show>
            </TooltipProvider>
          </ThemeProvider>
        </I18nProvider>
      </ZenModeProvider>
    </ErrorBoundary>
  );
}

function AuthenticatedApp() {
  const { isLoaded, userId } = useAuth();
  const [bootstrapState, setBootstrapState] = useState<{
    resolvedUserId: string | null;
    status: "ready" | "error" | null;
  }>({
    resolvedUserId: null,
    status: null,
  });

  useEffect(() => {
    if (!isLoaded || !userId) {
      return;
    }

    let cancelled = false;

    ensureCurrentUser()
      .then(() => {
        if (!cancelled) {
          setBootstrapState({ resolvedUserId: userId, status: "ready" });
        }
      })
      .catch((error) => {
        console.error("[auth/bootstrap] Failed to initialize app user:", error);
        if (!cancelled) {
          setBootstrapState({ resolvedUserId: userId, status: "error" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isLoaded, userId]);

  if (!isLoaded || !userId || bootstrapState.resolvedUserId !== userId) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Loading workspace...</div>;
  }

  if (bootstrapState.status === "error") {
    return <div className="min-h-screen flex items-center justify-center text-sm text-destructive">Failed to initialize your account.</div>;
  }

  return (
    <AppShell>
      <RouteAnnouncer />
      <RouteErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Switch>
            <Route path="/" component={DailyDigest} />
            <Route path="/subscriptions" component={SubscriptionsPage} />
            <Route path="/rss" component={RssFeedsPage} />
            <Route path="/youtube" component={YouTubeFeedsPage} />
            <Route path="/podcasts" component={PodcastFeedsPage} />
            <Route path="/settings" component={SettingsPage} />
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </RouteErrorBoundary>
    </AppShell>
  );
}

export default App;
