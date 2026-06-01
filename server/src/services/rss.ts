import RssParser from "rss-parser";
import { nanoid } from "nanoid";
import { eq, isNull, and, gte } from "drizzle-orm";
import pLimit from "p-limit";
import { getDb } from "../db/index.js";
import { feeds, articles, subscriptions, users } from "../db/schema.js";
import { getSourceAdapter } from "../sources/factory.js";
import type { SourceType } from "../sources/types.js";
import { assertPublicUrl } from "../sources/url-guard.js";
import { safeParseRssUrl } from "../sources/safe-fetch.js";
import { getActiveUserSinceIso } from "./active-users.js";
import { enqueueArticleSummaryJobsForArticles } from "./article-summary-jobs.js";
import {
  buildYouTubeChannelFeedUrl,
  extractChannelIdFromYouTubeFeedUrl,
  fetchYouTubeDataApiFeedItems,
  isYouTubeLongFormFeedUrl,
} from "./youtube-discovery.js";

const rssParser = new RssParser({
  timeout: 15000,
  headers: {
    "User-Agent": "DigestDesk/1.0 (RSS Reader)",
  },
  customFields: {
    item: [
      ["media:group", "mediaGroup"],
      ["content:encoded", "contentEncoded"],
      ["itunes:summary", "itunesSummary"],
      ["itunes:image", "itunesImage"],
      ["media:content", "mediaContent"],
      ["media:thumbnail", "mediaThumbnail"],
    ],
  },
});
const RSS_READER_HEADERS = { "User-Agent": "DigestDesk/1.0 (RSS Reader)" };

let _syncPromise: Promise<void> | null = null;
const _feedSyncPromises = new Map<string, Promise<number>>();
const DEFAULT_RECENT_SYNC_WINDOW_MS = 10 * 60 * 1000;

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

function wasSyncedRecently(lastFetchedAt: string | null, freshnessWindowMs: number) {
  if (!lastFetchedAt) return false;
  const timestamp = Date.parse(lastFetchedAt);
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp < freshnessWindowMs;
}

function shouldEnqueueArticleSummaryJobs() {
  return process.env.ENABLE_ARTICLE_SUMMARY_JOBS === "true";
}

export async function syncAllFeeds(options?: { freshnessWindowMs?: number }): Promise<void> {
  if (_syncPromise) {
    console.log("[rss] A sync job is already in progress, sharing existing promise...");
    return _syncPromise;
  }

  _syncPromise = (async () => {
    const db = getDb();
    const freshnessWindowMs = options?.freshnessWindowMs ?? DEFAULT_RECENT_SYNC_WINDOW_MS;
    // Only sync feeds an active user still subscribes to; skip feeds kept alive
    // only by dormant accounts to avoid wasted fetches and AI summaries.
    const activeSince = getActiveUserSinceIso();
    const allFeeds = await db
      .selectDistinct({ id: feeds.id, name: feeds.name, lastFetchedAt: feeds.lastFetchedAt })
      .from(subscriptions)
      .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
      .innerJoin(users, eq(subscriptions.userId, users.id))
      .where(and(isNull(subscriptions.endedAt), gte(users.lastLoginAt, activeSince)));
    const feedsToSync = allFeeds.filter((feed) => !wasSyncedRecently(feed.lastFetchedAt, freshnessWindowMs));

    console.log(
      `[rss] Starting sync job for ${allFeeds.length} feeds freshnessWindowMs=${freshnessWindowMs} toSync=${feedsToSync.length} skippedRecent=${allFeeds.length - feedsToSync.length}`,
    );

    try {
      const syncLimit = pLimit(5);
      await Promise.all(
        feedsToSync.map(feed =>
          syncLimit(async () => {
            const feedStartedAt = Date.now();
            try {
              await syncFeed(feed.id);
            } catch (err) {
              console.error(`[rss] Error syncing ${feed.name}:`, err);
            }
            console.log(`[rss] Finished sync loop feed=${feed.id} name=${feed.name} durationMs=${Date.now() - feedStartedAt}`);
          })
        )
      );
    } finally {
      _syncPromise = null;
      console.log("[rss] All feeds sync complete.");
    }
  })();

  return _syncPromise;
}

