import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Router, Route, Switch } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { I18nProvider } from "@/contexts/I18nContext";
import { ZenModeProvider } from "@/hooks/useZenMode";
import DailyDigest from "@/pages/DailyDigest";
import SubscriptionsPage from "@/pages/Subscriptions";
import RssFeedsPage from "@/pages/RssFeeds";
import SettingsPage from "@/pages/Settings";
import NotFound from "@/pages/NotFound";

function AppRouter() {
  return (
    <Router hook={useHashLocation}>
      <Switch>
        <Route path="/" component={DailyDigest} />
        <Route path="/subscriptions" component={SubscriptionsPage} />
        <Route path="/rss" component={RssFeedsPage} />
        <Route path="/settings" component={SettingsPage} />
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
              <AppRouter />
            </TooltipProvider>
          </ThemeProvider>
        </I18nProvider>
      </ZenModeProvider>
    </ErrorBoundary>
  );
}

export default App;
