const routeLoaders = {
  "/": () => import("@/pages/DailyDigest"),
  "/topics/ai-leaders": () => import("@/pages/AiLeadersTopic"),
  "/topics/ai-leaders/detail": () => import("@/pages/AiLeaderDetail"),
  "/subscriptions": () => import("@/pages/Subscriptions"),
  "/rss": () => import("@/pages/RssFeeds"),
  "/youtube": () => import("@/pages/YouTubeFeeds"),
  "/podcasts": () => import("@/pages/PodcastFeeds"),
  "/settings": () => import("@/pages/Settings"),
  "/admin": () => import("@/pages/Admin"),
  "/privacy": () => import("@/pages/PrivacyPolicy"),
  "/terms": () => import("@/pages/TermsOfService"),
  "/sign-in": () => import("@/pages/Login"),
  "/public-home": () => import("@/pages/PublicHome"),
  "/not-found": () => import("@/pages/NotFound"),
} as const;

export function preloadRoute(path: string) {
  const loader = routeLoaders[path as keyof typeof routeLoaders];
  if (loader) {
    void loader();
  }
}

export const loadDailyDigestPage = routeLoaders["/"];
export const loadAiLeadersTopicPage = routeLoaders["/topics/ai-leaders"];
export const loadAiLeaderDetailPage = routeLoaders["/topics/ai-leaders/detail"];
export const loadSubscriptionsPage = routeLoaders["/subscriptions"];
export const loadRssFeedsPage = routeLoaders["/rss"];
export const loadYouTubeFeedsPage = routeLoaders["/youtube"];
export const loadPodcastFeedsPage = routeLoaders["/podcasts"];
export const loadSettingsPage = routeLoaders["/settings"];
export const loadAdminPage = routeLoaders["/admin"];
export const loadPrivacyPolicyPage = routeLoaders["/privacy"];
export const loadTermsOfServicePage = routeLoaders["/terms"];
export const loadLoginPage = routeLoaders["/sign-in"];
export const loadPublicHomePage = routeLoaders["/public-home"];
export const loadNotFoundPage = routeLoaders["/not-found"];
