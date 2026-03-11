import RssParser from "rss-parser";
import type { DiscoveredFeed } from "../../../shared/types.js";

const rssParser = new RssParser({
  timeout: 15000,
  headers: {
    "User-Agent": "DigestDesk/1.0 (RSS Reader)",
  },
});

const COMMON_FEED_PATHS = ["/feed", "/rss", "/atom.xml", "/index.xml", "/rss.xml", "/feed.xml"];

/**
 * Try to parse a URL as an RSS/Atom feed directly.
 * Returns the parsed feed or null.
 */
async function tryParseFeed(url: string): Promise<RssParser.Output<Record<string, unknown>> | null> {
  try {
    return await rssParser.parseURL(url);
  } catch {
    return null;
  }
}

/**
 * Fetch HTML from a URL and extract RSS feed links from <link> tags.
 */
async function discoverFromHtml(siteUrl: string): Promise<string[]> {
  try {
    const response = await fetch(siteUrl, {
      headers: {
        "User-Agent": "DigestDesk/1.0 (RSS Reader)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return [];

    const html = await response.text();

    const feedUrls: string[] = [];
    const linkRegex = /<link[^>]+type\s*=\s*["']application\/(rss|atom)\+xml["'][^>]*>/gi;
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(html)) !== null) {
      const hrefMatch = match[0].match(/href\s*=\s*["']([^"']+)["']/i);
      if (hrefMatch?.[1]) {
        const href = hrefMatch[1];
        try {
          feedUrls.push(new URL(href, siteUrl).href);
        } catch {
          // invalid URL, skip
        }
      }
    }

    return feedUrls;
  } catch {
    return [];
  }
}

function extractMeta(feed: RssParser.Output<Record<string, unknown>>, feedUrl: string, siteUrl: string): DiscoveredFeed {
  const firstItem = feed.items?.[0];
  return {
    feedUrl,
    title: feed.title || "",
    description: feed.description || "",
    logoUrl: feed.image?.url || "",
    authorName: firstItem?.creator || (firstItem as Record<string, unknown>)?.["dc:creator"] as string || "",
    siteUrl,
  };
}

/**
 * Discover an RSS/Atom feed from a user-provided URL.
 *
 * Strategy (by priority):
 * 1. Try parsing the URL directly as a feed
 * 2. Fetch the HTML page and look for <link rel="alternate"> tags
 * 3. Try common feed paths (/feed, /rss, /atom.xml, etc.)
 */
export async function discoverFeed(url: string): Promise<DiscoveredFeed> {
  let normalized = url.trim();
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  // 1. Try direct parse
  const directFeed = await tryParseFeed(normalized);
  if (directFeed && directFeed.items && directFeed.items.length > 0) {
    const siteUrl = directFeed.link || new URL(normalized).origin;
    return extractMeta(directFeed, normalized, siteUrl);
  }

  // Derive site origin for subsequent attempts
  let siteUrl: string;
  try {
    siteUrl = new URL(normalized).origin;
  } catch {
    throw new Error("无效的 URL");
  }

  // 2. Try HTML <link> discovery
  const htmlFeedUrls = await discoverFromHtml(normalized);
  for (const candidateUrl of htmlFeedUrls) {
    const feed = await tryParseFeed(candidateUrl);
    if (feed && feed.items && feed.items.length > 0) {
      return extractMeta(feed, candidateUrl, siteUrl);
    }
  }

  // 3. Try common paths
  for (const path of COMMON_FEED_PATHS) {
    const candidateUrl = `${siteUrl}${path}`;
    const feed = await tryParseFeed(candidateUrl);
    if (feed && feed.items && feed.items.length > 0) {
      return extractMeta(feed, candidateUrl, siteUrl);
    }
  }

  throw new Error("未能找到 RSS/Atom feed，请确认该网站提供 RSS 订阅");
}
