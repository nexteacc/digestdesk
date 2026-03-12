import RssParser from "rss-parser";
import type { DiscoveredFeed } from "../../../shared/types.js";

const rssParser = new RssParser({
  timeout: 10000,
  headers: {
    "User-Agent": "DigestDesk/1.0 (RSS Discovery)",
  },
});

export async function discoverFeed(url: string): Promise<DiscoveredFeed> {
  let targetUrl = url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `https://${targetUrl}`;
  }

  // 1. 尝试直接解析 (可能已经是 feed URL)
  try {
    const feed = await rssParser.parseURL(targetUrl);
    return mapFeedToDiscovered(feed, targetUrl, targetUrl);
  } catch (err) {
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
        return mapFeedToDiscovered(feed, feedUrl, targetUrl);
      }
    }
  } catch (err) {
    // console.log(`[discovery] HTML discovery failed for ${targetUrl}`);
  }

  // 3. 尝试常见路径
  const commonPaths = ["/feed", "/rss", "/rss.xml", "/feed.xml", "/index.xml", "/atom.xml"];
  const baseUrl = new URL(targetUrl).origin;

  for (const path of commonPaths) {
    const testUrl = `${baseUrl}${path}`;
    try {
      const feed = await rssParser.parseURL(testUrl);
      return mapFeedToDiscovered(feed, testUrl, baseUrl);
    } catch (err) {
      // ignore
    }
  }

  throw new Error("未能找到有效的 RSS 订阅源，请检查 URL 是否正确。");
}

function extractFeedUrlFromHtml(html: string, baseUrl: string): string | null {
  // 匹配 <link rel="alternate" type="application/rss+xml" href="..."> 或 atom+xml
  const regex = /<link[^>]+rel=["']alternate["'][^>]+type=["']application\/(rss|atom)\+xml["'][^>]+href=["']([^"']+)["']/i;
  const match = html.match(regex);
  
  if (match && match[2]) {
    let href = match[2];
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

function mapFeedToDiscovered(feed: any, feedUrl: string, siteUrl: string): DiscoveredFeed {
  return {
    feedUrl,
    siteUrl,
    title: feed.title || new URL(siteUrl).hostname,
    description: feed.description || "",
    logoUrl: feed.image?.url || "",
    authorName: feed.items?.[0]?.creator || feed.items?.[0]?.author || "",
  };
}
