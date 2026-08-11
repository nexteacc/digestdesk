import {
  AuthenticateWithRedirectCallback,
  TaskChooseOrganization,
  TaskResetPassword,
  TaskSetupMFA,
  useAuth,
  useClerk,
} from "@clerk/react";
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
import { clearCurrentUserCache, ensureCurrentUser } from "@/lib/api";
import {
  AUTH_BOOTSTRAP_TIMEOUT_MS,
  classifyAuthBootstrapError,
  getAuthBootstrapRetryDelay,
  withAuthBootstrapTimeout,
  type AuthBootstrapFailureKind,
} from "@/lib/auth-bootstrap";
import {
  loadDailyDigestPage,
  loadAdminPage,
  loadNotFoundPage,
  loadPodcastFeedsPage,
  loadPrivacyPolicyPage,
  loadPublicHomePage,
  loadLoginPage,
  loadRssFeedsPage,
  loadSettingsPage,
  loadSubscriptionsPage,
  loadTermsOfServicePage,
  loadYouTubeFeedsPage,
} from "@/lib/route-preload";

const DailyDigest = lazy(loadDailyDigestPage);
const AdminPage = lazy(loadAdminPage);
const SubscriptionsPage = lazy(loadSubscriptionsPage);
const RssFeedsPage = lazy(loadRssFeedsPage);
const YouTubeFeedsPage = lazy(loadYouTubeFeedsPage);
const PodcastFeedsPage = lazy(loadPodcastFeedsPage);
const SettingsPage = lazy(loadSettingsPage);
const NotFound = lazy(loadNotFoundPage);
const PublicHome = lazy(loadPublicHomePage);
const LoginPage = lazy(loadLoginPage);
const PrivacyPolicyPage = lazy(loadPrivacyPolicyPage);
const TermsOfServicePage = lazy(loadTermsOfServicePage);

const PUBLIC_PAGE_METADATA: Record<string, { title: string; description: string }> = {
  "/": {
    title: "DigestDesk — Your everyday editor",
    description: "DigestDesk brings updates from Substack, podcasts, RSS feeds, and YouTube into one personal daily digest.",
  },
  "/privacy": {
    title: "Privacy Policy — DigestDesk",
    description: "Learn how DigestDesk collects, uses, stores, and deletes personal data.",
  },
  "/terms": {
    title: "Terms of Service — DigestDesk",
    description: "Read the terms that govern access to and use of DigestDesk.",
  },
};

function PageMetadata() {
  const [location] = useLocation();
  const { isSignedIn } = useAuth();

  useEffect(() => {
    const isPublicPage = location === "/privacy" || location === "/terms" || (location === "/" && !isSignedIn);
    const metadata = isPublicPage ? PUBLIC_PAGE_METADATA[location] : undefined;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');

    document.title = metadata?.title ?? "DigestDesk";
    description?.setAttribute("content", metadata?.description ?? "DigestDesk personal reading workspace.");
    robots?.setAttribute("content", isPublicPage ? "index, follow" : "noindex, nofollow");
  }, [isSignedIn, location]);

  return null;
}

function WorkspaceLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        role="progressbar"
        aria-label="Loading workspace"
        className="w-[280px] max-w-[calc(100vw-48px)] rounded-[4px] bg-muted p-[2px] shadow-[inset_0_1px_2px_rgba(28,25,23,0.1),inset_0_0_0_1px_rgba(28,25,23,0.06)]"
      >
        <div className="h-2 overflow-hidden rounded-[2px]">
          <span className="workspace-loader-bar block h-full w-2/5 rounded-[2px] bg-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-1px_0_rgba(28,25,23,0.2)]" />
        </div>
      </div>
    </div>
  );
}

