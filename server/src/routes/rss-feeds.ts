import { Router } from "express";
import { nanoid } from "nanoid";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { feeds } from "../db/schema.js";
import { discoverFeed } from "../services/rss-discovery.js";
import { syncFeed } from "../services/rss.js";

const discoverSchema = z.object({
  url: z.string().url("请输入有效的 URL"),
});

const createRssFeedSchema = z.object({
  feedUrl: z.string().url(),
  siteUrl: z.string().url(),
  title: z.string().min(1),
  description: z.string().optional(),
  logoUrl: z.string().optional(),
  authorName: z.string().optional(),
});

export const rssFeedsRouter = Router();

// 探测 RSS
rssFeedsRouter.post("/discover", async (req, res) => {
  const parsed = discoverSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  try {
    const info = await discoverFeed(parsed.data.url);
    res.json(info);
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "探测失败" });
  }
});

// 添加 RSS 订阅
rssFeedsRouter.post("/", async (req, res) => {
  const parsed = createRssFeedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "数据格式不正确" });
    return;
  }

  const db = getDb();
  const { feedUrl, siteUrl, title, description, logoUrl, authorName } = parsed.data;

  try {
    const [existing] = await db.select().from(feeds).where(eq(feeds.feedUrl, feedUrl));
    if (existing) {
      res.status(409).json({ error: "该订阅源已存在" });
      return;
    }

    const now = new Date().toISOString();
    const id = nanoid();
    
    await db.insert(feeds).values({
      id,
      name: title,
      description,
      logoUrl,
      authorName,
      publicationUrl: siteUrl,
      feedUrl,
      sourceType: "rss",
      createdAt: now,
    });

    // 触发首次同步 (后台执行)
    syncFeed(id).catch(err => console.error(`[rss] Initial sync failed for ${id}:`, err));

    res.json({ id, success: true });
  } catch (err) {
    console.error("[rss] Error adding feed:", err);
    res.status(500).json({ error: "添加订阅源失败" });
  }
});

// 获取所有 RSS 类型的订阅
rssFeedsRouter.get("/", async (_req, res) => {
  const db = getDb();
  const rows = await db.select().from(feeds)
    .where(eq(feeds.sourceType, "rss"))
    .orderBy(desc(feeds.createdAt));
  
  res.json(rows.map(row => ({
    id: row.id,
    title: row.name,
    description: row.description,
    logoUrl: row.logoUrl,
    authorName: row.authorName,
    url: row.publicationUrl,
    feedUrl: row.feedUrl,
    sourceType: row.sourceType,
    lastFetchedAt: row.lastFetchedAt,
    createdAt: row.createdAt,
  })));
});
