import { Router } from "express";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { digests, digestItems } from "../db/schema.js";
import { generateDaily, generateWeekly, getWeeklyItems } from "../services/digest.js";
import { syncAllFeeds } from "../services/rss.js";
import type { Digest, DigestItem } from "../../../shared/types.js";

export const digestsRouter = Router();

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

const generateSchema = z.object({
  type: z.enum(["daily", "weekly"], { message: "type 必须为 daily 或 weekly" }),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date 格式应为 YYYY-MM-DD")
    .optional(),
  force: z.boolean().optional(),
});

function toDigest(row: typeof digests.$inferSelect, items: DigestItem[]): Digest {
  return {
    id: row.id,
    type: row.type as "daily" | "weekly",
    date: row.date,
    generatedAt: row.generatedAt,
    items,
    weeklyThemes: row.weeklyThemes ? safeJsonParse(row.weeklyThemes) as string[] : undefined,
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
    keyInsights: (safeJsonParse(row.keyInsights) as string[]) ?? [],
    publishedAt: row.publishedAt,
  };
}

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
    weeklyThemes: row.weeklyThemes ? safeJsonParse(row.weeklyThemes) as string[] : undefined,
  }));

  res.json(result);
});

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

digestsRouter.post("/generate", async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { type, date, force } = parsed.data;

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

    const db = getDb();
    const digest = db.select().from(digests).where(eq(digests.id, digestId)).get();
    if (!digest) {
      res.status(500).json({ error: "生成后未找到记录" });
      return;
    }
    const items = db
      .select()
      .from(digestItems)
      .where(eq(digestItems.digestId, digestId))
      .orderBy(digestItems.sortOrder)
      .all()
      .map(toDigestItem);

    res.status(201).json(toDigest(digest, items));
  } catch (err: unknown) {
    console.error("[digests/generate] Error:", err);
    if (err instanceof Error) {
      res.status(500).json({ error: err.message || "生成失败" });
    } else {
      res.status(500).json({ error: "生成失败" });
    }
  }
});
