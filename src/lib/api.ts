import type {
  Feed,
  Digest,
  DigestOverview,
  DigestListItem,
  PodcastSearchResult,
  SubstackSearchResult,
  SubstackInfo,
  DiscoveredFeed,
  DiscoveredYouTubeChannel,
  GoogleYouTubeSubscription,
  Settings,
} from "./types";

const BASE = "/api";

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function getLocale(): string {
  try {
    return localStorage.getItem("digestdesk-locale") || "en";
  } catch {
    return "en";
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const locale = getLocale();
    const message = (locale === "zh" && body.errorZh) ? body.errorZh : (body.error || `Request failed (${res.status})`);
    throw new ApiError(message, res.status, body.code);
  }
  return res.json();
}

type CurrentUser = {
  id: string;
  clerkId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
  lastLoginAt: string;
};

type CurrentUserCache = {
  clerkId: string;
  promise: Promise<CurrentUser>;
};

let _currentUserCache: CurrentUserCache | null = null;

export function ensureCurrentUser(clerkId: string): Promise<CurrentUser> {
  if (_currentUserCache?.clerkId === clerkId) {
    return _currentUserCache.promise;
  }

  const promise = request<CurrentUser>("/auth/me")
    .then((user) => {
      if (user.clerkId !== clerkId) {
        throw new ApiError("Authenticated user does not match the initialized workspace.", 401, "AUTH_USER_MISMATCH");
      }
      return user;
    })
    .catch((error) => {
      if (_currentUserCache?.promise === promise) {
        _currentUserCache = null;
      }
      throw error;
    });

  _currentUserCache = { clerkId, promise };
  return promise;
}

export function clearCurrentUserCache(clerkId?: string) {
  if (!clerkId || _currentUserCache?.clerkId === clerkId) {
    _currentUserCache = null;
  }
}

// --- Feeds ---

export function fetchFeeds(): Promise<Feed[]> {
  return request("/feeds");
}

