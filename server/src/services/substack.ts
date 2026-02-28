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
  const proxyBase = process.env.CF_SEARCH_PROXY_URL;
  const proxyToken = process.env.CF_SEARCH_PROXY_TOKEN;

  const url = proxyBase
    ? `${proxyBase}/search?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`
    : `https://substack.com/api/v1/publication/search?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`;

  const headers: Record<string, string> = proxyBase
    ? {
        Accept: "application/json",
        ...(proxyToken ? { Authorization: `Bearer ${proxyToken}` } : {}),
      }
    : {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://substack.com/search",
      };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  const response = await fetch(url, {
    signal: controller.signal,
    headers,
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

export async function fetchSubstackReads(
  username: string,
): Promise<SubstackSearchResult[]> {
  const pageUrl = `https://substack.com/@${encodeURIComponent(username)}/reads`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const response = await fetch(pageUrl, {
    signal: controller.signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html",
      "Accept-Language": "en-US,en;q=0.9",
    },
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "找不到该用户，请检查用户名"
        : `请求失败 (${response.status})`,
    );
  }

  const html = await response.text();

  const match = html.match(
    /window\._preloads\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/,
  );
  if (!match) {
    throw new Error("无法解析订阅数据，该用户可能没有公开订阅列表");
  }

  let preloads: Record<string, unknown>;
  try {
    const jsonString = JSON.parse(match[1]) as string;
    preloads = JSON.parse(jsonString) as Record<string, unknown>;
  } catch {
    throw new Error("订阅数据格式异常");
  }

  const getString = (value: unknown): string =>
    typeof value === "string" ? value : "";

  const getObj = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};

  let publications: unknown[] = [];

  const profile = getObj(preloads.profile);

  if (Array.isArray(profile.subscriptions)) {
    publications = profile.subscriptions
      .map((sub) => getObj(sub).publication)
      .filter(Boolean);
  }

  if (publications.length === 0 && Array.isArray(preloads.subscriptions)) {
    publications = preloads.subscriptions
      .map((sub) => getObj(sub).publication)
      .filter(Boolean);
  }

  if (publications.length === 0) {
    throw new Error("该用户没有公开的订阅列表");
  }

  return publications.map((raw) => {
    const pub = getObj(raw);
    const name = getString(pub.name);
    const logoUrl = getString(pub.logo_url);
    const description = getString(pub.hero_text) || getString(pub.description);
    const subdomain = getString(pub.subdomain);
    const customDomain = getString(pub.custom_domain);

    const author = getObj(pub.author);
    const authorName = getString(author.name) || getString(pub.author_name);

    const url = customDomain
      ? `https://${customDomain}`
      : subdomain
        ? `https://${subdomain}.substack.com`
        : "";

    return { name, logoUrl, description, url, authorName };
  }).filter((item) => item.url && item.name);
}
