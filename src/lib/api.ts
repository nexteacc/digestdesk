import type {
  Feed,
  Digest,
  DigestListItem,
  SubstackSearchResult,
  SubstackInfo,
} from "./types";

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `请求失败 (${res.status})`);
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

// --- Digests ---

export function fetchDigests(
  type?: "daily" | "weekly",
): Promise<DigestListItem[]> {
  const q = type ? `?type=${type}` : "";
  return request(`/digests${q}`);
}

export function fetchDigest(id: string): Promise<Digest> {
  return request(`/digests/${id}`);
}

export function generateDigest(
  type: "daily" | "weekly",
  options?: { date?: string; force?: boolean },
): Promise<Digest> {
  const body: Record<string, unknown> = { type };
  if (options?.date) {
    body.date = options.date;
  }
  if (options?.force && type === "daily") {
    body.force = true;
  }
  return request("/digests/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
