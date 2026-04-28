import { nanoid } from "nanoid";
import { eq, and, gte, lt, inArray, isNull } from "drizzle-orm";
import pLimit from "p-limit";
import { getDb } from "../db/index.js";
import { feeds, articles, digests, digestItems, subscriptions, userSettings } from "../db/schema.js";
import { classifyAiError, summarizeArticle } from "./summarizer.js";
import { getDayRangeForTimeZone, getPreviousDateLabel, getTimeZoneDateLabel } from "../utils/timezone.js";
import { parseDigestSourceTypes } from "./user-settings.js";

const DEFAULT_CONCURRENCY = 3;

function isDigestDebugEnabled() {
  return process.env.DIGEST_DEBUG_LOGS === "true" || process.env.DIGEST_DEBUG_LOGS === "1";
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
  const language = (settings.digest_language as "zh" | "en") || "zh";
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
  language: "zh" | "en" = "zh",
  enabledSourceTypes: Array<"substack" | "rss" | "youtube" | "podcast">,
  options?: { executionId?: string },
): Promise<string> {
  const startedAt = Date.now();
  const db = getDb();
  const trace = options?.executionId ? ` executionId=${options.executionId}` : "";
  const debug = isDigestDebugEnabled();

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
      const feedName = feedMap.get(article.feedId) || (language === "zh" ? "未知来源" : "Unknown source");
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
            ? (language === "zh" ? "YouTube 视频，暂无文本总结。" : "YouTube update with no transcript-based summary yet.")
            : isPodcast
              ? (language === "zh" ? "播客已更新，以下为简介型快讯。" : "Podcast updated. Summary is based on the available episode description.")
              : (language === "zh" ? "文章内容太短，无法生成总结。" : "Content is too short to generate a useful summary."),
          keyInsights: [],
        };
      }

      // Check cache first
      const cachedField = language === "zh" ? article.summaryZh : article.summaryEn;
      if (cachedField) {
        try {
          const cached = JSON.parse(cachedField);
          if (cached.oneLiner && cached.keyInsights) {
            summaryCacheHits += 1;
            console.log(
              `[digest] Summary cache hit${trace} article=${article.id} sourceType=${sourceType} language=${language} url=${article.url}`,
            );
            return { ...base, oneLiner: cached.oneLiner, keyInsights: cached.keyInsights };
          }
          summaryCacheInvalid += 1;
        } catch {
          summaryCacheInvalid += 1;
          // invalid cache, fall through to AI
        }
      }
      summaryCacheMisses += 1;

      try {
        const summary = await summarizeArticle(contentText, language);
        summaryGenerated += 1;
        // Cache the summary
        const summaryJson = JSON.stringify({ oneLiner: summary.oneLiner, keyInsights: summary.keyInsights });
        const updateField = language === "zh" ? { summaryZh: summaryJson } : { summaryEn: summaryJson };
        await db.update(articles).set(updateField).where(eq(articles.id, article.id)).catch((e) => {
          console.warn(`[digest] Failed to cache summary${trace} article=${article.id} url=${article.url}:`, e instanceof Error ? e.message : e);
        });
        if (debug) {
          console.log(
            `[digest] Summary generated${trace} article=${article.id} sourceType=${sourceType} language=${language} url=${article.url}`,
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
          oneLiner: language === "zh" ? "暂时无法生成摘要。" : "Summary unavailable for now.",
          keyInsights: [],
        };
      }
    }),
  );

  const items = await Promise.all(tasks);
  items.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  const fallbackCount = items.filter((item) =>
    language === "zh" ? item.oneLiner === "暂时无法生成摘要。" : item.oneLiner === "Summary unavailable for now.",
  ).length;
  const emptyInsightsCount = items.filter((item) => item.keyInsights.length === 0).length;

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
    `[digest] Daily digest updated${trace} digestId=${digestId} user=${userId} date=${dateLabel} items=${items.length} summaryCacheHits=${summaryCacheHits} summaryCacheMisses=${summaryCacheMisses} summaryCacheInvalid=${summaryCacheInvalid} summaryGenerated=${summaryGenerated} summaryTooShort=${summaryTooShort} summaryFallbacks=${summaryFallbacks} fallbackCount=${fallbackCount} emptyInsightsCount=${emptyInsightsCount} durationMs=${Date.now() - startedAt}`,
  );
  return digestId;
}