export function createFeed(url: string): Promise<Feed> {
  return request("/feeds", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export function deleteFeed(id: string): Promise<void> {
  return request(`/feeds/${id}`, { method: "DELETE" });
}

// --- Substack ---

export async function searchSubstack(
  query: string,
): Promise<SubstackSearchResult[]> {
  const data = await request<{ results: SubstackSearchResult[] }>(
    `/substack/search?query=${encodeURIComponent(query)}`,
  );
  return data.results;
}

export function getSubstackInfo(url: string): Promise<SubstackInfo> {
  return request(`/substack/info?url=${encodeURIComponent(url)}`);
}

export async function fetchSubstackReads(
  username: string,
): Promise<SubstackSearchResult[]> {
  const data = await request<{ results: SubstackSearchResult[] }>(
    `/substack/reads?username=${encodeURIComponent(username)}`,
  );
  return data.results;
}

// --- Feeds (bulk) ---

export function importFeeds(
  items: Array<{
    url: string;
    name?: string;
    logoUrl?: string;
    authorName?: string;
    description?: string;
  }>,
): Promise<{ created: number; skipped: number }> {
  return request("/feeds/import", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

// --- Feeds (batch delete) ---

export function batchDeleteFeeds(
  ids: string[],
): Promise<{ deleted: number }> {
  return request("/feeds/batch", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
}

// --- RSS Feeds ---

export function discoverRssFeed(url: string): Promise<DiscoveredFeed> {
  return request("/rss-feeds/discover", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export function createRssFeed(data: {
  feedUrl: string;
  siteUrl: string;
  title?: string;
  description?: string;
  logoUrl?: string;
  authorName?: string;
}): Promise<Feed> {
  return request("/rss-feeds", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function fetchRssFeeds(): Promise<Feed[]> {
  return request("/rss-feeds");
}

export function deleteRssFeed(id: string): Promise<void> {
  return deleteFeed(id);
}

export function batchDeleteRssFeeds(ids: string[]): Promise<{ deleted: number }> {
  return batchDeleteFeeds(ids);
}

// --- YouTube Feeds ---

export function discoverYouTubeChannel(url: string): Promise<DiscoveredYouTubeChannel> {
  return request("/youtube-feeds/discover", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export function createYouTubeFeed(data: {
  channelId: string;
  title: string;
  logoUrl?: string;
}): Promise<{ id: string; success: true }> {
  return request("/youtube-feeds", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function fetchYouTubeFeeds(): Promise<Feed[]> {
  return request("/youtube-feeds");
}

export function deleteYouTubeFeed(id: string): Promise<void> {
  return deleteFeed(id);
}

export function batchDeleteYouTubeFeeds(ids: string[]): Promise<{ deleted: number }> {
  return batchDeleteFeeds(ids);
}

export function fetchGoogleYouTubeSubscriptions(): Promise<{ items: GoogleYouTubeSubscription[] }> {
  return request("/youtube-feeds/google-subscriptions");
}

// --- Podcast Feeds ---

export async function searchPodcasts(query: string): Promise<PodcastSearchResult[]> {
  const data = await request<{ results: PodcastSearchResult[] }>(
    `/podcast-feeds/search?query=${encodeURIComponent(query)}`,
  );
  return data.results;
}

export function createPodcastFeed(data: {
  title: string;
  description?: string;
  logoUrl?: string;
  authorName?: string;
  feedUrl: string;
  siteUrl: string;
}): Promise<{ id: string; success: true }> {
  return request("/podcast-feeds", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function fetchPodcastFeeds(): Promise<Feed[]> {
  return request("/podcast-feeds");
}

export function deletePodcastFeed(id: string): Promise<void> {
  return deleteFeed(id);
}

export function batchDeletePodcastFeeds(ids: string[]): Promise<{ deleted: number }> {
  return batchDeleteFeeds(ids);
}

// --- Settings ---

export function fetchSettings(): Promise<Settings> {
  return request("/settings");
}

export function updateSettings(data: Settings): Promise<{ success: true }> {
  return request("/settings", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// --- Digests ---

export function fetchDigests(
  type?: "daily",
): Promise<DigestListItem[]> {
  const q = type ? `?type=${type}` : "";
  return request(`/digests${q}`);
}

export function generateDigest(
  type: "daily" = "daily",
  options?: { date?: string; force?: boolean },
): Promise<{ id: string } | { status: "empty" }> {
  return request("/digests/generate", {
    method: "POST",
    body: JSON.stringify({ type, ...options }),
  });
}

export function fetchDigest(id: string): Promise<Digest> {
  return request(`/digests/${id}`);
}

export function fetchDigestOverview(): Promise<DigestOverview> {
  return request("/digests/overview");
}

export function fetchPublicDigest(): Promise<DigestOverview> {
  return request("/public/digest");
}

// --- Admin ---

export type AdminPlan = "free" | "test" | "admin";
export type AdminAccessStatus = "active" | "revoked";
export type AdminInviteStatus = "invited" | "claimed" | "revoked";

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
  lastLoginAt: string;
  accountPlan: AdminPlan;
  accessStatus: AdminAccessStatus;
  subscriptionLimitOverride: number | null;
  subscriptionLimit: number | null;
  activeSubscriptions: number;
  digestCount: number;
  lastDigestAt: string | null;
};

export type AdminInvite = {
  id: string;
  email: string;
  accountPlan: AdminPlan;
  subscriptionLimitOverride: number | null;
  status: AdminInviteStatus;
  createdAt: string;
  updatedAt: string;
  claimedUserId: string | null;
};

export type AdminOperationsDay = {
  date: string;
  jobs: {
    total: number;
    succeeded: number;
    skipped: number;
    failed: number;
    retrying: number;
    pending: number;
    running: number;
    cancelled: number;
  };
  summaryJobs: {
    total: number;
    succeeded: number;
    skipped: number;
    failed: number;
    retrying: number;
    pending: number;
    running: number;
    cancelled: number;
  };
  digests: number;
  items: number;
  delivery: {
    qualityTrackedDigests: number;
    eligibleItems: number;
    assemblyRetries: number;
    summaryExcluded: number;
    publishedWithoutSummary: number;
  };
};

export type AdminOperationsAnomaly = {
  kind: "digest_job" | "summary_job";
  id: string;
  subject: string;
  targetDate: string | null;
  status: string;
  attemptCount: number;
  lastError: string | null;
  scheduledFor: string;
  startedAt: string | null;
  finishedAt: string | null;
  articleUrl?: string;
  language?: string;
};

export type AdminOperationsSummary = {
  days: AdminOperationsDay[];
  anomalyCount: number;
  anomalies: AdminOperationsAnomaly[];
  generatedAt: string;
};

export function fetchAdminMe(): Promise<{
  isAdmin: true;
  user: { id: string; email: string; name: string | null; avatarUrl: string | null };
  plans: Record<AdminPlan, number | null>;
}> {
  return request("/admin/me");
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const data = await request<{ users: AdminUser[] }>("/admin/users");
  return data.users;
}

export function updateAdminUserEntitlement(
  userId: string,
  data: {
    accountPlan: AdminPlan;
    subscriptionLimitOverride?: number | null;
    accessStatus?: AdminAccessStatus;
  },
): Promise<{ entitlement: unknown }> {
  return request(`/admin/users/${userId}/entitlements`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function fetchAdminOperationsSummary(days = 7): Promise<AdminOperationsSummary> {
  return request(`/admin/operations/summary?days=${encodeURIComponent(String(days))}`);
}

export async function fetchAdminInvites(): Promise<AdminInvite[]> {
  const data = await request<{ invites: AdminInvite[] }>("/admin/invites");
  return data.invites;
}

export async function createAdminInvite(data: {
  email: string;
  accountPlan: AdminPlan;
  subscriptionLimitOverride?: number | null;
}): Promise<AdminInvite> {
  const result = await request<{ invite: AdminInvite }>("/admin/invites", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return result.invite;
}

export async function revokeAdminInvite(id: string): Promise<AdminInvite> {
  const result = await request<{ invite: AdminInvite }>(`/admin/invites/${id}/revoke`, {
    method: "PATCH",
  });
  return result.invite;
}
