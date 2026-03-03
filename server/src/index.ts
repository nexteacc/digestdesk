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

// initDb() moved to listen callback to prevent startup blocking

app.use("/api/feeds", feedsRouter);
app.use("/api/digests", digestsRouter);
app.use("/api/substack", substackRouter);

app.get("/api/health", (_req, res) => {
  // 健康检查端点，尽量简单快速
  res.json({ status: "ok", timestamp: new Date().toISOString() });
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

  // 在端口监听后再执行初始化任务，避免阻塞启动探针（TCP Connect）
  try {
    console.log("Starting initialization...");
    initDb(); // 虽然是同步操作，但此时端口已由 OS 接管，TCP 连接可建立
    console.log("Database initialized.");
    
    startScheduler();
    console.log("Scheduler started.");
  } catch (err) {
    console.error("Fatal: Initialization failed:", err);
  }
});
