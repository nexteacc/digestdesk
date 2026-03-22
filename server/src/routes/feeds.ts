import { Router } from "express";
import { nanoid } from "nanoid";
import { eq, inArray, desc, and, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { feeds, subscriptions } from "../db/schema.js";
import { syncFeed, syncUserFeeds } from "../services/rss.js";
import { generateDaily } from "../services/digest.js";
import type { Feed } from "../../../shared/types.js";
import { getSubstackAdapter } from "../sources/factory.js";
import { toAppError } from "../sources/app-error.js";
import { getRequestUserId } from "../auth/user-context.js";
import { getUserTimezone } from "../services/user-settings.js";
import { getPreviousDateLabel, getTimeZoneDateLabel } from "../utils/timezone.js";

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
const substackAdapter = getSubstackAdapter();

function toFeed(row: typeof feeds.$inferSelect): Feed {
  return {
    id: row.id,
    title: row.name,
    description: row.description ?? undefined,
    logoUrl: row.logoUrl ?? undefined,
    authorName: row.authorName ?? undefined,
    url: row.publicationUrl,
    feedUrl: row.feedUrl,
    sourceType: row.sourceType as "substack" | "rss" | "youtube",
    lastFetchedAt: row.lastFetchedAt ?? undefined,
    createdAt: row.createdAt,
  };
}

feedsRouter.get("/", async (req, res) => {
  const db = getDb();
  const userId = getRequestUserId(req);
  const sourceType = req.query.sourceType as "substack" | "rss" | "youtube" | undefined;

  const filter = sourceType
    ? and(eq(subscriptions.userId, userId), isNull(subscriptions.endedAt), eq(feeds.sourceType, sourceType))
    : and(eq(subscriptions.userId, userId), isNull(subscriptions.endedAt));

  const rows = await db
    .select({ feed: feeds })
    .from(subscriptions)
    .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
    .where(filter)
    .orderBy(desc(feeds.createdAt));
  const result = rows.map(({ feed }) => toFeed(feed));
  res.json(result);
});

feedsRouter.post("/", async (req, res) => {
  const parsed = createFeedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { url: rawUrl, title, description, logoUrl, authorName } = parsed.data;
  const userId = getRequestUserId(req);

  try {
    const draft = await substackAdapter.createFeedDraft({
      url: rawUrl,
      title,
      description,
      logoUrl,
      authorName,
    });

    const db = getDb();
    const [existing] = await db.select().from(feeds).where(eq(feeds.feedUrl, draft.feedUrl));
    if (existing) {
      const [existingSubscription] = await db
        .select({ id: subscriptions.id, endedAt: subscriptions.endedAt })
        .from(subscriptions)
        .where(and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, existing.id)))
        .orderBy(desc(subscriptions.createdAt));
      if (existingSubscription) {
        if (!existingSubscription.endedAt) {
          res.status(409).json({ error: "该订阅源已存在" });
          return;
        }

        await db
          .update(subscriptions)
          .set({
            startedAt: new Date().toISOString(),
            endedAt: null,
          })
          .where(eq(subscriptions.id, existingSubscription.id));

        res.status(201).json(toFeed(existing));
        return;
      }

      await db.insert(subscriptions).values({
        id: nanoid(),
        userId,
        feedId: existing.id,
        startedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });

      res.status(201).json(toFeed(existing));
      return;
    }

    const now = new Date().toISOString();
    const feed = {
      id: nanoid(),
      name: draft.name,
      description: draft.description ?? null,
      logoUrl: draft.logoUrl ?? null,
      authorName: draft.authorName ?? null,
      publicationUrl: draft.publicationUrl,
      feedUrl: draft.feedUrl,
      sourceType: "substack" as const,
      createdAt: now,
      lastFetchedAt: null,
    };

    await db.transaction(async (tx) => {
      await tx.insert(feeds).values(feed);
      await tx.insert(subscriptions).values({
        id: nanoid(),
        userId,
        feedId: feed.id,
        startedAt: now,
        createdAt: now,
      });
    });

    res.status(201).json(toFeed(feed));

    // Background sync
    syncFeed(feed.id)
      .then(() => {
        return getUserTimezone(userId).then((timezone) => {
          const today = getTimeZoneDateLabel(new Date(), timezone);
          return generateDaily(userId, getPreviousDateLabel(today));
        });
      })
      .catch((err) => {
        console.error(`[feeds/create] Initial sync/digest failed for ${feed.name}:`, err);
      });
  } catch (err) {
    const appError = toAppError(err);
    console.error("[feeds/create] Error:", appError.message);
    res.status(appError.status).json({ error: appError.message, code: appError.code });
  }
});

