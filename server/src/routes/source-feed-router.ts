import { Router } from "express";
import { nanoid } from "nanoid";
import { eq, desc, and, isNull } from "drizzle-orm";
import type { z } from "zod";
import { getDb } from "../db/index.js";
import { feeds, subscriptions } from "../db/schema.js";
import { syncFeed } from "../services/rss.js";
import { toAppError } from "../sources/app-error.js";
import type { SourceAdapter, SourceType } from "../sources/types.js";
import { getRequestUserId } from "../auth/user-context.js";
import { getUserTimezone } from "../services/user-settings.js";
import { getPreviousDateLabel, getTimeZoneDateLabel } from "../utils/timezone.js";
import { generateDaily } from "../services/digest.js";

interface SourceFeedRouterOptions {
  adapter: SourceAdapter;
  discoverSchema: z.ZodSchema<{ url: string }>;
  createSchema: z.ZodSchema;
  sourceType: SourceType;
  logPrefix: string;
  duplicateError?: string;
}

function sanitizeUrl(url: string): string {
  return url
    .trim()
    .replace(/^`+|`+$/g, "")
    .replace(/[)\]:;.,]+$/g, "");
}

async function triggerInitialSyncAndDigest(userId: string, feedId: string, logPrefix: string) {
  console.log(`${logPrefix} Initial sync requested for user=${userId} feed=${feedId}`);
  const newCount = await syncFeed(feedId);
  console.log(`${logPrefix} Initial sync complete for user=${userId} feed=${feedId} newArticles=${newCount}`);

  const timezone = await getUserTimezone(userId);
  const today = getTimeZoneDateLabel(new Date(), timezone);
  const targetDate = getPreviousDateLabel(today);
  const digestId = await generateDaily(userId, targetDate);

  if (!digestId) {
    console.log(`${logPrefix} Initial digest result empty for user=${userId} feed=${feedId} date=${targetDate}`);
    return;
  }

  console.log(`${logPrefix} Initial digest generated for user=${userId} feed=${feedId} date=${targetDate} digestId=${digestId}`);
}

export function createSourceFeedRouter(opts: SourceFeedRouterOptions): Router {
  const router = Router();
  const {
    adapter,
    discoverSchema,
    createSchema,
    sourceType,
    logPrefix,
    duplicateError = "该订阅源已存在",
  } = opts;

  router.post("/discover", async (req, res) => {
    const parsed = discoverSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    try {
      console.log(`${logPrefix} Discover request:`, parsed.data.url);
      const info = await adapter.discover(parsed.data.url);
      console.log(`${logPrefix} Discover success:`, info);
      res.json(info);
    } catch (err) {
      const appError = toAppError(err);
      console.error(`${logPrefix} Discover failed:`, appError.message);
      res.status(appError.status).json({ error: appError.message, code: appError.code });
    }
  });

  router.post("/", async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "数据格式不正确" });
      return;
    }

    const db = getDb();
    const userId = getRequestUserId(req);

    try {
      console.log(`${logPrefix} Create request received for user=${userId}`);
      const rawDraft = await Promise.resolve(
        adapter.createFeedDraft(parsed.data as Record<string, unknown>),
      );
      const draft = {
        ...rawDraft,
        publicationUrl: sanitizeUrl(rawDraft.publicationUrl),
        feedUrl: sanitizeUrl(rawDraft.feedUrl),
      };

      const [existing] = await db
        .select()
        .from(feeds)
        .where(eq(feeds.feedUrl, draft.feedUrl));
      if (existing) {
        console.log(`${logPrefix} Reusing existing feed id=${existing.id} for user=${userId}`);
        const [existingSubscription] = await db
          .select({ id: subscriptions.id, endedAt: subscriptions.endedAt })
          .from(subscriptions)
          .where(and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, existing.id)))
          .orderBy(desc(subscriptions.createdAt));
        if (existingSubscription) {
          if (!existingSubscription.endedAt) {
            console.warn(`${logPrefix} Duplicate active subscription for user=${userId} feed=${existing.id}`);
            res.status(409).json({ error: duplicateError });
            return;
          }

          const now = new Date().toISOString();
          await db
            .update(subscriptions)
            .set({
              startedAt: now,
              endedAt: null,
            })
            .where(eq(subscriptions.id, existingSubscription.id));

          void triggerInitialSyncAndDigest(userId, existing.id, logPrefix).catch((err) =>
            console.error(`${logPrefix} Initial sync/digest failed for reused subscription feed=${existing.id}:`, err),
          );

          res.status(201).json({ id: existing.id, success: true });
          return;
        }

        const now = new Date().toISOString();
        await db.insert(subscriptions).values({
          id: nanoid(),
          userId,
          feedId: existing.id,
          startedAt: now,
          createdAt: now,
        });

        void triggerInitialSyncAndDigest(userId, existing.id, logPrefix).catch((err) =>
          console.error(`${logPrefix} Initial sync/digest failed for newly linked existing feed=${existing.id}:`, err),
        );

        res.status(201).json({ id: existing.id, success: true });
        return;
      }

      const now = new Date().toISOString();
      const id = nanoid();

      await db.transaction(async (tx) => {
        await tx.insert(feeds).values({
          id,
          name: draft.name,
          description: draft.description,
          logoUrl: draft.logoUrl,
          authorName: draft.authorName,
          publicationUrl: draft.publicationUrl,
          feedUrl: draft.feedUrl,
          sourceType,
          createdAt: now,
        });
        await tx.insert(subscriptions).values({
          id: nanoid(),
          userId,
          feedId: id,
          startedAt: now,
          createdAt: now,
        });
      });

      syncFeed(id)
        .then(async () => {
          console.log(`${logPrefix} Initial sync complete for new feed user=${userId} feed=${id}`);
          const timezone = await getUserTimezone(userId);
          const today = getTimeZoneDateLabel(new Date(), timezone);
          const targetDate = getPreviousDateLabel(today);
          const digestId = await generateDaily(userId, targetDate);
          if (!digestId) {
            console.log(`${logPrefix} Initial digest result empty for new feed user=${userId} feed=${id} date=${targetDate}`);
            return;
          }
          console.log(`${logPrefix} Initial digest generated for new feed user=${userId} feed=${id} date=${targetDate} digestId=${digestId}`);
        })
        .catch((err) =>
          console.error(`${logPrefix} Initial sync/digest failed for ${id}:`, err),
        );

      res.json({ id, success: true });
    } catch (err) {
      const appError = toAppError(err);
      console.error(`${logPrefix} Error adding feed:`, appError.message);
      res.status(appError.status).json({ error: appError.message, code: appError.code });
    }
  });

  router.get("/", async (req, res) => {
    const db = getDb();
    const userId = getRequestUserId(req);
    const rows = await db
      .select({ feed: feeds })
      .from(subscriptions)
      .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
      .where(and(eq(subscriptions.userId, userId), isNull(subscriptions.endedAt), eq(feeds.sourceType, sourceType)))
      .orderBy(desc(feeds.createdAt));

    console.log(`${logPrefix} List request for user=${userId}: ${rows.length} active feeds`);

    res.json(
      rows.map(({ feed }) => ({
        id: feed.id,
        title: feed.name,
        description: feed.description,
        logoUrl: feed.logoUrl,
        authorName: feed.authorName,
        url: feed.publicationUrl,
        feedUrl: feed.feedUrl,
        sourceType: feed.sourceType,
        lastFetchedAt: feed.lastFetchedAt,
        createdAt: feed.createdAt,
      })),
    );
  });

  return router;
}
