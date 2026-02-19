import cron from "node-cron";
import { syncAllFeeds } from "../services/rss.js";
import { generateDaily } from "../services/digest.js";

export function startScheduler() {
  // 每天 8:00 抓取 RSS，同步后自动生成今日日报
  cron.schedule("0 8 * * *", async () => {
    console.log("[cron] Starting daily RSS sync...");
    try {
      await syncAllFeeds();
      console.log("[cron] RSS sync complete.");
    } catch (err) {
      console.error("[cron] RSS sync failed:", err);
    }

    // 同步后自动生成今日日报（幂等，已有则跳过）
    try {
      const today = new Date().toISOString().slice(0, 10);
      await generateDaily(today);
    } catch {
      // 没有文章等情况静默跳过
    }
  });

  console.log("Scheduler started: RSS sync + daily digest at 08:00 every day");
}
