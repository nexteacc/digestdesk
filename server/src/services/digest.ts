import { nanoid } from "nanoid";
import { eq, and, gte, lt, inArray } from "drizzle-orm";
import pLimit from "p-limit";
import { getDb, getSqlite } from "../db/index.js";
import { feeds, articles, digests, digestItems } from "../db/schema.js";
import { summarizeArticle, generateWeeklyAnalysis } from "./summarizer.js";

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
      const feedName = feedMap.get(article.feedId) || "Unknown Source";
      const base = {
        articleId: article.id,
        feedName,
        title: article.title,
        author: article.author,
        url: article.url,
        publishedAt: article.publishedAt,
      };

      if (!contentText || contentText.length < 50) {
        return { ...base, oneLiner: "Content too short for summary", keyInsights: [] };
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
        return { ...base, oneLiner: "Summary generation failed", keyInsights: [] };
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
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      db.insert(digestItems)
        .values({
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
        })
        .run();
    }
  })();

  console.log(`[digest] Daily digest ${digestId} updated with ${items.length} items`);
  return digestId;
}

export async function generateWeekly(weekStartDate?: string): Promise<string> {
  const db = getDb();

  const start = weekStartDate || getMonday(new Date()).toISOString().slice(0, 10);

  const existing = db
    .select()
    .from(digests)
    .where(and(eq(digests.type, "weekly"), eq(digests.date, start)))
    .get();

  if (existing) {
    console.log(`[digest] Weekly for ${start} already exists: ${existing.id}`);
    return existing.id;
  }

  const allItems = getWeeklyItems(start);

  if (allItems.length === 0) {
    throw new Error(`No daily digests found for week starting ${start}`);
  }

  const inputForAI = allItems.map((it) => ({
    id: it.articleId || it.id,
    feedTitle: it.feedName,
    title: it.articleTitle,
    oneLiner: it.oneLiner,
    url: it.url,
  }));

  let analysis: { weeklyThemes: string[] };
  try {
    analysis = await generateWeeklyAnalysis(inputForAI);
  } catch (err) {
    console.error("[digest] Weekly analysis failed:", err);
    analysis = { weeklyThemes: [] };
  }

  const digestId = nanoid();
  const now = new Date().toISOString();

  db.insert(digests)
    .values({
      id: digestId,
      type: "weekly",
      date: start,
      generatedAt: now,
      weeklyThemes: JSON.stringify(analysis.weeklyThemes),
    })
    .run();

  console.log(`[digest] Weekly digest ${digestId} created`);
  return digestId;
}

export function getWeeklyItems(start: string) {
  const db = getDb();
  const end = getNextDate(start, 7);

  const weeklyDigests = db
    .select({ id: digests.id })
    .from(digests)
    .where(
      and(eq(digests.type, "daily"), gte(digests.date, start), lt(digests.date, end)),
    )
    .all();

  if (weeklyDigests.length === 0) {
    return [];
  }

  const digestIds = weeklyDigests.map((d) => d.id);
  const allItems = db
    .select()
    .from(digestItems)
    .where(inArray(digestItems.digestId, digestIds))
    .all();

  return allItems;
}

function getNextDate(dateStr: string, days = 1): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
