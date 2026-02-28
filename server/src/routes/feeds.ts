import { Router } from "express";
import { nanoid } from "nanoid";
import { eq, inArray, desc } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { feeds } from "../db/schema.js";
import { getSubstackInfo } from "../services/substack.js";
import { syncAllFeeds, syncFeed } from "../services/rss.js";
import { generateDaily } from "../services/digest.js";
import type { Feed } from "../../../shared/types.js";

const createFeedSchema = z.object({
  url: z.string().min(1, "请提供 url"),
  title: z.string().optional(),
  description: z.string().optional(),
  logoUrl: z.string().optional(),
  authorName: z.string().optional(),
});

const importFeedsSchema = z.object({
  items: z
    .array(
      z.object({
        url: z.string().min(1),
        name: z.string().optional(),
        logoUrl: z.string().optional(),
        authorName: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .min(1, "请提供要导入的订阅源列表")
    .max(200, "单次最多导入 200 个订阅源"),
});

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

feedsRouter.get("/", (_req, res) => {
  const db = getDb();
  const rows = db.select().from(feeds).orderBy(desc(feeds.createdAt)).all();
  const result = rows.map(toFeed);
  res.json(result);
});

feedsRouter.post("/", async (req, res) => {
  const parsed = createFeedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { url: rawUrl, title, description, logoUrl, authorName } = parsed.data;

  try {
    let normalizedUrl = rawUrl.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    const parsed = new URL(normalizedUrl);
    const publicationUrl = parsed.origin;
    const feedUrl = `${publicationUrl}/feed`;

    const db = getDb();
    const existing = db.select().from(feeds).where(eq(feeds.feedUrl, feedUrl)).get();
    if (existing) {
      res.status(409).json({ error: "该订阅源已存在" });
      return;
    }

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

    syncFeed(feed.id)
      .then(() => {
        const today = new Date().toISOString().slice(0, 10);
        return generateDaily(today);
      })
      .catch(() => {
      });
  } catch (err) {
    console.error("[feeds/create] Error:", err);
    res.status(500).json({ error: "添加订阅失败" });
  }
});

feedsRouter.delete("/batch", (req, res) => {
  const parsed = z
    .object({ ids: z.array(z.string().min(1)).min(1).max(200) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const db = getDb();
  const result = db.delete(feeds).where(inArray(feeds.id, parsed.data.ids)).run();
  res.json({ deleted: result.changes });
});

feedsRouter.delete("/:id", (req, res) => {
  const db = getDb();
  const result = db.delete(feeds).where(eq(feeds.id, req.params.id)).run();
  if (result.changes === 0) {
    res.status(404).json({ error: "订阅源不存在" });
    return;
  }
  res.json({ success: true });
});

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

feedsRouter.post("/import", async (req, res) => {
  const parsed = importFeedsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { items } = parsed.data;

  try {
    const db = getDb();
    const now = new Date().toISOString();
    let created = 0;
    let skipped = 0;
    const newFeedIds: string[] = [];

    for (const item of items) {
      if (!item.url) {
        skipped++;
        continue;
      }

      let normalizedUrl = item.url.trim();
      if (!/^https?:\/\//i.test(normalizedUrl)) {
        normalizedUrl = `https://${normalizedUrl}`;
      }

      let publicationUrl: string;
      let feedUrl: string;
      try {
        const parsed = new URL(normalizedUrl);
        publicationUrl = parsed.origin;
        feedUrl = `${publicationUrl}/feed`;
      } catch {
        skipped++;
        continue;
      }

      const existing = db
        .select({ id: feeds.id })
        .from(feeds)
        .where(eq(feeds.feedUrl, feedUrl))
        .get();
      if (existing) {
        skipped++;
        continue;
      }

      const name = (item.name || publicationUrl).slice(0, 80);
      const feed = {
        id: nanoid(),
        name,
        description: item.description || null,
        logoUrl: item.logoUrl || null,
        authorName: item.authorName || null,
        publicationUrl,
        feedUrl,
        createdAt: now,
        lastFetchedAt: null,
      };

      db.insert(feeds).values(feed).run();
      newFeedIds.push(feed.id);
      created++;
    }

    res.status(201).json({ created, skipped });

    if (newFeedIds.length > 0) {
      (async () => {
        for (const feedId of newFeedIds) {
          try {
            await syncFeed(feedId);
          } catch (e) {
            void e;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        try {
          const today = new Date().toISOString().slice(0, 10);
          await generateDaily(today);
        } catch (e) {
          void e;
        }
      })();
    }
  } catch (err) {
    console.error("[feeds/import] Error:", err);
    res.status(500).json({ error: "批量导入失败" });
  }
});
