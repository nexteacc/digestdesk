import { nanoid } from "nanoid";
import { eq, and, gte, lt } from "drizzle-orm";
import pLimit from "p-limit";
import { getDb } from "../db/index.js";
import { feeds, articles, digests, digestItems } from "../db/schema.js";
import { summarizeArticle, generateWeeklyAnalysis } from "./summarizer.js";

const CONCURRENCY = 5; // 并发摘要数

export async function generateDaily(date?: string): Promise<string> {
  const db = getDb();
  const targetDate = date || new Date().toISOString().slice(0, 10);
  const nextDate = getNextDate(targetDate);

  // 检查当天是否已生成
  const existing = db
    .select()
    .from(digests)
    .where(and(eq(digests.type, "daily"), eq(digests.date, targetDate)))
    .get();

  if (existing) {
    console.log(`[digest] Daily for ${targetDate} already exists: ${existing.id}`);
    return existing.id;
  }

  // 取指定日期范围内的文章（按 publishedAt 或 fetchedAt）
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
    .where(and(gte(articles.publishedAt, targetDate), lt(articles.publishedAt, nextDate)))
    .all();

  if (dayArticles.length === 0) {
    console.log(`[digest] No articles for ${targetDate}`);
    // 也可以尝试用 fetchedAt
    const fetchedArticles = db
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
      .where(and(gte(articles.fetchedAt, targetDate), lt(articles.fetchedAt, nextDate)))
      .all();

    if (fetchedArticles.length === 0) {
      throw new Error(`没有找到 ${targetDate} 的文章`);
    }
    dayArticles.push(...fetchedArticles);
  }

  console.log(`[digest] Generating daily for ${targetDate}, ${dayArticles.length} articles`);

  // 获取 feed 名称映射
  const allFeeds = db.select({ id: feeds.id, name: feeds.name }).from(feeds).all();
  const feedMap = new Map(allFeeds.map((f) => [f.id, f.name]));

  const toProcess = dayArticles;
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

  const tasks = toProcess.map((article) =>
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

  // 写入数据库
  const digestId = nanoid();
  const now = new Date().toISOString();

  db.insert(digests)
    .values({
      id: digestId,
      type: "daily",
      date: targetDate,
      generatedAt: now,
    })
    .run();

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

  console.log(`[digest] Daily digest ${digestId} created with ${items.length} items`);
  return digestId;
}

/**
 * 生成周报：汇总本周日报 → AI 归纳主题 + 编辑推荐 → 存入 DB
 */
export async function generateWeekly(weekStartDate?: string): Promise<string> {
  const db = getDb();

  // 默认取本周一
  const start = weekStartDate || getMonday(new Date()).toISOString().slice(0, 10);

  // 检查是否已生成
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
    throw new Error(`没有找到 ${start} 这一周的日报`);
  }

  // 调用 AI 生成周报分析
  const inputForAI = allItems.map((it) => ({
    id: it.articleId || it.id,
    feedTitle: it.feedName,
    title: it.articleTitle,
    oneLiner: it.oneLiner,
    url: it.url,
  }));

  const analysis = await generateWeeklyAnalysis(inputForAI);

  // 写入数据库
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
    .all()
    .filter((item) => digestIds.includes(item.digestId));

  return allItems;
}

// --- 工具函数 ---

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
