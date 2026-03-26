import { nanoid } from "nanoid";
import { eq, and, gte, lt, inArray, isNull } from "drizzle-orm";
import pLimit from "p-limit";
import { getDb } from "../db/index.js";
import { feeds, articles, digests, digestItems, subscriptions, userSettings } from "../db/schema.js";
import { summarizeArticle } from "./summarizer.js";
import { getDayRangeForTimeZone, getPreviousDateLabel, getTimeZoneDateLabel } from "../utils/timezone.js";

const CONCURRENCY = 5;

let _dailyQueue: Promise<string | void> = Promise.resolve();

export function generateDaily(userId: string, date?: string): Promise<string> {
  const task = _dailyQueue.catch(() => {}).then(() => _generateDailyCore(userId, date));
  _dailyQueue = task;
  return task;
}

async function _generateDailyCore(userId: string, date?: string): Promise<string> {
  const db = getDb();

  const settingRows = await db
    .select({ key: userSettings.key, value: userSettings.value })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  const settings = Object.fromEntries(settingRows.map((row) => [row.key, row.value]));
  const language = (settings.digest_language as "zh" | "en") || "zh";
  const timezone = settings.timezone || "Asia/Shanghai";
  const todayLabel = getTimeZoneDateLabel(new Date(), timezone);
  const dateLabel = date || getPreviousDateLabel(todayLabel);
  const { startIso: startTime, endIso: endTime } = getDayRangeForTimeZone(dateLabel, timezone);

  console.log(
    `[digest] Start generateDaily: user=${userId} requestedDate=${date ?? "auto"} targetDate=${dateLabel} timezone=${timezone} language=${language} range=${startTime}..${endTime}`,
  );

  const [existing] = await db
    .select()
    .from(digests)
    .where(and(eq(digests.userId, userId), eq(digests.type, "daily"), eq(digests.date, dateLabel)));

  if (existing) {
    console.log(`[digest] Daily for ${userId} on ${dateLabel} already exists, regenerating...`);
    return generateWithId(userId, existing.id, dateLabel, startTime, endTime, language);
  }

  const digestId = nanoid();
  return generateWithId(userId, digestId, dateLabel, startTime, endTime, language);
}

async function generateWithId(
  userId: string,
  digestId: string,
  dateLabel: string,
  startTime: string,
  endTime: string,
  language: "zh" | "en" = "zh",
): Promise<string> {
  const db = getDb();

  const subscribedFeedRows = await db
    .select({ feedId: subscriptions.feedId, startedAt: subscriptions.startedAt })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), isNull(subscriptions.endedAt)));
  const subscribedFeedIds = subscribedFeedRows.map((row) => row.feedId);
  const subscriptionStartMap = new Map(
    subscribedFeedRows.map((row) => [row.feedId, row.startedAt]),
  );

  console.log(
    `[digest] User ${userId} has ${subscribedFeedIds.length} active subscriptions for ${dateLabel}`,
  );

  if (subscribedFeedIds.length === 0) {
    console.log(`[digest] User ${userId} has no subscriptions, skipping ${dateLabel}.`);
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
        inArray(articles.feedId, subscribedFeedIds),
        gte(articles.publishedAt, startTime),
        lt(articles.publishedAt, endTime),
      ),
    );

  console.log(
    `[digest] Found ${dayArticles.length} articles in time range for user ${userId} on ${dateLabel}`,
  );

  const uniqueArticles = Array.from(new Map(dayArticles.map(a => [a.url, a])).values());
  const duplicateCount = dayArticles.length - uniqueArticles.length;
  const eligibleArticles = uniqueArticles.filter((article) => {
    const startedAt = subscriptionStartMap.get(article.feedId);
    return !startedAt || article.publishedAt >= startedAt;
  });
  const filteredBySubscriptionBoundary = uniqueArticles.length - eligibleArticles.length;

  console.log(
    `[digest] User ${userId} on ${dateLabel}: unique=${uniqueArticles.length}, deduped=${duplicateCount}, filteredByStartedAt=${filteredBySubscriptionBoundary}, eligible=${eligibleArticles.length}`,
  );

  if (eligibleArticles.length === 0) {
    console.log(
      `[digest] No eligible articles found for user ${userId} on ${dateLabel}, skipping. range=${startTime}..${endTime}`,
    );
    return "";
  }

  console.log(`[digest] Processing ${eligibleArticles.length} unique articles for user ${userId} in ${language}`);

  const allFeeds = await db
    .select({ id: feeds.id, name: feeds.name, sourceType: feeds.sourceType })
    .from(feeds)
    .where(inArray(feeds.id, subscribedFeedIds));
  const feedMap = new Map(allFeeds.map((f) => [f.id, f.name]));
  const feedSourceMap = new Map(allFeeds.map((f) => [f.id, f.sourceType]));

  const limit = pLimit(CONCURRENCY);

  type ItemResult = {
    articleId: string;
    feedId: string;
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
      const feedName = feedMap.get(article.feedId) || "未知来源";
      const base = {
        articleId: article.id,
        feedId: article.feedId,
        feedName,
        title: article.title,
        author: article.author,
        url: article.url,
        publishedAt: article.publishedAt,
      };

      if (!contentText || contentText.length < 50) {
        const isYouTube = feedSourceMap.get(article.feedId) === "youtube";
        return {
          ...base,
          oneLiner: isYouTube ? "YouTube 视频，暂无文本总结。" : "文章内容太短，无法生成总结。",
          keyInsights: [],
        };
      }

      // Check cache first
      const cachedField = language === "zh" ? article.summaryZh : article.summaryEn;
      if (cachedField) {
        try {
          const cached = JSON.parse(cachedField);
          if (cached.oneLiner && cached.keyInsights) {
            return { ...base, oneLiner: cached.oneLiner, keyInsights: cached.keyInsights };
          }
        } catch {
          // invalid cache, fall through to AI
        }
      }

      try {
        const summary = await summarizeArticle(contentText, language);
        // Cache the summary
        const summaryJson = JSON.stringify({ oneLiner: summary.oneLiner, keyInsights: summary.keyInsights });
        const updateField = language === "zh" ? { summaryZh: summaryJson } : { summaryEn: summaryJson };
        await db.update(articles).set(updateField).where(eq(articles.id, article.id)).catch((e) => {
          console.warn(`[digest] Failed to cache summary for article ${article.id}:`, e instanceof Error ? e.message : e);
        });
        return {
          ...base,
          oneLiner: summary.oneLiner,
          keyInsights: summary.keyInsights,
        };
      } catch (err) {
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

  console.log(`[digest] Daily digest ${digestId} for user ${userId} updated with ${items.length} items`);
  return digestId;
}
