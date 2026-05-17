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
import { initDb } from "./db/index.js";

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
