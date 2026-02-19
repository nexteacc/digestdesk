import { Router } from "express";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { feeds } from "../db/schema.js";
import { getSubstackInfo } from "../services/substack.js";
import { syncAllFeeds, syncFeed } from "../services/rss.js";
import { generateDaily } from "../services/digest.js";
import type { Feed } from "../../../shared/types.js";

export const feedsRouter = Router();

function toFeed(row: typeof feeds.$inferSelect): Feed {
  return {
    id: row.id,
    title: row.name,
    description: row.description ?? undefined,
    logoUrl: row.logoUrl ?? undefined,
    authorName: row.authorName ?? undefined,
    url: row.publicationUrl,
    feedUrl: row.feedUrl,
    lastFetchedAt: row.lastFetchedAt ?? undefined,
    createdAt: row.createdAt,
  };
}

// GET /api/feeds
feedsRouter.get("/", (_req, res) => {
  const db = getDb();
  const rows = db.select().from(feeds).all();
  const result = rows.map(toFeed).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json(result);
});

// POST /api/feeds { url: string, title?: string }
feedsRouter.post("/", async (req, res) => {
  const { url: rawUrl, title, description, logoUrl, authorName } = req.body;
  if (!rawUrl) {
    res.status(400).json({ error: "请提供 url" });
    return;
  }

  try {
    // 归一化 URL
    let normalizedUrl = rawUrl.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    const parsed = new URL(normalizedUrl);
    const publicationUrl = parsed.origin;
    const feedUrl = `${publicationUrl}/feed`;

    // 检查重复
    const db = getDb();
    const existing = db.select().from(feeds).where(eq(feeds.feedUrl, feedUrl)).get();
    if (existing) {
      res.status(409).json({ error: "该订阅源已存在" });
      return;
    }

    // 尝试自动获取出版物信息
    let info = { name: title || "", description: description || "", logoUrl: logoUrl || "", authorName: authorName || "" };
    try {
      const substackInfo = await getSubstackInfo(publicationUrl);
      info = {
        name: title || substackInfo.name || parsed.hostname,
        description: description || substackInfo.description,
        logoUrl: logoUrl || substackInfo.logoUrl,
        authorName: authorName || substackInfo.authorName,
      };
    } catch {
      // 获取失败时使用传入的信息或域名
      if (!info.name) {
        info.name = parsed.hostname.replace(/^www\./, "");
      }
    }

    const now = new Date().toISOString();
    const feed = {
      id: nanoid(),
      name: info.name.slice(0, 80),
      description: info.description || null,
      logoUrl: info.logoUrl || null,
      authorName: info.authorName || null,
      publicationUrl,
      feedUrl,
      createdAt: now,
      lastFetchedAt: null,
    };

    db.insert(feeds).values(feed).run();

    res.status(201).json(toFeed(feed));

    // Fire-and-forget: 同步该 feed 的文章，然后自动生成今日日报
    syncFeed(feed.id)
      .then(() => {
        const today = new Date().toISOString().slice(0, 10);
        return generateDaily(today);
      })
      .catch(() => {
        // 静默处理，不影响已返回的响应
      });
  } catch (err) {
    console.error("[feeds/create] Error:", err);
    res.status(500).json({ error: "添加订阅失败" });
  }
});

// DELETE /api/feeds/:id
feedsRouter.delete("/:id", (req, res) => {
  const db = getDb();
  const result = db.delete(feeds).where(eq(feeds.id, req.params.id)).run();
  if (result.changes === 0) {
    res.status(404).json({ error: "订阅源不存在" });
    return;
  }
  res.json({ success: true });
});

// POST /api/feeds/sync — 手动触发 RSS 同步
feedsRouter.post("/sync", async (_req, res) => {
  try {
    await syncAllFeeds();
    res.json({ success: true });
  } catch (err: unknown) {
    console.error("[feeds/sync] Error:", err);
    if (err instanceof Error) {
      res.status(500).json({ error: err.message || "同步失败" });
    } else {
      res.status(500).json({ error: "同步失败" });
    }
  }
});
