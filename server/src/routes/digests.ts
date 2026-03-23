import { Router } from "express";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { digests, digestItems } from "../db/schema.js";
import { generateDaily } from "../services/digest.js";
import { syncUserFeeds } from "../services/rss.js";
import type { Digest, DigestItem } from "../../../shared/types.js";
import { getRequestUserId } from "../auth/user-context.js";

export const digestsRouter = Router();

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

const generateSchema = z.object({
  type: z.enum(["daily"], { message: "type 必须为 daily" }),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date 格式应为 YYYY-MM-DD")
    .optional(),
  force: z.boolean().optional(),
});

function toDigest(row: typeof digests.$inferSelect, items: DigestItem[]): Digest {
  return {
    id: row.id,
    type: row.type as "daily",
    date: row.date,
    generatedAt: row.generatedAt,
    items,
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

digestsRouter.get("/", async (req, res) => {
  const db = getDb();
  const userId = getRequestUserId(req);

  const rows = await db
    .select()
    .from(digests)
    .where(and(eq(digests.userId, userId), eq(digests.type, "daily")))
    .orderBy(desc(digests.date));

  const result = rows.map((row) => ({
    id: row.id,
    type: row.type,
    date: row.date,
    generatedAt: row.generatedAt,
  }));

  res.json(result);
});

digestsRouter.get("/:id", async (req, res) => {
  const db = getDb();
  const userId = getRequestUserId(req);
  const [digest] = await db
    .select()
    .from(digests)
    .where(and(eq(digests.id, req.params.id), eq(digests.userId, userId)));

  if (!digest) {
    res.status(404).json({ error: "日报不存在" });
    return;
  }

  const items = (await db
    .select()
    .from(digestItems)
    .where(eq(digestItems.digestId, digest.id))
    .orderBy(digestItems.sortOrder))
    .map(toDigestItem);

  res.json(toDigest(digest, items));
});

digestsRouter.post("/generate", async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { date, force, type } = parsed.data;
  const userId = getRequestUserId(req);
  console.log(
    `[digests/generate] Request received: user=${userId} type=${type} date=${date ?? "auto"} force=${Boolean(force)}`,
  );

  try {
    const db = getDb();
    if (date && force) {
      console.log(`[digests/generate] Deleting existing digest before regeneration: user=${userId} date=${date}`);
      await db
        .delete(digests)
        .where(and(eq(digests.userId, userId), eq(digests.type, "daily"), eq(digests.date, date)));
    }
    console.log(`[digests/generate] Starting feed sync for user=${userId}`);
    await syncUserFeeds(userId);
    console.log(`[digests/generate] Feed sync complete for user=${userId}`);

    const digestId = await generateDaily(userId, date);

    if (!digestId) {
      console.log(`[digests/generate] No digest generated for user=${userId} date=${date ?? "auto"} (empty result)`);
      res.json({ status: "empty" });
      return;
    }

    const [digest] = await db
      .select()
      .from(digests)
      .where(and(eq(digests.id, digestId), eq(digests.userId, userId)));
    if (!digest) {
      console.error(`[digests/generate] Generated digest id=${digestId} but record not found for user=${userId}`);
      res.status(500).json({ error: "生成后未找到记录" });
      return;
    }
    const items = (await db
      .select()
      .from(digestItems)
      .where(eq(digestItems.digestId, digestId))
      .orderBy(digestItems.sortOrder))
      .map(toDigestItem);

    console.log(
      `[digests/generate] Success: user=${userId} digestId=${digestId} date=${digest.date} items=${items.length}`,
    );
    res.status(201).json(toDigest(digest, items));
  } catch (err: unknown) {
    console.error(`[digests/generate] Error for user=${userId}:`, err);
    if (err instanceof Error) {
      res.status(500).json({ error: err.message || "生成失败" });
    } else {
      res.status(500).json({ error: "生成失败" });
    }
  }
});
