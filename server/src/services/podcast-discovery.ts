import RssParser from "rss-parser";
import pLimit from "p-limit";
import type { PodcastSearchResult } from "../../../shared/types.js";
import { safeParseRssUrl } from "../sources/safe-fetch.js";
import { htmlToMarkdown } from "./content-extractor.js";

const APPLE_SEARCH_URL = "https://itunes.apple.com/search";
const DEFAULT_SEARCH_LIMIT = 6;
const MAX_APPLE_CANDIDATES_TO_VERIFY = 18;
const APPLE_VERIFY_CONCURRENCY = 4;
const AUTO_APPLE_COUNTRIES = ["us", "cn", "tw", "hk", "sg", "gb", "ca", "au"];
const MAX_APPLE_COUNTRIES = 8;
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

type PodcastCandidate = {
  title: string;
  authorName: string;
  description: string;
  logoUrl: string;
  feedUrl: string;
  siteUrl: string;
  latestPublishedAt?: string;
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

function normalizeFeedUrlForDedupe(feedUrl: string): string {
  return feedUrl.trim().toLowerCase().replace(/\/+$/, "");
}

function buildSearchCacheKey(query: string, countries: string[]): string {
  return `${normalizeSearchQuery(query)}|${countries.join(",")}`;
}

export function parseApplePodcastCountries(rawValue?: string): string[] {
  const raw = rawValue?.trim();
  if (!raw) return AUTO_APPLE_COUNTRIES;

  const countries: string[] = [];
  for (const token of raw.split(",")) {
    const country = token.trim().toLowerCase();
    if (!country) continue;
    if (country === "auto" || country === "global") {
      countries.push(...AUTO_APPLE_COUNTRIES);
      continue;
    }
    if (/^[a-z]{2}$/.test(country)) {
      countries.push(country);
    }
  }

  const unique = Array.from(new Set(countries)).slice(0, MAX_APPLE_COUNTRIES);
  return unique.length > 0 ? unique : AUTO_APPLE_COUNTRIES;
}

function getApplePodcastCountries(): string[] {
  return parseApplePodcastCountries(process.env.PODCAST_APPLE_COUNTRIES ?? process.env.PODCAST_APPLE_COUNTRY);
}

function getCachedSearchResults(query: string, countries: string[]): PodcastSearchResult[] | null {
  const key = buildSearchCacheKey(query, countries);
  const cached = searchCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    searchCache.delete(key);
    return null;
  }
  return cached.results;
}

function setCachedSearchResults(query: string, countries: string[], results: PodcastSearchResult[]) {
  const key = buildSearchCacheKey(query, countries);
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

function dedupeCandidatesByFeedUrl(candidates: PodcastCandidate[]): PodcastCandidate[] {
  const seen = new Set<string>();
  const deduped: PodcastCandidate[] = [];
  for (const candidate of candidates) {
    const feedUrl = candidate.feedUrl.trim();
    if (!feedUrl) continue;
    const key = normalizeFeedUrlForDedupe(feedUrl);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
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

async function fetchApplePodcastCandidates(query: string, country: string): Promise<PodcastCandidate[]> {
  const url = new URL(APPLE_SEARCH_URL);
  url.searchParams.set("term", query);
  url.searchParams.set("entity", "podcast");
  url.searchParams.set("limit", String(DEFAULT_SEARCH_LIMIT));
  url.searchParams.set("country", country);

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
  return (json.results || []).slice(0, DEFAULT_SEARCH_LIMIT).map((item) => ({
    title: pickText(item.collectionName),
    authorName: pickText(item.artistName),
    description: "",
    logoUrl: pickText(item.artworkUrl600) || pickText(item.artworkUrl100),
    feedUrl: pickText(item.feedUrl),
    siteUrl: pickText(item.collectionViewUrl),
    latestPublishedAt: toIsoDate(item.releaseDate),
  }));
}

async function searchApplePodcasts(query: string): Promise<PodcastSearchResult[]> {
  const countries = getApplePodcastCountries();
  const cached = getCachedSearchResults(query, countries);
  if (cached) {
    return cached;
  }

  await waitForAppleSearchSlot();

  const countryLimit = pLimit(Math.min(4, countries.length));
  const countryResults = await Promise.allSettled(
    countries.map((country) => countryLimit(() => fetchApplePodcastCandidates(query, country))),
  );

  const candidates: PodcastCandidate[] = [];
  for (let i = 0; i < countryResults.length; i += 1) {
    const result = countryResults[i];
    const country = countries[i];
    if (result.status === "fulfilled") {
      candidates.push(...result.value);
      continue;
    }
    console.warn(
      `[podcast/search] Apple country search failed country=${country}:`,
      result.reason instanceof Error ? result.reason.message : result.reason,
    );
  }

  const deduped = dedupeCandidatesByFeedUrl(candidates).slice(0, MAX_APPLE_CANDIDATES_TO_VERIFY);
  const verifyLimit = pLimit(APPLE_VERIFY_CONCURRENCY);
  const verified = await Promise.all(deduped.map((candidate) => verifyLimit(() => verifyPodcastFeed(candidate))));
  const results = verified.filter((item): item is PodcastSearchResult => Boolean(item));

  console.log(
    `[podcast/search] Apple search complete countries=${countries.join(",")} rawCandidates=${candidates.length} deduped=${deduped.length} verified=${results.length}`,
  );

  setCachedSearchResults(query, countries, results);
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
