import { nanoid } from "nanoid";
import { eq, and, gte, lt, inArray, isNull } from "drizzle-orm";
import pLimit from "p-limit";
import { getDb } from "../db/index.js";
import { feeds, articles, digests, digestItems, subscriptions, userSettings } from "../db/schema.js";
import { classifyAiError, getMaxInputChars, summarizeArticleWithMetadata } from "./summarizer.js";
import { getDayRangeForTimeZone, getPreviousDateLabel, getTimeZoneDateLabel } from "../utils/timezone.js";
import { parseDigestSourceTypes } from "./user-settings.js";
import { getSummaryLanguageProfile, parseDigestLanguage } from "./summary-language-profiles.js";
import {
  readArticleSummaryMap,
  readCachedArticleSummaryFromMaps,
  writeArticleSummary,
} from "./article-summary-cache.js";
import type { DigestLanguage } from "../../../shared/types.js";

const DEFAULT_CONCURRENCY = 3;

function isDigestDebugEnabled() {
  return (
    process.env.DIGEST_DEBUG_LOGS === "true" ||
    process.env.DIGEST_DEBUG_LOGS === "1" ||
    process.env.DEBUG === "true" ||
    process.env.DEBUG === "1"
  );
}

function getSummaryConcurrency() {
  const raw = Number(process.env.AI_SUMMARY_CONCURRENCY ?? DEFAULT_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_CONCURRENCY;
}

// Per-user queues: same user is serialized, different users run in parallel
const _userQueues = new Map<string, Promise<string | void>>();

export function generateDaily(
  userId: string,
  date?: string,
  options?: { executionId?: string },
): Promise<string> {
  const prev = _userQueues.get(userId) ?? Promise.resolve();
  const task = prev.catch(() => {}).then(() => _generateDailyCore(userId, date, options));
  _userQueues.set(userId, task);
  task.finally(() => {
    if (_userQueues.get(userId) === task) {
      _userQueues.delete(userId);
    }
  });
  return task;
}

async function _generateDailyCore(
  userId: string,
  date?: string,
  options?: { executionId?: string },
): Promise<string> {
  const db = getDb();
  const trace = options?.executionId ? ` executionId=${options.executionId}` : "";

  const settingRows = await db
    .select({ key: userSettings.key, value: userSettings.value })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  const settings = Object.fromEntries(settingRows.map((row) => [row.key, row.value]));
  const language = parseDigestLanguage(settings.digest_language);
  const timezone = settings.timezone || "Asia/Shanghai";
  const enabledSourceTypes = parseDigestSourceTypes(settings.digest_source_types);
  const todayLabel = getTimeZoneDateLabel(new Date(), timezone);
  const dateLabel = date || getPreviousDateLabel(todayLabel);
  const { startIso: startTime, endIso: endTime } = getDayRangeForTimeZone(dateLabel, timezone);

  console.log(
    `[digest] Start generateDaily:${trace} user=${userId} requestedDate=${date ?? "auto"} targetDate=${dateLabel} timezone=${timezone} language=${language} range=${startTime}..${endTime}`,
  );

  const [existing] = await db
    .select()
    .from(digests)
    .where(and(eq(digests.userId, userId), eq(digests.type, "daily"), eq(digests.date, dateLabel)));

  if (existing) {
    console.log(`[digest] Daily exists${trace} user=${userId} date=${dateLabel} digestId=${existing.id}; regenerating`);
    return generateWithId(userId, existing.id, dateLabel, startTime, endTime, language, enabledSourceTypes, options);
  }

  const digestId = nanoid();
  return generateWithId(userId, digestId, dateLabel, startTime, endTime, language, enabledSourceTypes, options);
}

async function generateWithId(
  userId: string,
  digestId: string,
  dateLabel: string,
  startTime: string,
  endTime: string,
  language: DigestLanguage = "zh",
  enabledSourceTypes: Array<"substack" | "rss" | "youtube" | "podcast">,
  options?: { executionId?: string },
): Promise<string> {
  const startedAt = Date.now();
  const db = getDb();
  const trace = options?.executionId ? ` executionId=${options.executionId}` : "";
  const debug = isDigestDebugEnabled();
  const languageProfile = getSummaryLanguageProfile(language);

  const subscribedFeedRows = await db
    .select({ feedId: subscriptions.feedId, startedAt: subscriptions.startedAt })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), isNull(subscriptions.endedAt)));
  const subscribedFeedIds = subscribedFeedRows.map((row) => row.feedId);
  const subscriptionStartMap = new Map(
    subscribedFeedRows.map((row) => [row.feedId, row.startedAt]),
  );

  console.log(
    `[digest] Active subscriptions${trace} user=${userId} date=${dateLabel} count=${subscribedFeedIds.length}`,
  );

  if (subscribedFeedIds.length === 0) {
    console.log(`[digest] Skip${trace} user=${userId} date=${dateLabel} reason=no_active_subscriptions`);
    return "";
  }

  const allFeeds = await db
    .select({ id: feeds.id, name: feeds.name, sourceType: feeds.sourceType })
    .from(feeds)
    .where(inArray(feeds.id, subscribedFeedIds));
  const allowedFeedRows = allFeeds.filter((feed) => enabledSourceTypes.includes(feed.sourceType));
  const allowedFeedIds = allowedFeedRows.map((feed) => feed.id);

  console.log(
    `[digest] Source filter${trace} user=${userId} enabledSources=${enabledSourceTypes.join(",")} allowedFeeds=${allowedFeedIds.length}/${subscribedFeedIds.length}`,
  );

  if (allowedFeedIds.length === 0) {
    console.log(`[digest] Skip${trace} user=${userId} date=${dateLabel} reason=no_allowed_sources`);
    return "";
  }

  const dayArticles = await db
    .select({
      id: articles.id,
      feedId: articles.feedId,
      title: articles.title,
      author: articles.author,
      url: articles.url,
      publishedAt: articles.publishedAt,
      contentText: articles.contentText,
      summaryZh: articles.summaryZh,
      summaryEn: articles.summaryEn,
    })
    .from(articles)
    .where(
      and(
        inArray(articles.feedId, allowedFeedIds),
        gte(articles.publishedAt, startTime),
        lt(articles.publishedAt, endTime),
      ),
    );

  const summaryMap = await readArticleSummaryMap(
    dayArticles.map((article) => article.id),
    language,
  );

  console.log(
    `[digest] Articles in range${trace} user=${userId} date=${dateLabel} count=${dayArticles.length}`,
  );

  const uniqueArticles = Array.from(new Map(dayArticles.map(a => [a.url, a])).values());
  const duplicateCount = dayArticles.length - uniqueArticles.length;
  let filteredBySubscriptionBoundary = 0;
  const eligibleArticles = uniqueArticles.filter((article) => {
    const startedAt = subscriptionStartMap.get(article.feedId);
    const included = !startedAt || article.publishedAt >= startedAt;
    if (!included) {
      filteredBySubscriptionBoundary += 1;
    }
    if (debug) {
      console.log(
        `[digest] Article eligibility${trace} user=${userId} date=${dateLabel} article=${article.id} feed=${article.feedId} publishedAt=${article.publishedAt} startedAt=${startedAt ?? "none"} included=${included} reason=${included ? "eligible" : "before_subscription"} url=${article.url}`,
      );
    }
    return included;
  });

  console.log(
    `[digest] Eligibility summary${trace} user=${userId} date=${dateLabel} unique=${uniqueArticles.length} deduped=${duplicateCount} filteredByStartedAt=${filteredBySubscriptionBoundary} eligible=${eligibleArticles.length}`,
  );

  if (eligibleArticles.length === 0) {
    console.log(
      `[digest] Skip${trace} user=${userId} date=${dateLabel} reason=no_eligible_articles range=${startTime}..${endTime}`,
    );
    return "";
  }

  console.log(`[digest] Processing${trace} user=${userId} date=${dateLabel} language=${language} articles=${eligibleArticles.length}`);

  const feedMap = new Map(allFeeds.map((f) => [f.id, f.name]));
  const feedSourceMap = new Map(allFeeds.map((f) => [f.id, f.sourceType]));

  const limit = pLimit(getSummaryConcurrency());
  let summaryCacheHits = 0;
  let summaryCacheMisses = 0;
  let summaryCacheInvalid = 0;
  let summaryGenerated = 0;
  let summaryTooShort = 0;
  let summaryFallbacks = 0;
  let totalAiInputChars = 0;
  let estimatedAiSentChars = 0;
  let maxAiArticleInputChars = 0;
  let modelRequests = 0;
  let retryRequests = 0;
  const maxInputChars = getMaxInputChars();

  type ItemResult = {
    articleId: string;
    feedId: string;
    sourceType: "substack" | "rss" | "youtube" | "podcast";
    feedName: string;
    title: string;
    author: string | null;
    url: string;
    publishedAt: string;
    oneLiner: string;
    keyInsights: string[];
  };

  const tasks = eligibleArticles.map((article) =>
    limit(async (): Promise<ItemResult> => {
      const contentText = article.contentText || "";
      const feedName = feedMap.get(article.feedId) || languageProfile.fallbackText.unknownSource;
      const sourceType = feedSourceMap.get(article.feedId) || "substack";
      const base = {
        articleId: article.id,
        feedId: article.feedId,
        sourceType,
        feedName,
        title: article.title,
        author: article.author,
        url: article.url,
        publishedAt: article.publishedAt,
      };
      if (debug) {
        const cachedLength =
          summaryMap.get(article.id)?.length ??
          (language === "zh"
            ? (article.summaryZh?.length ?? 0)
            : language === "en"
              ? (article.summaryEn?.length ?? 0)
              : 0);
        console.log(
          `[digest] Article summary input${trace} user=${userId} date=${dateLabel} article=${article.id} feed=${article.feedId} sourceType=${sourceType} publishedAt=${article.publishedAt} contentLength=${contentText.length} cachedSummaryLength=${cachedLength} url=${article.url}`,
        );
      }

      if (!contentText || contentText.length < 50) {
        const isYouTube = sourceType === "youtube";
        const isPodcast = sourceType === "podcast";
        summaryTooShort += 1;
        console.warn(
          `[digest] Skipping AI summary${trace} article=${article.id} sourceType=${sourceType} contentLength=${contentText.length} reason=content_too_short url=${article.url}`,
        );
        return {
          ...base,
          oneLiner: isYouTube
            ? languageProfile.fallbackText.youtubeNoTranscript
            : isPodcast
              ? languageProfile.fallbackText.podcastDescription
              : languageProfile.fallbackText.contentTooShort,
          keyInsights: [],
        };
      }

      // Check cache first
      const cached = readCachedArticleSummaryFromMaps({
        articleId: article.id,
        language,
        summaryMap,
        legacyFields: article,
      });
      if (cached) {
        summaryCacheHits += 1;
        console.log(
          `[digest] Summary cache hit${trace} article=${article.id} sourceType=${sourceType} language=${language} cacheSource=${cached.source} insights=${Array.isArray(cached.summary.keyInsights) ? cached.summary.keyInsights.length : "unknown"} url=${article.url}`,
        );
        return { ...base, oneLiner: cached.summary.oneLiner, keyInsights: cached.summary.keyInsights };
      }
      if (summaryMap.has(article.id) || (language === "zh" && article.summaryZh) || (language === "en" && article.summaryEn)) {
        summaryCacheInvalid += 1;
        if (debug) {
          console.warn(
            `[digest] Summary cache invalid${trace} article=${article.id} sourceType=${sourceType} language=${language} reason=failed_quality_or_length_validation url=${article.url}`,
          );
        }
      }
      summaryCacheMisses += 1;
      totalAiInputChars += contentText.length;
      estimatedAiSentChars += maxInputChars > 0 ? Math.min(contentText.length, maxInputChars) : contentText.length;
      maxAiArticleInputChars = Math.max(maxAiArticleInputChars, contentText.length);

      try {
        let articleModelRequests = 0;
        const result = await summarizeArticleWithMetadata(contentText, language, {
          onAttempt: (attempt) => {
            articleModelRequests += 1;
            modelRequests += 1;
            if (attempt > 1) retryRequests += 1;
          },
        });
        const summary = result.summary;
        summaryGenerated += 1;
        await writeArticleSummary({
          articleId: article.id,
          language,
          summary,
          model: result.metadata.model,
          promptVersion: result.metadata.promptVersion,
          generationAttempt: result.metadata.attempt,
        }).catch((e) => {
          console.warn(`[digest] Failed to cache summary${trace} article=${article.id} url=${article.url}:`, e instanceof Error ? e.message : e);
        });
        if (debug) {
          console.log(
            `[digest] Summary generated${trace} article=${article.id} sourceType=${sourceType} language=${language} insights=${summary.keyInsights.length} modelRequests=${articleModelRequests} url=${article.url}`,
          );
        }
        return {
          ...base,
          oneLiner: summary.oneLiner,
          keyInsights: summary.keyInsights,
        };
      } catch (error) {
        summaryFallbacks += 1;
        console.warn(
          `[digest] Summary fallback${trace} article=${article.id} sourceType=${sourceType} language=${language} contentLength=${contentText.length} aiErrorCategory=${classifyAiError(error)} url=${article.url}`,
        );
        return {
          ...base,
          oneLiner: languageProfile.fallbackText.unavailable,
          keyInsights: [],
        };
      }
    }),
  );

  const items = await Promise.all(tasks);
  items.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  const fallbackCount = items.filter((item) =>
    item.oneLiner === languageProfile.fallbackText.unavailable,
  ).length;
  const emptyInsightsCount = items.filter((item) => item.keyInsights.length === 0).length;

  if (debug) {
    for (const item of items) {
      const fallback =
        item.oneLiner === languageProfile.fallbackText.unavailable;
      console.log(
        `[digest] Item ready${trace} user=${userId} date=${dateLabel} article=${item.articleId} feed=${item.feedId} sourceType=${item.sourceType} publishedAt=${item.publishedAt} fallback=${fallback} insights=${item.keyInsights.length} oneLinerLength=${item.oneLiner.length} url=${item.url}`,
      );
    }
  }

  const generationTime = new Date().toISOString();

  await db.transaction(async (tx) => {
    const exists = await tx.select().from(digests).where(eq(digests.id, digestId));
    if (exists.length === 0) {
      await tx.insert(digests)
        .values({
          id: digestId,
          userId,
          type: "daily",
          date: dateLabel,
          generatedAt: generationTime,
        });
    } else {
      await tx.update(digests)
        .set({ generatedAt: generationTime })
        .where(eq(digests.id, digestId));
    }

    await tx.delete(digestItems).where(eq(digestItems.digestId, digestId));
    await tx.insert(digestItems)
      .values(
        items.map((it, i) => ({
          id: nanoid(),
          digestId,
          articleId: it.articleId,
          feedId: it.feedId,
          sourceType: it.sourceType,
          feedName: it.feedName,
          articleTitle: it.title,
          author: it.author || null,
          url: it.url,
          oneLiner: it.oneLiner,
          keyInsights: JSON.stringify(it.keyInsights),
          publishedAt: it.publishedAt,
          sortOrder: i,
        }))
      );
  });

  console.log(
    `[digest] Daily digest updated${trace} digestId=${digestId} user=${userId} date=${dateLabel} items=${items.length} summaryCacheHits=${summaryCacheHits} summaryCacheMisses=${summaryCacheMisses} summaryCacheInvalid=${summaryCacheInvalid} summaryGenerated=${summaryGenerated} summaryTooShort=${summaryTooShort} summaryFallbacks=${summaryFallbacks} aiRequests=${modelRequests} modelRequests=${modelRequests} retryRequests=${retryRequests} totalAiInputChars=${totalAiInputChars} estimatedAiSentChars=${estimatedAiSentChars} maxAiArticleInputChars=${maxAiArticleInputChars} maxInputChars=${maxInputChars} fallbackCount=${fallbackCount} emptyInsightsCount=${emptyInsightsCount} durationMs=${Date.now() - startedAt}`,
  );
  return digestId;
}
