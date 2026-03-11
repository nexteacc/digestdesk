import { Router } from "express";
import { nanoid } from "nanoid";
import { eq, and, inArray, desc } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { feeds } from "../db/schema.js";
import { discoverFeed } from "../services/rss-discovery.js";
import { syncFeed } from "../services/rss.js";
import { generateDaily } from "../services/digest.js";
import type { Feed } from "../../../shared/types.js";

const discoverSchema = z.object({
  url: z.string().min(1, "请提供 URL"),
});

const createSchema = z.object({
  feedUrl: z.string().url("请提供有效的 feed URL"),
  siteUrl: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  logoUrl: z.string().optional(),
  authorName: z.string().optional(),
});

export const rssFeedsRouter = Router();

function toFeed(row: typeof feeds.$inferSelect): Feed {
  return {
    id: row.id,
    title: row.name,
    description: row.description ?? undefined,
    logoUrl: row.logoUrl ?? undefined,
    authorName: row.authorName ?? undefined,
    url: row.publicationUrl,
    feedUrl: row.feedUrl,
    sourceType: row.sourceType,
    lastFetchedAt: row.lastFetchedAt ?? undefined,
    createdAt: row.createdAt,
  };
}

// POST /api/rss-feeds/discover — 探测 RSS feed
rssFeedsRouter.post("/discover", async (req, res) => {
  const parsed = discoverSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  try {
    const result = await discoverFeed(parsed.data.url);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "探测失败";
    res.status(422).json({ error: message });
  }
});

// POST /api/rss-feeds — 确认添加 RSS feed
rssFeedsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const { feedUrl, siteUrl, title, description, logoUrl, authorName } = parsed.data;

  try {
    const db = getDb();
    const [existing] = await db.select().from(feeds).where(eq(feeds.feedUrl, feedUrl));
    if (existing) {
      res.status(409).json({ error: "该订阅源已存在" });
      return;
    }

    const now = new Date().toISOString();
    const feed = {
      id: nanoid(),
      name: (title || new URL(siteUrl).hostname).slice(0, 80),
      description: description || null,
      logoUrl: logoUrl || null,
      authorName: authorName || null,
      publicationUrl: siteUrl,
      feedUrl,
      sourceType: "rss" as const,
      createdAt: now,
      lastFetchedAt: null,
    };

    await db.insert(feeds).values(feed);
    res.status(201).json(toFeed(feed));

    // Background sync + digest
    syncFeed(feed.id)
      .then(() => {
        const today = new Date().toISOString().slice(0, 10);
        return generateDaily(today);
      })
      .catch((err) => {
        console.error(`[rss-feeds/create] Initial sync/digest failed for ${feed.name}:`, err);
      });
  } catch (err) {
    console.error("[rss-feeds/create] Error:", err);
    res.status(500).json({ error: "添加订阅失败" });
  }
});

// DELETE /api/rss-feeds/batch — 批量删除
rssFeedsRouter.delete("/batch", async (req, res) => {
  const parsed = z
    .object({ ids: z.array(z.string().min(1)).min(1).max(200) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const db = getDb();
  const result = await db
    .delete(feeds)
    .where(and(inArray(feeds.id, parsed.data.ids), eq(feeds.sourceType, "rss")));
  res.json({ deleted: result.count });
});

// DELETE /api/rss-feeds/:id — 单个删除
rssFeedsRouter.delete("/:id", async (req, res) => {
  const db = getDb();
  const result = await db
    .delete(feeds)
    .where(and(eq(feeds.id, req.params.id), eq(feeds.sourceType, "rss")));
  if (result.count === 0) {
    res.status(404).json({ error: "订阅源不存在" });
    return;
  }
  res.json({ success: true });
});