feedsRouter.delete("/batch", async (req, res) => {
  const parsed = z
    .object({ ids: z.array(z.string().min(1)).min(1).max(200) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const db = getDb();
  const userId = getRequestUserId(req);
  const result = await db
    .update(subscriptions)
    .set({ endedAt: new Date().toISOString() })
    .where(and(eq(subscriptions.userId, userId), isNull(subscriptions.endedAt), inArray(subscriptions.feedId, parsed.data.ids)));
  res.json({ deleted: result.count });
});

feedsRouter.delete("/:id", async (req, res) => {
  const db = getDb();
  const userId = getRequestUserId(req);
  const result = await db
    .update(subscriptions)
    .set({ endedAt: new Date().toISOString() })
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, req.params.id), isNull(subscriptions.endedAt)));
  if (result.count === 0) {
    res.status(404).json({ error: "订阅源不存在" });
    return;
  }
  res.json({ success: true });
});

feedsRouter.post("/sync", (req, res) => {
  const userId = getRequestUserId(req);
  syncUserFeeds(userId).catch((err) => {
    console.error("[feeds/sync] Background sync failed:", err);
  });
  res.json({ success: true, message: "同步任务已在后台启动" });
});

feedsRouter.post("/import", async (req, res) => {
  const parsed = importFeedsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { items } = parsed.data;

  const db = getDb();
  const userId = getRequestUserId(req);
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
      const parsedUrl = new URL(normalizedUrl);
      publicationUrl = parsedUrl.origin;
      feedUrl = `${publicationUrl}/feed`;
    } catch {
      skipped++;
      continue;
    }

    let [feed] = await db
      .select()
      .from(feeds)
      .where(eq(feeds.feedUrl, feedUrl));

    if (!feed) {
      const name = (item.name || publicationUrl).slice(0, 80);
      feed = {
        id: nanoid(),
        name,
        description: item.description || null,
        logoUrl: item.logoUrl || null,
        authorName: item.authorName || null,
        publicationUrl,
        feedUrl,
        sourceType: "substack" as const,
        createdAt: now,
        lastFetchedAt: null,
      };

      await db.insert(feeds).values(feed);
      newFeedIds.push(feed.id);
    }

    const [existingSubscription] = await db
      .select({ id: subscriptions.id, endedAt: subscriptions.endedAt })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, feed.id)))
      .orderBy(desc(subscriptions.createdAt));
    if (existingSubscription) {
      if (!existingSubscription.endedAt) {
        skipped++;
        continue;
      }

      await db
        .update(subscriptions)
        .set({
          startedAt: now,
          endedAt: null,
        })
        .where(eq(subscriptions.id, existingSubscription.id));
      created++;
      continue;
    }

    await db.insert(subscriptions).values({
      id: nanoid(),
      userId,
      feedId: feed.id,
      startedAt: now,
      createdAt: now,
    });
    created++;
  }

  res.status(201).json({ created, skipped });

  if (newFeedIds.length > 0) {
    (async () => {
      for (const feedId of newFeedIds) {
        try {
          await syncFeed(feedId);
        } catch (e) {
          console.error(`[feeds/import] Initial sync failed for feed ${feedId}:`, e);
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      try {
        const timezone = await getUserTimezone(userId);
        const today = getTimeZoneDateLabel(new Date(), timezone);
        await generateDaily(userId, getPreviousDateLabel(today));
      } catch (e) {
        console.error(`[feeds/import] Initial digest generation failed:`, e);
      }
    })();
  }
});
