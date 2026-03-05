import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { feedsRouter } from "./routes/feeds.js";
import { digestsRouter } from "./routes/digests.js";
import { substackRouter } from "./routes/substack.js";
import { initDb } from "./db/index.js";
import { startScheduler } from "./cron/scheduler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

let ready = false;
let initError: string | null = null;

app.use("/api/feeds", feedsRouter);
app.use("/api/digests", digestsRouter);
app.use("/api/substack", substackRouter);

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

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);

  setTimeout(() => {
    try {
      console.log("Starting initialization...");
      initDb();
      console.log("Database initialized.");

      startScheduler();
      console.log("Scheduler started.");
      ready = true;
    } catch (err) {
      initError = err instanceof Error ? err.message : String(err);
      console.error("Fatal: Initialization failed:", err);
    }
  }, 0);
});
