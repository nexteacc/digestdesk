import RssParser from "rss-parser";
import type { SubstackSearchResult } from "../../../shared/types.js";

const rssParser = new RssParser({
  timeout: 10000,
  headers: {
    "User-Agent": "DigestDesk/1.0 (RSS Reader)",
  },
});

export interface SubstackInfo {
  name: string;
  description: string;
  logoUrl: string;
  authorName: string;
  feedUrl: string;
  recentPosts: Array<{
    title: string;
    url: string;
    publishedAt: string;
    author?: string;
  }>;
}

export async function getSubstackInfo(publicationUrl: string): Promise<SubstackInfo> {
  const feedUrl = publicationUrl.replace(/\/$/, "") + "/feed";

  const feed = await rssParser.parseURL(feedUrl);

  const name = feed.title || "";
  const description = feed.description || "";
  const logoUrl = feed.image?.url || "";

  // 从第一篇文章提取作者名
  const firstItem = feed.items?.[0];
  const authorName = firstItem?.creator || firstItem?.["dc:creator"] || "";

  const recentPosts = (feed.items || []).slice(0, 5).map((item) => ({
    title: item.title || "",
    url: item.link || "",
    publishedAt: item.isoDate || item.pubDate || "",
    author: item.creator || item["dc:creator"] || undefined,
  }));

  return { name, description, logoUrl, authorName, feedUrl, recentPosts };
}

export async function searchSubstack(
  query: string,
  page = 0,
  limit = 10,
): Promise<SubstackSearchResult[]> {
  const url = `https://substack.com/api/v1/publication/search?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://substack.com/search",
    },
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Substack search API returned ${response.status}`);
  }

  const json = (await response.json()) as unknown;

  const ensureArray = (value: unknown): unknown[] => {
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value === "object" && value !== null && "results" in value) {
      const results = (value as { results?: unknown }).results;
      return Array.isArray(results) ? results : [];
    }
    return [];
  };

  const data = ensureArray(json);

  const getString = (value: unknown): string =>
    typeof value === "string" ? value : "";

  return data.map((rawItem) => {
    const item =
      typeof rawItem === "object" && rawItem !== null
        ? (rawItem as Record<string, unknown>)
        : {};

    const name = getString(item.name);
    const logoUrl =
      getString(item.logo_url) || getString(item.author_photo_url);
    const description = getString(item.description);
    const baseUrl = getString(item.base_url);
    const customDomain = getString(item.custom_domain_optional);
    const subdomain = getString(item.subdomain);
    const authorName = getString(item.author_name) || getString(item.byline);

    const url =
      baseUrl || customDomain || (subdomain ? `https://${subdomain}.substack.com` : "");

    return {
      name,
      logoUrl,
      description,
      url,
      authorName,
    };
  });
}