function ClerkInitializationError() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div role="alert" className="max-w-sm text-center">
        <h1 className="text-xl font-semibold text-foreground">Authentication could not be loaded</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Check your connection and try again.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function WorkspaceInitializationError({
  failure,
  onRetry,
  onSignOut,
}: {
  failure: AuthBootstrapFailureKind;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  const accessFailure = failure === "access-revoked";
  const authenticationFailure = failure === "unauthorized";
  const title = accessFailure
    ? "This account does not have access"
    : authenticationFailure
      ? "Your session could not be verified"
      : "We couldn't finish loading your workspace";
  const description = accessFailure
    ? "Sign out and contact the workspace administrator if you believe this is a mistake."
    : authenticationFailure
      ? "Sign in again to continue."
      : "The service may be temporarily unavailable. Try again without leaving this page.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div role="alert" className="max-w-sm text-center">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        <div className="mt-5 flex items-center justify-center gap-3">
          {failure === "recoverable" ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Retry
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground"
          >
            {authenticationFailure ? "Sign in again" : "Sign out"}
          </button>
        </div>
      </div>
    </div>
  );
}

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

function SessionTaskLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">{children}</div>;
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
  "/admin": ["内部管理", "Admin"],
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
      <PageMetadata />
      <Switch>
        {import.meta.env.DEV ? (
          <Route path="/sign-in-preview">
            <Suspense fallback={<RouteFallback />}>
              <LoginPage />
            </Suspense>
          </Route>
        ) : null}
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
        <Route path="/session-task/choose-organization">
          <SessionTaskLayout>
            <TaskChooseOrganization redirectUrlComplete="/#/" />
          </SessionTaskLayout>
        </Route>
        <Route path="/session-task/reset-password">
          <SessionTaskLayout>
            <TaskResetPassword redirectUrlComplete="/#/" />
          </SessionTaskLayout>
        </Route>
        <Route path="/session-task/setup-mfa">
          <SessionTaskLayout>
            <TaskSetupMFA redirectUrlComplete="/#/" />
          </SessionTaskLayout>
        </Route>
        <Route>
          {isSignedIn ? <AuthenticatedApp /> : (
            <Suspense fallback={<RouteFallback />}>
              <Switch>
                <Route path="/" component={PublicHome} />
                <Route path="/admin" component={PublicHome} />
                <Route path="/sign-in" component={LoginPage} />
                <Route component={NotFound} />
              </Switch>
            </Suspense>
          )}
        </Route>
      </Switch>
    </Router>
  );
}

function AuthStateRouter() {
  const { isLoaded } = useAuth();
  const [timedOut, setTimedOut] = useState(false);
  const authRoute = window.location.hash.startsWith("#/sign-in");

  useEffect(() => {
    if (isLoaded) {
      return;
    }
    const timeoutId = window.setTimeout(() => setTimedOut(true), AUTH_BOOTSTRAP_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [isLoaded]);

  if (!isLoaded && timedOut) {
    return <ClerkInitializationError />;
  }

  if (!isLoaded && !authRoute) {
    return <WorkspaceLoader />;
  }

  return <AppRouter />;
}

function App() {
  if (window.location.pathname === "/sso-callback") {
    return (
      <ErrorBoundary>
        <AuthenticateWithRedirectCallback
          signInUrl="/#/sign-in"
          signUpUrl="/#/sign-in"
          signInFallbackRedirectUrl="/#/"
          signUpFallbackRedirectUrl="/#/"
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <ZenModeProvider>
        <I18nProvider>
          <ThemeProvider defaultTheme="light">
            <TooltipProvider>
              <Toaster />
              <AuthStateRouter />
            </TooltipProvider>
          </ThemeProvider>
        </I18nProvider>
      </ZenModeProvider>
    </ErrorBoundary>
  );
}

function AuthenticatedApp() {
  const { isLoaded, userId } = useAuth();

  if (!isLoaded || !userId) {
    return <WorkspaceLoader />;
  }

  return <AuthenticatedWorkspace key={userId} userId={userId} />;
}

function AuthenticatedWorkspace({ userId }: { userId: string }) {
  const { signOut } = useClerk();
  const [attempt, setAttempt] = useState(0);
  const [bootstrapState, setBootstrapState] = useState<{
    status: "loading" | "ready" | "error";
    failure?: AuthBootstrapFailureKind;
  }>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    withAuthBootstrapTimeout(ensureCurrentUser(userId))
      .then(() => {
        if (!cancelled) {
          setBootstrapState({ status: "ready" });
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const failure = classifyAuthBootstrapError(error);
        const retryDelay = getAuthBootstrapRetryDelay(attempt, failure);
        clearCurrentUserCache(userId);
        if (retryDelay !== null) {
          console.warn(`[auth/bootstrap] Retrying workspace initialization after ${retryDelay}ms.`);
          retryTimer = setTimeout(() => setAttempt((current) => current + 1), retryDelay);
          return;
        }
        console.error("[auth/bootstrap] Failed to initialize app user:", error);
        setBootstrapState({ status: "error", failure });
      });

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [attempt, userId]);

  useEffect(() => () => clearCurrentUserCache(userId), [userId]);

  if (bootstrapState.status === "error") {
    return (
      <WorkspaceInitializationError
        failure={bootstrapState.failure ?? "recoverable"}
        onRetry={() => {
          clearCurrentUserCache(userId);
          setBootstrapState({ status: "loading" });
          setAttempt(0);
        }}
        onSignOut={() => {
          clearCurrentUserCache(userId);
          void signOut({ redirectUrl: "/#/sign-in" });
        }}
      />
    );
  }

  if (bootstrapState.status !== "ready") {
    return <WorkspaceLoader />;
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
            <Route path="/admin" component={AdminPage} />
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </RouteErrorBoundary>
    </AppShell>
  );
}

export default App;
