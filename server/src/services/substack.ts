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
  console.log(`[substack/reads] Fetching public reads for @${username} from ${pageUrl}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(pageUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch (err) {
    console.error(
      `[substack/reads] Network request failed for @${username}:`,
      err instanceof Error ? err.message : err,
    );
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  console.log(
    `[substack/reads] Response for @${username}: status=${response.status} ok=${response.ok}`,
  );

  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "找不到该用户，请检查用户名"
        : `请求失败 (${response.status})`,
    );
  }

  const html = await response.text();
  console.log(`[substack/reads] HTML size for @${username}: ${html.length} chars`);

  const getString = (value: unknown): string =>
    typeof value === "string" ? value : "";

  const getObj = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};

  const decodeHtml = (value: string): string =>
    value
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");

  const normalizePublicationUrl = (rawUrl: string): string => {
    const url = rawUrl.trim();
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith("//")) return `https:${url}`;
    if (url.startsWith("/")) return `https://substack.com${url}`;
    return `https://${url}`;
  };

  function parseFromPreloads(): SubstackSearchResult[] {
    const match = html.match(
      /window\._preloads\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/,
    );
    if (!match) {
      console.warn(`[substack/reads] @${username}: window._preloads not found`);
      return [];
    }

    let preloads: Record<string, unknown>;
    try {
      const jsonString = JSON.parse(match[1]) as string;
      preloads = JSON.parse(jsonString) as Record<string, unknown>;
    } catch {
      console.warn(`[substack/reads] @${username}: window._preloads JSON parse failed`);
      return [];
    }

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

    console.log(
      `[substack/reads] @${username}: preloads parser found ${publications.length} raw publications`,
    );

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

  function parseFromHtml(): SubstackSearchResult[] {
    const publications = new Map<string, SubstackSearchResult>();
    const blockRegex = /<a\b[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gsi;

    for (const match of html.matchAll(blockRegex)) {
      const href = decodeHtml(match[1] || "");
      const innerHtml = match[2] || "";
      const url = normalizePublicationUrl(href);

      if (
        !url ||
        /\/@(?![^/]+$)/i.test(href) ||
        /\/(p|post|podcast|archive|about|comments|subscribe|account|api)\b/i.test(href) ||
        /substack\.com\/@(nexteacc|[^/]+)(?:\/reads)?$/i.test(url)
      ) {
        continue;
      }

      const titleMatch = innerHtml.match(/<h3\b[^>]*>(.*?)<\/h3>/i)
        || innerHtml.match(/<span\b[^>]*>(.*?)<\/span>/i);
      const descMatch = innerHtml.match(/<p\b[^>]*>(.*?)<\/p>/i);
      const imgMatch = innerHtml.match(/<img\b[^>]*src="([^"]+)"/i);

      const stripTags = (value: string): string =>
        decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

      const name = titleMatch ? stripTags(titleMatch[1]) : "";
      const description = descMatch ? stripTags(descMatch[1]) : "";
      const logoUrl = imgMatch ? decodeHtml(imgMatch[1]) : "";

      if (!name) {
        continue;
      }
      if (!/substack\.com|https?:\/\/[^/\s]+\.[^/\s]+/i.test(url)) {
        continue;
      }

      if (!publications.has(url)) {
        publications.set(url, {
          name,
          logoUrl,
          description,
          url,
          authorName: "",
        });
      }
    }

    console.log(
      `[substack/reads] @${username}: html parser found ${publications.size} publications`,
    );
    return Array.from(publications.values());
  }

  const fromPreloads = parseFromPreloads();
  if (fromPreloads.length > 0) {
    console.log(
      `[substack/reads] @${username}: using preloads parser with ${fromPreloads.length} results`,
    );
    return fromPreloads;
  }

  const fromHtml = parseFromHtml();
  if (fromHtml.length > 0) {
    console.warn(
      `[substack/reads] @${username}: falling back to HTML parser with ${fromHtml.length} results`,
    );
    return fromHtml;
  }

  console.error(
    `[substack/reads] @${username}: no publications found after all parsing strategies`,
  );
  throw new Error("无法解析订阅数据，该用户可能没有公开订阅列表");
}
