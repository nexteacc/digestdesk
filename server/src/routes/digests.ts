import { Router } from "express";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { digests, digestItems, feeds, subscriptions } from "../db/schema.js";
import { executeDailyDigestJob } from "../services/digest-execution.js";
import { cancelPendingDigestJobsForDate } from "../services/digest-jobs.js";
import type { Digest, DigestItem, DigestOverview, Feed } from "../../../shared/types.js";
import { getRequestUserId } from "../auth/user-context.js";
import { generatePerMinuteLimiter, generatePerDayLimiter } from "../middleware/rate-limit.js";
import { isNull } from "drizzle-orm";

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
    feedId: row.feedId ?? undefined,
    sourceType: row.sourceType,
    feedTitle: row.feedName,
    title: row.articleTitle,
    author: row.author ?? undefined,
    url: row.url,
    oneLiner: row.oneLiner,
    keyInsights: (safeJsonParse(row.keyInsights) as string[]) ?? [],
    publishedAt: row.publishedAt,
  };
}

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

digestsRouter.get("/overview", async (req, res) => {
  const db = getDb();
  const userId = getRequestUserId(req);

  const [digestRows, feedRows] = await Promise.all([
    db
      .select()
      .from(digests)
      .where(and(eq(digests.userId, userId), eq(digests.type, "daily")))
      .orderBy(desc(digests.date)),
    db
      .select({ feed: feeds })
      .from(subscriptions)
      .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
      .where(and(eq(subscriptions.userId, userId), isNull(subscriptions.endedAt)))
      .orderBy(desc(feeds.createdAt)),
  ]);

  const digestList = digestRows.map((row) => ({
    id: row.id,
    type: row.type,
    date: row.date,
    generatedAt: row.generatedAt,
  }));

  let currentDigest: Digest | null = null;
  const latestDigest = digestRows[0];

  if (latestDigest) {
    const items = (await db
      .select()
      .from(digestItems)
      .where(eq(digestItems.digestId, latestDigest.id))
      .orderBy(digestItems.sortOrder))
      .map(toDigestItem);

    currentDigest = toDigest(latestDigest, items);
  }

  const payload: DigestOverview = {
    digests: digestList,
    currentDigest,
    feeds: feedRows.map(({ feed }) => toFeed(feed)),
  };

  res.json(payload);
});

digestsRouter.get("/:id", async (req, res) => {
  const db = getDb();
  const userId = getRequestUserId(req);
  const [digest] = await db
    .select()
    .from(digests)
    .where(and(eq(digests.id, req.params.id), eq(digests.userId, userId)));

  if (!digest) {
    res.status(404).json({ error: "Digest not found.", errorZh: "日报不存在" });
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

digestsRouter.post("/generate", generatePerMinuteLimiter, generatePerDayLimiter, async (req, res) => {
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
      await cancelPendingDigestJobsForDate(userId, date);
    }
    console.log(`[digests/generate] Starting execution for user=${userId}`);
    const digestId = await executeDailyDigestJob(userId, date);

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
      res.status(500).json({ error: "Digest generation failed.", errorZh: "生成后未找到记录" });
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
      res.status(500).json({ error: err.message || "Digest generation failed.", errorZh: "生成失败" });
    } else {
      res.status(500).json({ error: "Digest generation failed.", errorZh: "生成失败" });
    }
  }
});
