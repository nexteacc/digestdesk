/**
 * Pre-summarization service.
 *
 * Responsibility: after a feed sync, generate and cache AI summaries for any
 * articles that don't have one yet, using the correct language for the user.
 *
 * This runs between syncUserFeeds() and generateDaily() inside
 * executeDailyDigestJob(), so:
 *   - Sync is never blocked by AI calls
 *   - Language is always correct (read from user settings)
 *   - generateDaily() will hit the cache for every article and complete in <1s
 */

import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import pLimit from "p-limit";
import { getDb } from "../db/index.js";
import { articles, subscriptions } from "../db/schema.js";
import { getUserSettingsMap } from "./user-settings.js";
import { classifyAiError, summarizeArticle } from "./summarizer.js";
import { getDayRangeForTimeZone, getPreviousDateLabel, getTimeZoneDateLabel } from "../utils/timezone.js";

const DEFAULT_CONCURRENCY = 3;
const MIN_CONTENT_LENGTH = 50;

function isDigestDebugEnabled() {
  return (
    process.env.DIGEST_DEBUG_LOGS === "true" ||
    process.env.DIGEST_DEBUG_LOGS === "1" ||
    process.env.DEBUG === "true" ||
    process.env.DEBUG === "1"
  );
}

function getPresummarizeConcurrency() {
  const raw = Number(process.env.AI_SUMMARY_CONCURRENCY ?? DEFAULT_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_CONCURRENCY;
}

/**
 * Pre-generate summaries for all articles a user will see in their next digest.
 * Only processes articles that don't already have a valid cached summary in the
 * requested language. Safe to call multiple times (idempotent).
 */
export async function presummarizeForUser(
  userId: string,
  targetDate?: string,
  options?: { executionId?: string },
): Promise<void> {
  const startedAt = Date.now();
  const db = getDb();
  const trace = options?.executionId ? ` executionId=${options.executionId}` : "";
  const debug = isDigestDebugEnabled();

  // Read user settings to get the correct language and timezone
  const settings = await getUserSettingsMap(userId);
  const language = (settings.digest_language as "zh" | "en") || "zh";
  const timezone = settings.timezone || "Asia/Shanghai";

  const todayLabel = getTimeZoneDateLabel(new Date(), timezone);
  const dateLabel = targetDate || getPreviousDateLabel(todayLabel);
  const { startIso: startTime, endIso: endTime } = getDayRangeForTimeZone(dateLabel, timezone);

  // Find all feeds this user is subscribed to
  const subscribedFeeds = await db
    .select({ feedId: subscriptions.feedId })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), isNull(subscriptions.endedAt)));

  if (subscribedFeeds.length === 0) {
    console.log(`[presummarize] Skip${trace} user=${userId} date=${dateLabel} reason=no_active_subscriptions durationMs=${Date.now() - startedAt}`);
    return;
  }

  const feedIds = subscribedFeeds.map((r) => r.feedId);

  // Fetch articles in the target date range for this user's feeds
  const articlesInRange = await db
    .select({
      id: articles.id,
      feedId: articles.feedId,
      title: articles.title,
      url: articles.url,
      publishedAt: articles.publishedAt,
      contentText: articles.contentText,
      summaryZh: articles.summaryZh,
      summaryEn: articles.summaryEn,
    })
    .from(articles)
    .where(
      and(
        inArray(articles.feedId, feedIds),
        gte(articles.publishedAt, startTime),
        lt(articles.publishedAt, endTime),
      ),
    );

  let skippedShort = 0;
  let skippedCached = 0;
  let invalidCache = 0;

  // Keep only articles that need a summary: sufficient content + no valid cache
  const articlesToProcess = articlesInRange.filter((a) => {
    const contentLength = a.contentText?.length ?? 0;
    if (contentLength < MIN_CONTENT_LENGTH) {
      skippedShort += 1;
      if (debug) {
        console.log(
          `[presummarize] Article skip${trace} user=${userId} date=${dateLabel} article=${a.id} feed=${a.feedId} publishedAt=${a.publishedAt} contentLength=${contentLength} reason=content_too_short url=${a.url}`,
        );
      }
      return false;
    }
    const cached = language === "zh" ? a.summaryZh : a.summaryEn;
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.oneLiner && parsed.keyInsights) {
          skippedCached += 1;
          if (debug) {
            console.log(
              `[presummarize] Article skip${trace} user=${userId} date=${dateLabel} article=${a.id} feed=${a.feedId} publishedAt=${a.publishedAt} contentLength=${contentLength} reason=already_cached language=${language} url=${a.url}`,
            );
          }
          return false; // already valid
        }
        invalidCache += 1;
      } catch {
        invalidCache += 1;
        // corrupt cache — re-generate
      }
    }
    if (debug) {
      console.log(
        `[presummarize] Article queued${trace} user=${userId} date=${dateLabel} article=${a.id} feed=${a.feedId} publishedAt=${a.publishedAt} contentLength=${contentLength} language=${language} url=${a.url}`,
      );
    }
    return true;
  });

  console.log(
    `[presummarize] Plan${trace} user=${userId} date=${dateLabel} language=${language} timezone=${timezone} range=${startTime}..${endTime} feeds=${feedIds.length} articlesInRange=${articlesInRange.length} toProcess=${articlesToProcess.length} skippedShort=${skippedShort} skippedCached=${skippedCached} invalidCache=${invalidCache}`,
  );

  if (articlesToProcess.length === 0) {
    console.log(
      `[presummarize] Complete${trace} user=${userId} date=${dateLabel} language=${language} succeeded=0 failed=0 durationMs=${Date.now() - startedAt}`,
    );
    return;
  }

  console.log(
    `[presummarize] Start${trace} user=${userId} date=${dateLabel} language=${language} articles=${articlesToProcess.length}`,
  );

  const limit = pLimit(getPresummarizeConcurrency());
  const updateField = language === "zh" ? "summaryZh" : "summaryEn";

  const results = await Promise.allSettled(
    articlesToProcess.map((article) =>
      limit(async () => {
        const summary = await summarizeArticle(article.contentText!, language);
        const summaryJson = JSON.stringify({ oneLiner: summary.oneLiner, keyInsights: summary.keyInsights });
        await db
          .update(articles)
          .set({ [updateField]: summaryJson })
          .where(eq(articles.id, article.id));
        if (debug) {
          console.log(
            `[presummarize] Article summarized${trace} user=${userId} date=${dateLabel} article=${article.id} language=${language} url=${article.url}`,
          );
        }
      }),
    ),
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  if (failed > 0) {
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        const article = articlesToProcess[i];
        console.warn(
          `[presummarize] Failed${trace} article=${article.id} user=${userId} date=${dateLabel} language=${language} contentLength=${article.contentText?.length ?? 0} aiErrorCategory=${classifyAiError(r.reason)} url=${article.url}:`,
          r.reason instanceof Error ? r.reason.message : r.reason,
        );
      }
    });
  }

  console.log(
    `[presummarize] Complete${trace} user=${userId} date=${dateLabel} language=${language} succeeded=${succeeded} failed=${failed} durationMs=${Date.now() - startedAt}`,
  );
}
