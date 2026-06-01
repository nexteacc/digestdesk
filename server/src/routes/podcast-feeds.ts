import { Router } from "express";
import { nanoid } from "nanoid";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { feeds, subscriptions } from "../db/schema.js";
import { getPodcastAdapter } from "../sources/factory.js";
import { getRequestUserId } from "../auth/user-context.js";
import { searchPodcasts, verifyPodcastFeed } from "../services/podcast-discovery.js";
import { queueInitialDigestForUser } from "../services/initial-digest-trigger.js";
import { toAppError } from "../sources/app-error.js";
import { assertCanAddSubscriptions, sendEntitlementError } from "../services/entitlements.js";
import { discoverSearchLimiter } from "../middleware/rate-limit.js";

const searchSchema = z.object({
  query: z.string().trim().min(1, "请输入播客节目名"),
});

const createPodcastFeedSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional(),
  logoUrl: z.string().optional(),
  authorName: z.string().optional(),
  feedUrl: z.string().url(),
  siteUrl: z.string().url(),
});

function sanitizeUrl(url: string): string {
  return url
    .trim()
    .replace(/^`+|`+$/g, "")
    .replace(/[)\]:;.,]+$/g, "");
}

export const podcastFeedsRouter = Router();
const podcastAdapter = getPodcastAdapter();

podcastFeedsRouter.get("/search", discoverSearchLimiter, async (req, res) => {
  const parsed = searchSchema.safeParse({ query: req.query.query });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  try {
    const results = await searchPodcasts(parsed.data.query);
    res.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "播客搜索失败";
    console.error("[podcast/search] Error:", message);
    res.status(502).json({ error: "Podcast search failed. Try again later.", errorZh: "播客搜索失败，请稍后重试", code: "PODCAST_SEARCH_FAILED" });
  }
});

podcastFeedsRouter.post("/", async (req, res) => {
  const parsed = createPodcastFeedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request data.", errorZh: "数据格式不正确" });
    return;
  }

  const db = getDb();
  const userId = getRequestUserId(req);

  try {
    const verified = await verifyPodcastFeed({
      title: parsed.data.title,
      authorName: parsed.data.authorName || "",
      description: parsed.data.description || "",
      logoUrl: parsed.data.logoUrl || "",
      feedUrl: parsed.data.feedUrl,
      siteUrl: parsed.data.siteUrl,
    });

    if (!verified) {
      res.status(400).json({ error: "Could not verify podcast feed. Try again later.", errorZh: "播客 RSS 无法验证，请稍后重试", code: "INVALID_PODCAST_FEED" });
      return;
    }

    const rawDraft = podcastAdapter.createFeedDraft(verified);
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
      const [existingSubscription] = await db
        .select({ id: subscriptions.id, endedAt: subscriptions.endedAt })
        .from(subscriptions)
        .where(and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, existing.id)))
        .orderBy(desc(subscriptions.createdAt));

      if (existingSubscription) {
        if (!existingSubscription.endedAt) {
          res.status(409).json({ error: "Podcast already subscribed.", errorZh: "该播客已订阅" });
          return;
        }

        const now = new Date().toISOString();
        await assertCanAddSubscriptions(userId, 1);
        await db
          .update(subscriptions)
          .set({ startedAt: now, endedAt: null })
          .where(eq(subscriptions.id, existingSubscription.id));

        void queueInitialDigestForUser(userId, { feedId: existing.id, logContext: "podcast" }).catch((error) =>
          console.error(`[podcast] Initial sync/digest failed for reused feed=${existing.id}:`, error),
        );

        res.status(201).json({ id: existing.id, success: true });
        return;
      }

      const now = new Date().toISOString();
      await assertCanAddSubscriptions(userId, 1);
      await db.insert(subscriptions).values({
        id: nanoid(),
        userId,
        feedId: existing.id,
        startedAt: now,
        createdAt: now,
      });

      void queueInitialDigestForUser(userId, { feedId: existing.id, logContext: "podcast" }).catch((error) =>
        console.error(`[podcast] Initial sync/digest failed for existing feed=${existing.id}:`, error),
      );

      res.status(201).json({ id: existing.id, success: true });
      return;
    }

    const now = new Date().toISOString();
    const id = nanoid();
    await assertCanAddSubscriptions(userId, 1);

    await db.transaction(async (tx) => {
      await tx.insert(feeds).values({
        id,
        name: draft.name,
        description: draft.description,
        logoUrl: draft.logoUrl,
        authorName: draft.authorName,
        publicationUrl: draft.publicationUrl,
        feedUrl: draft.feedUrl,
        sourceType: "podcast",
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

    void queueInitialDigestForUser(userId, { feedId: id, logContext: "podcast" }).catch((error) =>
      console.error(`[podcast] Initial sync/digest failed for new feed=${id}:`, error),
    );

    res.status(201).json({ id, success: true });
  } catch (error) {
    if (sendEntitlementError(res, error)) return;
    const appError = toAppError(error);
    console.error("[podcast/create] Error:", appError.message);
    res.status(appError.status).json({ error: appError.message, errorZh: appError.messageZh, code: appError.code });
  }
});

podcastFeedsRouter.get("/", async (req, res) => {
  const db = getDb();
  const userId = getRequestUserId(req);
  const rows = await db
    .select({ feed: feeds })
    .from(subscriptions)
    .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
    .where(and(eq(subscriptions.userId, userId), isNull(subscriptions.endedAt), eq(feeds.sourceType, "podcast")))
    .orderBy(desc(feeds.createdAt));

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