export async function syncUserFeeds(
  userId: string,
  options?: { freshnessWindowMs?: number; executionId?: string },
): Promise<void> {
  const db = getDb();
  const freshnessWindowMs = options?.freshnessWindowMs ?? DEFAULT_RECENT_SYNC_WINDOW_MS;
  const trace = options?.executionId ? ` executionId=${options.executionId}` : "";
  const rows = await db
    .select({
      feedId: subscriptions.feedId,
      feedName: feeds.name,
      lastFetchedAt: feeds.lastFetchedAt,
    })
    .from(subscriptions)
    .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
    .where(and(eq(subscriptions.userId, userId), isNull(subscriptions.endedAt)));

  console.log(`[rss] Starting sync job${trace} user=${userId} feeds=${rows.length} freshnessWindowMs=${freshnessWindowMs}`);

  const syncLimit = pLimit(5);
  const rowsToSync = rows.filter(row => !wasSyncedRecently(row.lastFetchedAt, freshnessWindowMs));
  console.log(`[rss] User sync plan${trace} user=${userId} toSync=${rowsToSync.length} skippedRecent=${rows.length - rowsToSync.length}`);
  await Promise.all(
    rowsToSync
      .map(row =>
        syncLimit(async () => {
          const feedStartedAt = Date.now();
          try {
            const inserted = await syncFeed(row.feedId);
            console.log(
              `[rss] Finished user feed sync${trace} user=${userId} feed=${row.feedId} name=${row.feedName} inserted=${inserted} durationMs=${Date.now() - feedStartedAt}`,
            );
          } catch (err) {
            console.error(`[rss] Error syncing${trace} user=${userId} feed=${row.feedId} name=${row.feedName}:`, err);
          }
        })
      )
  );

  // Log skipped feeds
  const skipped = rows.filter(row => wasSyncedRecently(row.lastFetchedAt, freshnessWindowMs));
  for (const row of skipped) {
    console.log(
      `[rss] Skipping recent sync${trace} user=${userId} feed=${row.feedId} name=${row.feedName} lastFetchedAt=${row.lastFetchedAt}`,
    );
  }
}

export async function syncFeed(feedId: string): Promise<number> {
  const inFlight = _feedSyncPromises.get(feedId);
  if (inFlight) {
    console.log(`[rss] Sharing in-flight sync for feed ${feedId}`);
    return inFlight;
  }

  const task = syncFeedInternal(feedId);
  _feedSyncPromises.set(feedId, task);

  try {
    return await task;
  } finally {
    if (_feedSyncPromises.get(feedId) === task) {
      _feedSyncPromises.delete(feedId);
    }
  }
}

