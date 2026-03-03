import { nanoid } from "nanoid";
import { eq, and, gte, lt } from "drizzle-orm";
import pLimit from "p-limit";
import { getDb, getSqlite } from "../db/index.js";
import { feeds, articles, digests, digestItems } from "../db/schema.js";
import { summarizeArticle } from "./summarizer.js";

const CONCURRENCY = 5;

let _dailyQueue: Promise<string | void> = Promise.resolve();

export function generateDaily(date?: string): Promise<string> {
  const task = _dailyQueue.catch(() => {}).then(() => _generateDailyCore(date));
  _dailyQueue = task;
  return task;
}

async function _generateDailyCore(date?: string): Promise<string> {
  const db = getDb();
  
  const baseTime = date ? new Date(date) : new Date();
  
  const dateLabel = baseTime.toISOString().slice(0, 10);

  const startTime = new Date(baseTime.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const endTime = baseTime.toISOString();

  const existing = db
    .select()
    .from(digests)
    .where(and(eq(digests.type, "daily"), eq(digests.date, dateLabel)))
    .get();

  if (existing) {
    console.log(`[digest] Daily for ${dateLabel} already exists, regenerating...`);
    return generateWithId(existing.id, dateLabel, startTime, endTime);
  }

  const digestId = nanoid();
  return generateWithId(digestId, dateLabel, startTime, endTime);
}

async function generateWithId(digestId: string, dateLabel: string, startTime: string, endTime: string): Promise<string> {
  const db = getDb();
  
  const dayArticles = db
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
    .where(and(gte(articles.publishedAt, startTime), lt(articles.publishedAt, endTime)))
    .all();

  const uniqueArticles = Array.from(new Map(dayArticles.map(a => [a.url, a])).values());

  if (uniqueArticles.length === 0) {
    console.log(`[digest] No articles found for ${dateLabel}, skipping.`);
    return "";
  }

  console.log(`[digest] Processing ${uniqueArticles.length} unique articles`);

  const allFeeds = db.select({ id: feeds.id, name: feeds.name }).from(feeds).all();
  const feedMap = new Map(allFeeds.map((f) => [f.id, f.name]));

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
        return { ...base, oneLiner: "内容过短，无法生成摘要", keyInsights: [] };
      }

      try {
        const summary = await summarizeArticle(contentText);
        console.log(`[digest] ✓ ${article.title.slice(0, 40)}`);
        return {
          ...base,
          oneLiner: summary.oneLiner,
          keyInsights: summary.keyInsights,
        };
      } catch (err) {
        console.error(`[digest] Failed to summarize article ${article.id}:`, err);
        return { ...base, oneLiner: "摘要生成失败", keyInsights: [] };
      }
    }),
  );

  const items = await Promise.all(tasks);
  items.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));

  const generationTime = new Date().toISOString();

  getSqlite().transaction(() => {
    const exists = db.select().from(digests).where(eq(digests.id, digestId)).get();
    if (!exists) {
      db.insert(digests)
        .values({
          id: digestId,
          type: "daily",
          date: dateLabel,
          generatedAt: generationTime,
        })
        .run();
    } else {
      db.update(digests)
        .set({ generatedAt: generationTime })
        .where(eq(digests.id, digestId))
        .run();
    }

    db.delete(digestItems).where(eq(digestItems.digestId, digestId)).run();
    db.insert(digestItems)
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
      )
      .run();
  })();

  console.log(`[digest] Daily digest ${digestId} updated with ${items.length} items`);
  return digestId;
}
