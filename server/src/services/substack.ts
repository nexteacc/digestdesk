import RssParser from "rss-parser";
import type { SubstackSearchResult } from "../../../shared/types.js";
import { safeParseRssUrl } from "../sources/safe-fetch.js";

const rssParser = new RssParser({
  timeout: 10000,
  headers: {
    "User-Agent": "DigestDesk/1.0 (RSS Reader)",
  },
});
const RSS_READER_HEADERS = { "User-Agent": "DigestDesk/1.0 (RSS Reader)" };

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

  const feed = await safeParseRssUrl(rssParser, feedUrl, { headers: RSS_READER_HEADERS, timeoutMs: 10000 });

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
  const getString = (value: unknown): string =>
    typeof value === "string" ? value : "";

  const getObj = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};

  function mapPublicationRecords(publications: unknown[]): SubstackSearchResult[] {
    return publications.map((raw) => {
      const publicationContainer = getObj(raw);
      const pub = getObj(publicationContainer.publication);
      const source = Object.keys(pub).length > 0 ? pub : publicationContainer;
      const name = getString(source.name);
      const logoUrl = getString(source.logo_url);
      const description = getString(source.hero_text) || getString(source.description);
      const subdomain = getString(source.subdomain);
      const customDomain = getString(source.custom_domain);

      const author = getObj(source.author);
      const authorName = getString(author.name) || getString(source.author_name);

      const url = customDomain
        ? `https://${customDomain}`
        : subdomain
          ? `https://${subdomain}.substack.com`
          : "";

      return { name, logoUrl, description, url, authorName };
    }).filter((item) => item.url && item.name);
  }

  function parseFromPreloads(html: string, sourceLabel: string): SubstackSearchResult[] {
    const jsonTag = html.match(
      /<script\b(?=[^>]*\bid\s*=\s*["']preloads-json["'])[^>]*>([\s\S]*?)<\/script>/i,
    );
    const legacy = html.match(
      /window\._preloads\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/,
    );
    if (!jsonTag && !legacy) {
      console.warn(`[substack/reads] @${username} ${sourceLabel}: preload data not found`);
      return [];
    }

    let preloads: Record<string, unknown>;
    try {
      preloads = getObj(jsonTag ? JSON.parse(jsonTag[1]) : JSON.parse(JSON.parse(legacy![1])));
    } catch {
      console.warn(`[substack/reads] @${username} ${sourceLabel}: preload JSON parse failed`);
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

    if (publications.length === 0 && Array.isArray(profile.visibleSubscriptions)) {
      publications = profile.visibleSubscriptions;
    }

    if (profile.subscriptionsTruncated === true) {
      throw new Error("Substack returned an incomplete public subscription list. Import stopped to avoid missing subscriptions.");
    }

    console.log(
      `[substack/reads] @${username} ${sourceLabel}: preloads parser found ${publications.length} raw publications`,
    );

    return Array.from(new Map(mapPublicationRecords(publications).map((item) => [item.url, item])).values());
  }

  async function fetchHtml(pageUrl: string, sourceLabel: string) {
    console.log(`[substack/reads] Fetching ${sourceLabel} for @${username} from ${pageUrl}`);

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
        `[substack/reads] Network request failed for @${username} ${sourceLabel}:`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    console.log(
      `[substack/reads] Response for @${username} ${sourceLabel}: status=${response.status} ok=${response.ok}`,
    );

    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? "User not found. Check the username."
          : `Request failed (${response.status})`,
      );
    }

    const html = await response.text();
    console.log(`[substack/reads] HTML size for @${username} ${sourceLabel}: ${html.length} chars`);
    return html;
  }

  for (const [pageUrl, sourceLabel] of [
    [`https://substack.com/@${encodeURIComponent(username)}`, "profile-page"],
    [`https://substack.com/@${encodeURIComponent(username)}/reads`, "reads-page"],
  ]) {
    const html = await fetchHtml(pageUrl, sourceLabel);
    const results = parseFromPreloads(html, sourceLabel);
    if (results.length > 0) return results;
  }

  throw new Error("No public subscriptions found. Substack may have changed its page format or hidden this user's subscriptions.");
}
