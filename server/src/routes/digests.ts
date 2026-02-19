import { Router } from "express";
import { eq, desc, and } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { digests, digestItems } from "../db/schema.js";
import { generateDaily, generateWeekly, getWeeklyItems } from "../services/digest.js";
import { syncAllFeeds } from "../services/rss.js";
import type { Digest, DigestItem } from "../../../shared/types.js";

export const digestsRouter = Router();

function toDigest(row: typeof digests.$inferSelect, items: DigestItem[]): Digest {
  return {
    id: row.id,
    type: row.type as "daily" | "weekly",
    date: row.date,
    generatedAt: row.generatedAt,
    items,
    weeklyThemes: row.weeklyThemes ? JSON.parse(row.weeklyThemes) : undefined,
  };
}

function toDigestItem(row: typeof digestItems.$inferSelect): DigestItem {
  return {
    id: row.id,
    feedTitle: row.feedName,
    title: row.articleTitle,
    author: row.author ?? undefined,
    url: row.url,
    oneLiner: row.oneLiner,
    keyInsights: JSON.parse(row.keyInsights),
    publishedAt: row.publishedAt,
  };
}

// GET /api/digests — 列出所有日报/周报（不含 items，减少数据量）
digestsRouter.get("/", (req, res) => {
  const db = getDb();
  const type = req.query.type as string | undefined;

  const query = db.select().from(digests);
  const rows = type
    ? query.where(eq(digests.type, type as "daily" | "weekly")).orderBy(desc(digests.date)).all()
    : query.orderBy(desc(digests.date)).all();

  const result = rows.map((row) => ({
    id: row.id,
    type: row.type,
    date: row.date,
    generatedAt: row.generatedAt,
    weeklyThemes: row.weeklyThemes ? JSON.parse(row.weeklyThemes) : undefined,
  }));

  res.json(result);
});

// GET /api/digests/:id — 单份详情（含 items）
digestsRouter.get("/:id", (req, res) => {
  const db = getDb();
  const digest = db
    .select()
    .from(digests)
    .where(eq(digests.id, req.params.id))
    .get();

  if (!digest) {
    res.status(404).json({ error: "日报/周报不存在" });
    return;
  }

  let items: DigestItem[] = [];

  if (digest.type === "weekly") {
    items = getWeeklyItems(digest.date).map(toDigestItem);
  } else {
    items = db
      .select()
      .from(digestItems)
      .where(eq(digestItems.digestId, digest.id))
      .orderBy(digestItems.sortOrder)
      .all()
      .map(toDigestItem);
  }

  res.json(toDigest(digest, items));
});

// POST /api/digests/generate — 手动触发生成
digestsRouter.post("/generate", async (req, res) => {
  const { type, date, force } = req.body as {
    type?: "daily" | "weekly";
    date?: string;
    force?: boolean;
  };

  if (!type || !["daily", "weekly"].includes(type)) {
    res.status(400).json({ error: "type 必须为 daily 或 weekly" });
    return;
  }

  try {
    let digestId: string;
    if (type === "daily") {
      const db = getDb();
      if (date && force) {
        db
          .delete(digests)
          .where(and(eq(digests.type, "daily"), eq(digests.date, date)))
          .run();
      }
      await syncAllFeeds();
      digestId = await generateDaily(date);
    } else {
      digestId = await generateWeekly(date);
    }

    // 返回完整的 digest
    const db = getDb();
    const digest = db.select().from(digests).where(eq(digests.id, digestId)).get();
    const items = db
      .select()
      .from(digestItems)
      .where(eq(digestItems.digestId, digestId))
      .orderBy(digestItems.sortOrder)
      .all()
      .map(toDigestItem);

    res.status(201).json(toDigest(digest!, items));
  } catch (err: unknown) {
    console.error("[digests/generate] Error:", err);
    if (err instanceof Error) {
      res.status(500).json({ error: err.message || "生成失败" });
    } else {
      res.status(500).json({ error: "生成失败" });
    }
  }
});
