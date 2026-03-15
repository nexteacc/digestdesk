import { Router } from "express";
import { nanoid } from "nanoid";
import { eq, desc } from "drizzle-orm";
import type { z } from "zod";
import { getDb } from "../db/index.js";
import { feeds } from "../db/schema.js";
import { syncFeed } from "../services/rss.js";
import { toAppError } from "../sources/app-error.js";
import type { SourceAdapter, SourceType } from "../sources/types.js";

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
      const info = await adapter.discover(parsed.data.url);
      res.json(info);
    } catch (err) {
      const appError = toAppError(err);
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

    try {
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
        res.status(409).json({ error: duplicateError });
        return;
      }

      const now = new Date().toISOString();
      const id = nanoid();

      await db.insert(feeds).values({
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

      syncFeed(id).catch((err) =>
        console.error(`${logPrefix} Initial sync failed for ${id}:`, err),
      );

      res.json({ id, success: true });
    } catch (err) {
      const appError = toAppError(err);
      console.error(`${logPrefix} Error adding feed:`, appError.message);
      res.status(appError.status).json({ error: appError.message, code: appError.code });
    }
  });

  router.get("/", async (_req, res) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(feeds)
      .where(eq(feeds.sourceType, sourceType))
      .orderBy(desc(feeds.createdAt));

    res.json(
      rows.map((row) => ({
        id: row.id,
        title: row.name,
        description: row.description,
        logoUrl: row.logoUrl,
        authorName: row.authorName,
        url: row.publicationUrl,
        feedUrl: row.feedUrl,
        sourceType: row.sourceType,
        lastFetchedAt: row.lastFetchedAt,
        createdAt: row.createdAt,
      })),
    );
  });

  return router;
}
