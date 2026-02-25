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

initDb();

app.use("/api/feeds", feedsRouter);
app.use("/api/digests", digestsRouter);
app.use("/api/substack", substackRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

const frontendDist = path.resolve(__dirname, "../../dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get("/*path", (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startScheduler();
});
