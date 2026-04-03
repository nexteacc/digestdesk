import { Show, useAuth } from "@clerk/react";
import { Suspense, lazy, useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Router, Route, Switch, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import ErrorBoundary from "@/components/ErrorBoundary";
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
    <div className="min-h-[40vh] flex items-center justify-center text-sm text-muted-foreground">
      Loading page...
    </div>
  );
}

function DashboardRoutes() {
  return (
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
  );
}

function ProtectedRoute({ component: Component }: { component: () => React.JSX.Element }) {
  const { isSignedIn } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isSignedIn) {
      navigate("/");
    }
  }, [isSignedIn, navigate]);

  if (!isSignedIn) {
    return null;
  }

  return <Component />;
}

function AppRouter() {
  return (
    <Router hook={useHashLocation}>
      <Suspense fallback={<RouteFallback />}>
        <Switch>
          <Route path="/privacy" component={PrivacyPolicyPage} />
          <Route path="/terms" component={TermsOfServicePage} />
          <Route path="/" component={HomeRoute} />
          <Route path="/subscriptions" component={SubscriptionsRoute} />
          <Route path="/rss" component={RssFeedsRoute} />
          <Route path="/youtube" component={YouTubeFeedsRoute} />
          <Route path="/podcasts" component={PodcastFeedsRoute} />
          <Route path="/settings" component={SettingsRoute} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Router>
  );
}

function HomeRoute() {
  const { isSignedIn } = useAuth();
  return isSignedIn ? <AuthenticatedApp /> : <PublicHome />;
}

function SubscriptionsRoute() {
  return <ProtectedRoute component={SubscriptionsPage} />;
}

function RssFeedsRoute() {
  return <ProtectedRoute component={RssFeedsPage} />;
}

function YouTubeFeedsRoute() {
  return <ProtectedRoute component={YouTubeFeedsPage} />;
}

function PodcastFeedsRoute() {
  return <ProtectedRoute component={PodcastFeedsPage} />;
}

function SettingsRoute() {
  return <ProtectedRoute component={SettingsPage} />;
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

  return <DashboardRoutes />;
}

export default App;