async function syncFeedInternal(feedId: string): Promise<number> {
  const startedAt = Date.now();
  const db = getDb();
  const [feed] = await db.select().from(feeds).where(eq(feeds.id, feedId));
  if (!feed) {
    console.warn(`[rss] Feed ${feedId} not found`);
    return 0;
  }

  const effectiveFeedUrl = normalizeFeedUrl(feed.feedUrl);
  console.log(`[rss] Syncing feedId=${feed.id} sourceType=${feed.sourceType} name=${feed.name} feedUrl=${effectiveFeedUrl}`);

  // Defense-in-depth: never fetch a feed URL that resolves to a private/internal address (SSRF guard).
  try {
    await assertPublicUrl(effectiveFeedUrl);
  } catch (err) {
    console.warn(
      `[rss] Blocked non-public feed url feedId=${feed.id} name=${feed.name} url=${effectiveFeedUrl}:`,
      err instanceof Error ? err.message : err,
    );
    return 0;
  }

  let parsed;
  let parsedFeedUrl = effectiveFeedUrl;
  let usedYouTubeDataApiFallback = false;
  try {
    parsed = await safeParseRssUrl(rssParser, effectiveFeedUrl, { headers: RSS_READER_HEADERS });
  } catch (err) {
    if (feed.sourceType !== "youtube") {
      console.error(`[rss] Failed to fetch ${effectiveFeedUrl}:`, err);
      return 0;
    }

    const channelId = extractChannelIdFromYouTubeFeedUrl(effectiveFeedUrl);
    const fallbackFeedUrl = channelId ? buildYouTubeChannelFeedUrl(channelId) : null;
    if (!fallbackFeedUrl || fallbackFeedUrl === effectiveFeedUrl) {
      console.error(`[rss] Failed to fetch ${effectiveFeedUrl}:`, err);
      return 0;
    }

    try {
      parsed = await safeParseRssUrl(rssParser, fallbackFeedUrl, { headers: RSS_READER_HEADERS });
      parsedFeedUrl = fallbackFeedUrl;
      console.warn(
        `[rss] Falling back to channel feed for ${feed.name}: primary=${effectiveFeedUrl} fallback=${fallbackFeedUrl}`,
      );
    } catch (fallbackErr) {
      if (!channelId) {
        console.error(`[rss] Failed to fetch ${effectiveFeedUrl}:`, err);
        console.error(`[rss] Failed to fetch fallback ${fallbackFeedUrl}:`, fallbackErr);
        return 0;
      }

      let dataApiItems;
      try {
        dataApiItems = await fetchYouTubeDataApiFeedItems(channelId, 15);
      } catch (dataApiErr) {
        console.error(`[rss] Failed to fetch ${effectiveFeedUrl}:`, err);
        console.error(`[rss] Failed to fetch fallback ${fallbackFeedUrl}:`, fallbackErr);
        console.error(`[rss] Failed to fetch YouTube Data API fallback for ${feed.name}:`, dataApiErr);
        return 0;
      }

      if (!dataApiItems) {
        console.error(`[rss] Failed to fetch ${effectiveFeedUrl}:`, err);
        console.error(`[rss] Failed to fetch fallback ${fallbackFeedUrl}:`, fallbackErr);
        console.error(`[rss] YouTube Data API fallback unavailable for ${feed.name}`);
        return 0;
      }

      parsed = {
        items: dataApiItems,
      };
      parsedFeedUrl = `youtube-data-api:${channelId}`;
      usedYouTubeDataApiFallback = true;
      console.warn(
        `[rss] Falling back to YouTube Data API for ${feed.name}: primary=${effectiveFeedUrl} fallback=${fallbackFeedUrl}`,
      );
    }
  }

  const now = new Date().toISOString();
  let newCount = 0;
  let totalItems = 0;
  let filteredItems = 0;
  let existingItems = 0;
  let insertedWithContent = 0;
  let insertedWithoutContent = 0;
  const insertedArticleIds: string[] = [];
  const isYouTubeFeed = feed.sourceType === "youtube";
  const adapter = getSourceAdapter(feed.sourceType as SourceType);
  const usedFallbackYouTubeFeed = isYouTubeFeed && parsedFeedUrl !== effectiveFeedUrl;
  const skipsShortFiltering =
    isYouTubeFeed &&
    !usedYouTubeDataApiFallback &&
    !usedFallbackYouTubeFeed &&
    isYouTubeLongFormFeedUrl(parsedFeedUrl);

  for (const item of parsed.items || []) {
    totalItems++;
    const itemRecord = item as unknown as Record<string, unknown>;
    const articleUrl = item.link || "";
    const guid = item.guid || articleUrl;

    if (!articleUrl) continue;
    if (adapter.shouldSyncItem && !skipsShortFiltering) {
      const shouldSync = await adapter.shouldSyncItem(
        item as unknown as Record<string, unknown>,
        articleUrl,
      );
      if (!shouldSync) {
        filteredItems++;
        continue;
      }
    }

    const [existing] = await db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.url, articleUrl));

    if (existing) {
      existingItems++;
      continue;
    }

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

    const inserted = await db.insert(articles).values(article).onConflictDoNothing().returning({ id: articles.id });
    if (inserted.length > 0) {
      insertedArticleIds.push(inserted[0].id);
      newCount++;
      if (contentMarkdown && contentMarkdown.length > 0) {
        insertedWithContent++;
      } else {
        insertedWithoutContent++;
        console.warn(
          `[rss] Inserted article without content feedId=${feed.id} articleUrl=${articleUrl} title=${article.title}`,
        );
      }
    }
  }

  await db.update(feeds).set({ lastFetchedAt: now }).where(eq(feeds.id, feedId));
  if (shouldEnqueueArticleSummaryJobs()) {
    await enqueueArticleSummaryJobsForArticles(insertedArticleIds, { reason: `feed_sync:${feed.id}` }).catch((err) => {
      console.warn(
        `[rss] Failed to enqueue summary jobs feedId=${feed.id} inserted=${insertedArticleIds.length}:`,
        err instanceof Error ? err.message : err,
      );
    });
  }

  if (isYouTubeFeed) {
    console.log(
      `[rss] YouTube sync stats for ${feed.name}: totalItems=${totalItems} filteredShorts=${filteredItems} inserted=${newCount}`,
    );
  }
  console.log(
    `[rss] Sync complete feedId=${feed.id} sourceType=${feed.sourceType} name=${feed.name} totalItems=${totalItems} existingItems=${existingItems} filteredItems=${filteredItems} inserted=${newCount} insertedWithContent=${insertedWithContent} insertedWithoutContent=${insertedWithoutContent} durationMs=${Date.now() - startedAt}`,
  );
  return newCount;
}
