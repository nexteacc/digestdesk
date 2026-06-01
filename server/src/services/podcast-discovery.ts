import RssParser from "rss-parser";
import type { PodcastSearchResult } from "../../../shared/types.js";
import { safeParseRssUrl } from "../sources/safe-fetch.js";
import { htmlToMarkdown } from "./content-extractor.js";

const APPLE_SEARCH_URL = "https://itunes.apple.com/search";
const DEFAULT_SEARCH_LIMIT = 6;
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_MIN_INTERVAL_MS = 4_000;

type SearchCacheEntry = {
  expiresAt: number;
  results: PodcastSearchResult[];
};

const searchCache = new Map<string, SearchCacheEntry>();
let lastAppleSearchStartedAt = 0;

const rssParser = new RssParser({
  timeout: 10000,
  headers: {
    "User-Agent": "DigestDesk/1.0 (Podcast Discovery)",
  },
});
const PODCAST_DISCOVERY_HEADERS = { "User-Agent": "DigestDesk/1.0 (Podcast Discovery)" };

type ApplePodcastItem = {
  collectionName?: string;
  artistName?: string;
  artworkUrl600?: string;
  artworkUrl100?: string;
  feedUrl?: string;
  collectionViewUrl?: string;
  releaseDate?: string;
};

function pickText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeText(value: string): string {
  const markdown = htmlToMarkdown(value || "");
  return markdown
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toIsoDate(value: number | string | undefined): string | undefined {
  if (typeof value === "number") {
    const timestamp = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === "string" && value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function getCachedSearchResults(query: string): PodcastSearchResult[] | null {
  const key = normalizeSearchQuery(query);
  const cached = searchCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    searchCache.delete(key);
    return null;
  }
  return cached.results;
}

function setCachedSearchResults(query: string, results: PodcastSearchResult[]) {
  const key = normalizeSearchQuery(query);
  searchCache.set(key, {
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
    results,
  });

  if (searchCache.size > 100) {
    const oldestKey = searchCache.keys().next().value;
    if (oldestKey) {
      searchCache.delete(oldestKey);
    }
  }
}

async function waitForAppleSearchSlot() {
  const now = Date.now();
  const waitMs = Math.max(0, SEARCH_MIN_INTERVAL_MS - (now - lastAppleSearchStartedAt));
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastAppleSearchStartedAt = Date.now();
}

export async function verifyPodcastFeed(candidate: {
  title: string;
  authorName: string;
  description: string;
  logoUrl: string;
  feedUrl: string;
  siteUrl: string;
  latestPublishedAt?: string;
}): Promise<PodcastSearchResult | null> {
  const feedUrl = candidate.feedUrl.trim();
  if (!feedUrl) return null;

  try {
    const parsed = await safeParseRssUrl(rssParser, feedUrl, { headers: PODCAST_DISCOVERY_HEADERS, timeoutMs: 10000 });
    const title = parsed.title?.trim() || candidate.title;
    if (!title) return null;

    const siteUrl = parsed.link?.trim() || candidate.siteUrl || feedUrl;
    const description = sanitizeText(parsed.description || candidate.description || "");
    const logoUrl = parsed.image?.url || candidate.logoUrl || "";
    const authorName = candidate.authorName || "";

    const latestPublishedAt =
      parsed.items?.[0]?.isoDate ||
      parsed.items?.[0]?.pubDate ||
      candidate.latestPublishedAt;

    if (!parsed.items || parsed.items.length === 0) {
      return null;
    }

    return {
      title,
      authorName,
      description,
      logoUrl,
      feedUrl,
      siteUrl,
      latestPublishedAt,
    };
  } catch {
    return null;
  }
}

async function searchApplePodcasts(query: string): Promise<PodcastSearchResult[]> {
  const cached = getCachedSearchResults(query);
  if (cached) {
    return cached;
  }

  await waitForAppleSearchSlot();

  const url = new URL(APPLE_SEARCH_URL);
  url.searchParams.set("term", query);
  url.searchParams.set("entity", "podcast");
  url.searchParams.set("limit", String(DEFAULT_SEARCH_LIMIT));
  url.searchParams.set("country", "us");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "DigestDesk/1.0",
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    throw new Error(`Apple Search returned ${response.status}`);
  }

  const json = await response.json() as { results?: ApplePodcastItem[] };
  const candidates = (json.results || []).slice(0, DEFAULT_SEARCH_LIMIT).map((item) => ({
    title: pickText(item.collectionName),
    authorName: pickText(item.artistName),
    description: "",
    logoUrl: pickText(item.artworkUrl600) || pickText(item.artworkUrl100),
    feedUrl: pickText(item.feedUrl),
    siteUrl: pickText(item.collectionViewUrl),
    latestPublishedAt: toIsoDate(item.releaseDate),
  }));

  const verified = await Promise.all(candidates.map((candidate) => verifyPodcastFeed(candidate)));
  const results = verified.filter((item): item is PodcastSearchResult => Boolean(item));
  setCachedSearchResults(query, results);
  return results;
}

export async function searchPodcasts(query: string): Promise<PodcastSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    return await searchApplePodcasts(trimmed);
  } catch (error) {
    console.warn(
      "[podcast/search] Apple search failed:",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}
