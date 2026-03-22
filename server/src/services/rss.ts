import RssParser from "rss-parser";
import { nanoid } from "nanoid";
import { eq, isNull, and } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { feeds, articles, subscriptions } from "../db/schema.js";
import { getSourceAdapter } from "../sources/factory.js";
import type { SourceType } from "../sources/types.js";

const rssParser = new RssParser({
  timeout: 15000,
  headers: {
    "User-Agent": "DigestDesk/1.0 (RSS Reader)",
  },
  customFields: {
    item: [["media:group", "mediaGroup"]],
  },
});

let _syncPromise: Promise<void> | null = null;

function normalizeFeedUrl(url: string): string {
  return url
    .trim()
    .replace(/^`+|`+$/g, "")
    .replace(/[)\]:;.,]+$/g, "");
}

function pickString(value: unknown): string | null {
  if (typeof value === "string") {
    const v = value.trim();
    return v || null;
  }
  return null;
}

export async function syncAllFeeds(): Promise<void> {
  if (_syncPromise) {
    console.log("[rss] A sync job is already in progress, sharing existing promise...");
    return _syncPromise;
  }

  _syncPromise = (async () => {
    const db = getDb();
    const allFeeds = await db
      .selectDistinct({ id: feeds.id, name: feeds.name })
      .from(subscriptions)
      .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
      .where(isNull(subscriptions.endedAt));

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

export async function syncUserFeeds(userId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ feedId: subscriptions.feedId, feedName: feeds.name })
    .from(subscriptions)
    .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
    .where(and(eq(subscriptions.userId, userId), isNull(subscriptions.endedAt)));

  console.log(`[rss] Starting sync job for user ${userId} with ${rows.length} feeds...`);

  for (const row of rows) {
    try {
      await syncFeed(row.feedId);
    } catch (err) {
      console.error(`[rss] Error syncing ${row.feedName} for user ${userId}:`, err);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export async function syncFeed(feedId: string): Promise<number> {
  const db = getDb();
  const [feed] = await db.select().from(feeds).where(eq(feeds.id, feedId));
  if (!feed) {
    console.warn(`[rss] Feed ${feedId} not found`);
    return 0;
  }

  const effectiveFeedUrl = normalizeFeedUrl(feed.feedUrl);
  console.log(`[rss] Syncing: ${feed.name} (${effectiveFeedUrl})`);

  let parsed;
  try {
    parsed = await rssParser.parseURL(effectiveFeedUrl);
  } catch (err) {
    console.error(`[rss] Failed to fetch ${effectiveFeedUrl}:`, err);
    return 0;
  }

  const now = new Date().toISOString();
  let newCount = 0;

  for (const item of parsed.items || []) {
    const itemRecord = item as unknown as Record<string, unknown>;
    const articleUrl = item.link || "";
    const guid = item.guid || articleUrl;

    if (!articleUrl) continue;

    const [existing] = await db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.url, articleUrl));

    if (existing) continue;

    const adapter = getSourceAdapter(feed.sourceType as SourceType);
    const { contentMarkdown, coverImageUrl } =
      await adapter.extractSyncItemContent(item as unknown as Record<string, unknown>, articleUrl);

    const article = {
      id: nanoid(),
      feedId: feed.id,
      title: item.title || "无标题",
      author: pickString(item.creator) || pickString(itemRecord["dc:creator"]) || feed.authorName || null,
      url: articleUrl,
      guid,
      publishedAt: item.isoDate || item.pubDate || now,
      contentText: contentMarkdown || null,
      coverImageUrl,
      fetchedAt: now,
    };

    await db.insert(articles).values(article).onConflictDoNothing();
    newCount++;
  }

  await db.update(feeds).set({ lastFetchedAt: now }).where(eq(feeds.id, feedId));

  console.log(`[rss] ${feed.name}: ${newCount} new articles`);
  return newCount;
}
