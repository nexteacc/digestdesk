import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { clerkMiddleware, requireAuth } from "@clerk/express";
import { feedsRouter } from "./routes/feeds.js";
import { digestsRouter } from "./routes/digests.js";
import { substackRouter } from "./routes/substack.js";
import { rssFeedsRouter } from "./routes/rss-feeds.js";
import { youtubeFeedsRouter } from "./routes/youtube-feeds.js";
import { podcastFeedsRouter } from "./routes/podcast-feeds.js";
import { settingsRouter } from "./routes/settings.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { resolveUser } from "./middleware/resolve-user.js";
import { getDb, initDb } from "./db/index.js";
import { eq, desc, and, isNull, or, ilike } from "drizzle-orm";
import { digests, digestItems, feeds, subscriptions, users } from "./db/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 8080;
const isNonEmptyString = (value: string | undefined): value is string => Boolean(value);
const APP_URL = process.env.APP_URL?.trim();
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(isNonEmptyString);
const allowedOrigins = new Set([APP_URL, ...CORS_ALLOWED_ORIGINS].filter(isNonEmptyString));
const allowedOriginList = Array.from(allowedOrigins);

if (allowedOriginList.length > 0) {
  app.use(
    cors({
      origin: allowedOriginList,
      credentials: true,
    }),
  );
} else if (process.env.NODE_ENV !== "production") {
  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  );
}
app.use(express.json());
app.use(clerkMiddleware());

app.get("/api/public/digest", async (_req, res) => {
  const publisher = process.env.PUBLIC_DIGEST_USER_ID?.trim();
  if (!publisher) {
    res.json({ digests: [], currentDigest: null, feeds: [] });
    return;
  }

  const db = getDb();
  const publisherRows = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.id, publisher), eq(users.name, publisher), ilike(users.email, `${publisher}@%`)))
    .limit(2);

  if (publisherRows.length !== 1) {
    res.json({ digests: [], currentDigest: null, feeds: [] });
    return;
  }

  const userId = publisherRows[0].id;
  const [digest] = await db
    .select()
    .from(digests)
    .where(and(eq(digests.userId, userId), eq(digests.type, "daily")))
    .orderBy(desc(digests.date))
    .limit(1);

  if (!digest) {
    res.json({ digests: [], currentDigest: null, feeds: [] });
    return;
  }

  const [itemRows, feedRows] = await Promise.all([
    db.select().from(digestItems).where(eq(digestItems.digestId, digest.id)).orderBy(digestItems.sortOrder),
    db
      .select({ feed: feeds })
      .from(subscriptions)
      .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
      .where(and(eq(subscriptions.userId, userId), isNull(subscriptions.endedAt))),
  ]);

  res.json({
    digests: [{ id: digest.id, type: digest.type, date: digest.date, generatedAt: digest.generatedAt }],
    currentDigest: {
      id: digest.id,
      type: digest.type,
      date: digest.date,
      generatedAt: digest.generatedAt,
      items: itemRows.map((row) => ({
        id: row.id,
        feedId: row.feedId ?? undefined,
        sourceType: row.sourceType,
        feedTitle: row.feedName,
        title: row.articleTitle,
        author: row.author ?? undefined,
        url: row.url,
        oneLiner: row.oneLiner,
        keyInsights: JSON.parse(row.keyInsights),
        publishedAt: row.publishedAt,
      })),
    },
    feeds: feedRows.map(({ feed }) => ({
      id: feed.id,
      title: feed.name,
      description: feed.description ?? undefined,
      logoUrl: feed.logoUrl ?? undefined,
      authorName: feed.authorName ?? undefined,
      url: feed.publicationUrl,
      feedUrl: feed.feedUrl,
      sourceType: feed.sourceType,
      lastFetchedAt: feed.lastFetchedAt ?? undefined,
      createdAt: feed.createdAt,
    })),
  });
});

let ready = false;
let initError: string | null = null;

app.use("/api/auth", requireAuth(), authRouter);
app.use("/api/admin", requireAuth(), adminRouter);
app.use("/api/feeds", requireAuth(), resolveUser, feedsRouter);
app.use("/api/digests", requireAuth(), resolveUser, digestsRouter);
app.use("/api/substack", requireAuth(), resolveUser, substackRouter);
app.use("/api/rss-feeds", requireAuth(), resolveUser, rssFeedsRouter);
app.use("/api/youtube-feeds", requireAuth(), resolveUser, youtubeFeedsRouter);
app.use("/api/podcast-feeds", requireAuth(), resolveUser, podcastFeedsRouter);
app.use("/api/settings", requireAuth(), resolveUser, settingsRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/ready", (_req, res) => {
  if (ready) {
    res.json({ status: "ready", timestamp: new Date().toISOString() });
    return;
  }
  res.status(503).json({
    status: "starting",
    timestamp: new Date().toISOString(),
    error: initError ?? undefined,
  });
});

const frontendDist = path.resolve(__dirname, "../../dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get("/*path", (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

const startServer = async () => {
  try {
    console.log("Starting initialization...");
    await initDb();
    console.log("Database initialized.");
    ready = true;

    app.listen(Number(PORT), "0.0.0.0", () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    console.error("Fatal: Initialization failed:", err);
  }
};

startServer();
