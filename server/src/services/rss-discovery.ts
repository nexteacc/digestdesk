import RssParser from "rss-parser";
import type { DiscoveredFeed } from "../../../shared/types.js";

const rssParser = new RssParser({
  timeout: 10000,
  headers: {
    "User-Agent": "DigestDesk/1.0 (RSS Discovery)",
  },
});

type ParsedFeed = {
  title?: string;
  description?: string;
  image?: { url?: string };
  link?: string;
  items?: Array<{ creator?: string; author?: string }>;
};

type HomepageMetadata = {
  ogImageUrl: string;
  faviconUrl: string;
};

export async function discoverFeed(url: string): Promise<DiscoveredFeed> {
  let targetUrl = url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `https://${targetUrl}`;
  }

  // 1. 尝试直接解析 (可能已经是 feed URL)
  try {
    const feed = await rssParser.parseURL(targetUrl);
    return await mapFeedToDiscovered(feed, targetUrl, targetUrl);
  } catch {
    // console.log(`[discovery] Direct parse failed for ${targetUrl}, trying HTML discovery...`);
  }

  // 2. 尝试从 HTML <link> 标签中探测
  try {
    const response = await fetch(targetUrl, {
      headers: { "User-Agent": "DigestDesk/1.0" },
    });
    if (response.ok) {
      const html = await response.text();
      const feedUrl = extractFeedUrlFromHtml(html, targetUrl);
      if (feedUrl) {
        const feed = await rssParser.parseURL(feedUrl);
        return await mapFeedToDiscovered(feed, feedUrl, targetUrl);
      }
    }
  } catch {
    // console.log(`[discovery] HTML discovery failed for ${targetUrl}`);
  }

  // 3. 尝试常见路径
  const commonPaths = ["/feed", "/rss", "/rss.xml", "/feed.xml", "/index.xml", "/atom.xml"];
  const baseUrl = new URL(targetUrl).origin;

  for (const path of commonPaths) {
    const testUrl = `${baseUrl}${path}`;
    try {
      const feed = await rssParser.parseURL(testUrl);
      return await mapFeedToDiscovered(feed, testUrl, baseUrl);
    } catch {
      // ignore
    }
  }

  throw new Error("未能找到有效的 RSS 订阅源，请检查 URL 是否正确。");
}

async function fetchHomepageMetadata(siteUrl: string): Promise<HomepageMetadata> {
  try {
    const response = await fetch(siteUrl, {
      headers: { "User-Agent": "DigestDesk/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { ogImageUrl: "", faviconUrl: "" };
    }

    const html = await response.text();
    return {
      ogImageUrl: extractOgImageUrl(html, siteUrl),
      faviconUrl: extractFaviconUrl(html, siteUrl),
    };
  } catch {
    return { ogImageUrl: "", faviconUrl: "" };
  }
}

function extractFeedUrlFromHtml(html: string, baseUrl: string): string | null {
  // 匹配 <link rel="alternate" type="application/rss+xml" href="..."> 或 atom+xml
  const regex = /<link[^>]+rel=["']alternate["'][^>]+type=["']application\/(rss|atom)\+xml["'][^>]+href=["']([^"']+)["']/i;
  const match = html.match(regex);
  
  if (match && match[2]) {
    const href = match[2];
    if (href.startsWith("/")) {
      const url = new URL(baseUrl);
      return `${url.origin}${href}`;
    }
    if (!/^https?:\/\//i.test(href)) {
      return new URL(href, baseUrl).href;
    }
    return href;
  }
  return null;
}

function absolutizeUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return "";
  }
}

function extractMetaContent(html: string, attribute: string, value: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+${attribute}=["']${value}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attribute}=["']${value}["']`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return "";
}

function extractOgImageUrl(html: string, baseUrl: string): string {
  const raw = extractMetaContent(html, "property", "og:image");
  return raw ? absolutizeUrl(raw, baseUrl) : "";
}

function extractFaviconUrl(html: string, baseUrl: string): string {
  const patterns = [
    /<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*icon[^"']*["']/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return absolutizeUrl(match[1], baseUrl);
    }
  }

  return absolutizeUrl("/favicon.ico", baseUrl);
}

async function mapFeedToDiscovered(feed: ParsedFeed, feedUrl: string, siteUrl: string): Promise<DiscoveredFeed> {
  const homepageUrl = feed.link || siteUrl;
  const homepageMetadata = await fetchHomepageMetadata(homepageUrl);
  const logoUrl = feed.image?.url || homepageMetadata.ogImageUrl || homepageMetadata.faviconUrl;

  return {
    feedUrl,
    siteUrl,
    title: feed.title || new URL(siteUrl).hostname,
    description: feed.description || "",
    logoUrl,
    authorName: feed.items?.[0]?.creator || feed.items?.[0]?.author || "",
  };
}
