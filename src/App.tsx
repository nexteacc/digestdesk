import { Show, useAuth } from "@clerk/react";
import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Router, Route, Switch, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { I18nProvider } from "@/contexts/I18nContext";
import { ZenModeProvider } from "@/hooks/useZenMode";
import DailyDigest from "@/pages/DailyDigest";
import SubscriptionsPage from "@/pages/Subscriptions";
import RssFeedsPage from "@/pages/RssFeeds";
import YouTubeFeedsPage from "@/pages/YouTubeFeeds";
import SettingsPage from "@/pages/Settings";
import NotFound from "@/pages/NotFound";
import PublicHome from "@/pages/PublicHome";
import PrivacyPolicyPage from "@/pages/PrivacyPolicy";
import TermsOfServicePage from "@/pages/TermsOfService";
import { ensureCurrentUser } from "@/lib/api";

function DashboardRoutes() {
  return (
    <Switch>
      <Route path="/" component={DailyDigest} />
      <Route path="/subscriptions" component={SubscriptionsPage} />
      <Route path="/rss" component={RssFeedsPage} />
      <Route path="/youtube" component={YouTubeFeedsPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
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
      <Switch>
        <Route path="/privacy" component={PrivacyPolicyPage} />
        <Route path="/terms" component={TermsOfServicePage} />
        <Route path="/" component={() => {
          const { isSignedIn } = useAuth();
          return isSignedIn ? <AuthenticatedApp /> : <PublicHome />;
        }} />
        <Route path="/subscriptions" component={() => <ProtectedRoute component={SubscriptionsPage} />} />
        <Route path="/rss" component={() => <ProtectedRoute component={RssFeedsPage} />} />
        <Route path="/youtube" component={() => <ProtectedRoute component={YouTubeFeedsPage} />} />
        <Route path="/settings" component={() => <ProtectedRoute component={SettingsPage} />} />
        <Route component={NotFound} />
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
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!isLoaded || !userId) {
      return;
    }

    let cancelled = false;
    setStatus("loading");

    ensureCurrentUser()
      .then(() => {
        if (!cancelled) {
          setStatus("ready");
        }
      })
      .catch((error) => {
        console.error("[auth/bootstrap] Failed to initialize app user:", error);
        if (!cancelled) {
          setStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isLoaded, userId]);

  if (!isLoaded || status === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Loading workspace...</div>;
  }

  if (status === "error") {
    return <div className="min-h-screen flex items-center justify-center text-sm text-destructive">Failed to initialize your account.</div>;
  }

  return <DashboardRoutes />;
}

export default App;
