import type {
  Feed,
  Digest,
  DigestListItem,
  SubstackSearchResult,
  SubstackInfo,
  DiscoveredFeed,
  DiscoveredYouTubeChannel,
  Settings,
} from "./types";

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
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
