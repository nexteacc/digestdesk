import RssParser from "rss-parser";
import TurndownService from "turndown";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import pLimit from "p-limit";
import { getDb } from "../db/index.js";
import { feeds, articles } from "../db/schema.js";

const rssParser = new RssParser({
  timeout: 15000,
  headers: {
    "User-Agent": "DigestDesk/1.0 (RSS Reader)",
  },
});

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

const jinaLimit = pLimit(2);
const JINA_READER_BASE = "https://r.jina.ai/";
const MIN_CONTENT_LENGTH = 500;

let _syncPromise: Promise<void> | null = null;

export async function syncAllFeeds(): Promise<void> {
  if (_syncPromise) {
    console.log("[rss] A sync job is already in progress, sharing existing promise...");
    return _syncPromise;
  }

  _syncPromise = (async () => {
    const db = getDb();
    const allFeeds = db.select().from(feeds).all();

    console.log(`[rss] Starting sync job for ${allFeeds.length} feeds...`);

    try {
      for (const feed of allFeeds) {
        try {
          await syncFeed(feed.id);
        } catch (err) {
          console.error(`[rss] Error syncing ${feed.name}:`, err);
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    } finally {
      _syncPromise = null;
      console.log("[rss] All feeds sync complete.");
    }
  })();

  return _syncPromise;
}

async function fetchWithRetry(url: string, options: RequestInit, retries = 2, backoff = 1000): Promise<Response> {
  try {
    const response = await fetch(url, options);
    if ([429, 502, 503, 504].includes(response.status) && retries > 0) {
      console.log(`[rss] Server returned ${response.status}, retrying in ${backoff}ms...`);
      await new Promise(r => setTimeout(r, backoff));
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    return response;
  } catch (err) {
    if (retries > 0) {
      console.log(`[rss] Fetch failed, retrying in ${backoff}ms...`, err);
      await new Promise(r => setTimeout(r, backoff));
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    throw err;
  }
}

export async function fetchMarkdown(articleUrl: string): Promise<string | null> {
  return jinaLimit(async () => {
    try {
      const response = await fetchWithRetry(`${JINA_READER_BASE}${articleUrl}`, {
        headers: {
          Accept: "text/markdown",
          "User-Agent": "DigestDesk/1.0",
        },
        signal: AbortSignal.timeout(20000),
      });

      if (!response.ok) {
        console.warn(`[rss] Jina Reader returned ${response.status} for ${articleUrl}`);
        return null;
      }

      const markdown = await response.text();

      const contentStart = markdown.indexOf("Markdown Content:");
      const content = contentStart !== -1
        ? markdown.slice(contentStart + "Markdown Content:".length).trim()
        : markdown;

      if (content.length < MIN_CONTENT_LENGTH) {
        console.warn(`[rss] Jina content too short (${content.length} chars) for ${articleUrl}`);
        return null;
      }

      return content;
    } catch (err) {
      console.warn(`[rss] Jina Reader failed for ${articleUrl}:`, err);
      return null;
    }
  });
}

function htmlToMarkdown(html: string): string {
  if (!html) return "";
  return turndown.turndown(html);
}

export async function syncFeed(feedId: string): Promise<number> {
  const db = getDb();
  const feed = db.select().from(feeds).where(eq(feeds.id, feedId)).get();
  if (!feed) {
    console.warn(`[rss] Feed ${feedId} not found`);
    return 0;
  }

  console.log(`[rss] Syncing: ${feed.name} (${feed.feedUrl})`);

  let parsed;
  try {
    parsed = await rssParser.parseURL(feed.feedUrl);
  } catch (err) {
    console.error(`[rss] Failed to fetch ${feed.feedUrl}:`, err);
    return 0;
  }

  const now = new Date().toISOString();
  let newCount = 0;

  for (const item of parsed.items || []) {
    const articleUrl = item.link || "";
    const guid = item.guid || articleUrl;

    if (!articleUrl) continue;

    const existing = db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.url, articleUrl))
      .get();

    if (existing) continue;

    let contentMarkdown = await fetchMarkdown(articleUrl);

    if (!contentMarkdown) {
      const contentHtml = item["content:encoded"] || item.content || "";
      contentMarkdown = contentHtml ? htmlToMarkdown(contentHtml) : "";
    }

    const article = {
      id: nanoid(),
      feedId: feed.id,
      title: item.title || "无标题",
      author: item.creator || item["dc:creator"] || feed.authorName || null,
      url: articleUrl,
      guid,
      publishedAt: item.isoDate || item.pubDate || now,
      contentText: contentMarkdown || null,
      coverImageUrl: item.enclosure?.url || null,
      fetchedAt: now,
    };

    db.insert(articles).values(article).onConflictDoNothing().run();
    newCount++;
  }

  db.update(feeds).set({ lastFetchedAt: now }).where(eq(feeds.id, feedId)).run();

  console.log(`[rss] ${feed.name}: ${newCount} new articles`);
  return newCount;
}
