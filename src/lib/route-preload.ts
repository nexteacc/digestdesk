const routeLoaders = {
  "/": () => import("@/pages/DailyDigest"),
  "/subscriptions": () => import("@/pages/Subscriptions"),
  "/rss": () => import("@/pages/RssFeeds"),
  "/youtube": () => import("@/pages/YouTubeFeeds"),
  "/podcasts": () => import("@/pages/PodcastFeeds"),
  "/settings": () => import("@/pages/Settings"),
  "/privacy": () => import("@/pages/PrivacyPolicy"),
  "/terms": () => import("@/pages/TermsOfService"),
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
export const loadSubscriptionsPage = routeLoaders["/subscriptions"];
export const loadRssFeedsPage = routeLoaders["/rss"];
export const loadYouTubeFeedsPage = routeLoaders["/youtube"];
export const loadPodcastFeedsPage = routeLoaders["/podcasts"];
export const loadSettingsPage = routeLoaders["/settings"];
export const loadPrivacyPolicyPage = routeLoaders["/privacy"];
export const loadTermsOfServicePage = routeLoaders["/terms"];
export const loadPublicHomePage = routeLoaders["/public-home"];
export const loadNotFoundPage = routeLoaders["/not-found"];
