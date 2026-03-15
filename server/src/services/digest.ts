import { nanoid } from "nanoid";
import { eq, and, gte, lt } from "drizzle-orm";
import pLimit from "p-limit";
import { getDb } from "../db/index.js";
import { feeds, articles, digests, digestItems, settings } from "../db/schema.js";
import { summarizeArticle } from "./summarizer.js";
import { YouTubeAdapter } from "../sources/adapters/youtube-adapter.js";

const CONCURRENCY = 5;

let _dailyQueue: Promise<string | void> = Promise.resolve();

export function generateDaily(date?: string): Promise<string> {
  const task = _dailyQueue.catch(() => {}).then(() => _generateDailyCore(date));
  _dailyQueue = task;
  return task;
}

async function _generateDailyCore(date?: string): Promise<string> {
  const db = getDb();
  
  // 获取语言设置
  const rows = await db.select().from(settings).where(eq(settings.key, "digest_language"));
  const language = (rows[0]?.value as "zh" | "en") || "zh";

  const baseTime = date ? new Date(date) : new Date();
  
  const dateLabel = baseTime.toISOString().slice(0, 10);

  const startTime = new Date(baseTime.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const endTime = baseTime.toISOString();

  const [existing] = await db
    .select()
    .from(digests)
    .where(and(eq(digests.type, "daily"), eq(digests.date, dateLabel)));

  if (existing) {
    console.log(`[digest] Daily for ${dateLabel} already exists, regenerating...`);
    return generateWithId(existing.id, dateLabel, startTime, endTime, language);
  }

  const digestId = nanoid();
  return generateWithId(digestId, dateLabel, startTime, endTime, language);
}

async function generateWithId(digestId: string, dateLabel: string, startTime: string, endTime: string, language: "zh" | "en" = "zh"): Promise<string> {
  const db = getDb();
  
  const dayArticles = await db
    .select({
      id: articles.id,
      feedId: articles.feedId,
      title: articles.title,
      author: articles.author,
      url: articles.url,
      publishedAt: articles.publishedAt,
      contentText: articles.contentText,
    })
    .from(articles)
    .where(and(gte(articles.publishedAt, startTime), lt(articles.publishedAt, endTime)));

  const uniqueArticles = Array.from(new Map(dayArticles.map(a => [a.url, a])).values());

  if (uniqueArticles.length === 0) {
    console.log(`[digest] No articles found for ${dateLabel}, skipping.`);
    return "";
  }

  console.log(`[digest] Processing ${uniqueArticles.length} unique articles in ${language}`);

  const allFeeds = await db.select({ id: feeds.id, name: feeds.name, sourceType: feeds.sourceType }).from(feeds);
  const feedMap = new Map(allFeeds.map((f) => [f.id, f.name]));
  const feedSourceMap = new Map(allFeeds.map((f) => [f.id, f.sourceType]));

  const limit = pLimit(CONCURRENCY);

  type ItemResult = {
    articleId: string;
    feedName: string;
    title: string;
    author: string | null;
    url: string;
    publishedAt: string;
    oneLiner: string;
    keyInsights: string[];
  };

  const tasks = uniqueArticles.map((article) =>
    limit(async (): Promise<ItemResult> => {
      const contentText = article.contentText || "";
      const feedName = feedMap.get(article.feedId) || "未知来源";
      const base = {
        articleId: article.id,
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

      try {
        const summary = await summarizeArticle(contentText, language);
        return {
          ...base,
          oneLiner: summary.oneLiner,
          keyInsights: summary.keyInsights,
        };
      } catch (err) {
        return {
          ...base,
          oneLiner: "AI 总结生成失败。",
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

  console.log(`[digest] Daily digest ${digestId} updated with ${items.length} items`);
  return digestId;
}
