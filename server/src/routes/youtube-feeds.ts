import { Router } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getYouTubeAdapter } from "../sources/factory.js";
import { createSourceFeedRouter } from "./source-feed-router.js";
import {
  fetchGoogleYouTubeSubscriptions,
  hasYouTubeReadonlyScope,
} from "../services/google-youtube.js";
import { getDb } from "../db/index.js";
import { feeds, subscriptions } from "../db/schema.js";
import { getRequestUserId } from "../auth/user-context.js";
import { resolveYouTubeChannelPresentation } from "../services/youtube-discovery.js";

const discoverSchema = z.object({
  url: z.string().trim().min(1, "请输入有效的 YouTube URL"),
});

const createYouTubeFeedSchema = z.object({
  channelId: z
    .string()
    .trim()
    .regex(/^UC[a-zA-Z0-9_-]{22}$/, "channelId 格式不正确"),
  title: z.string().min(1),
  logoUrl: z.string().optional(),
});

const baseRouter = createSourceFeedRouter({
  adapter: getYouTubeAdapter(),
  discoverSchema,
  createSchema: createYouTubeFeedSchema,
  sourceType: "youtube",
  logPrefix: "[youtube]",
  duplicateError: "该频道已订阅",
});

export const youtubeFeedsRouter = Router();
const googleYouTubeImportEnabled = process.env.ENABLE_GOOGLE_YOUTUBE_IMPORT === "true";

youtubeFeedsRouter.get("/", async (req, res) => {
  const db = getDb();
  const userId = getRequestUserId(req);
  const rows = await db
    .select({ feed: feeds })
    .from(subscriptions)
    .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
    .where(and(eq(subscriptions.userId, userId), isNull(subscriptions.endedAt), eq(feeds.sourceType, "youtube")))
    .orderBy(desc(feeds.createdAt));

  const normalizedFeeds = await Promise.all(
    rows.map(async ({ feed }) => {
      if (feed.name && feed.name !== "Videos") {
        return feed;
      }

      const presentation = await resolveYouTubeChannelPresentation(feed.publicationUrl, feed.feedUrl);
      const nextName = presentation.title || feed.name;
      const nextLogoUrl = presentation.logoUrl || feed.logoUrl;

      if (nextName !== feed.name || nextLogoUrl !== feed.logoUrl) {
        await db
          .update(feeds)
          .set({
            name: nextName,
            logoUrl: nextLogoUrl,
          })
          .where(eq(feeds.id, feed.id));
      }

      return {
        ...feed,
        name: nextName,
        logoUrl: nextLogoUrl,
      };
    }),
  );

  res.json(
    normalizedFeeds.map((feed) => ({
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

youtubeFeedsRouter.get("/google-subscriptions", async (req, res) => {
  if (!googleYouTubeImportEnabled) {
    res.status(403).json({
      error: "Google YouTube 导入功能暂未开放",
      code: "GOOGLE_YOUTUBE_IMPORT_DISABLED",
    });
    return;
  }

  const auth = getAuth(req);
  const clerkUserId = auth.userId;

  if (!clerkUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const oauthTokens = await clerkClient.users.getUserOauthAccessToken(clerkUserId, "google");
    const usableToken = oauthTokens.data.find(
      (token) => token.token && hasYouTubeReadonlyScope(token.scopes),
    );

    if (!usableToken?.token) {
      res.status(403).json({
        error: "需要重新授权 Google，允许读取 YouTube 订阅列表",
        code: "GOOGLE_YOUTUBE_REAUTH_REQUIRED",
      });
      return;
    }

    const items = await fetchGoogleYouTubeSubscriptions(usableToken.token);
    res.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[youtube] Failed to fetch Google subscriptions:", message);
    res.status(502).json({
      error: "读取 YouTube 订阅列表失败，请稍后重试",
      code: "GOOGLE_YOUTUBE_FETCH_FAILED",
    });
  }
});

youtubeFeedsRouter.use("/", baseRouter);
