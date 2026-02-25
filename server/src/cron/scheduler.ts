import cron from "node-cron";
import { syncAllFeeds } from "../services/rss.js";
import { generateDaily, generateWeekly } from "../services/digest.js";

export function startScheduler() {
  const runDailyJob = async (reason: string) => {
    console.log(`[cron] ${reason}: Starting daily RSS sync...`);
    try {
      await syncAllFeeds();
      console.log(`[cron] ${reason}: RSS sync complete.`);
    } catch (err) {
      console.error(`[cron] ${reason}: RSS sync failed:`, err);
    }

    try {
      const today = new Date().toISOString().slice(0, 10);
      console.log(`[cron] ${reason}: Generating daily digest for ${today}...`);
      const digestId = await generateDaily(today);
      console.log(`[cron] ${reason}: Daily digest generated successfully: ${digestId}`);
    } catch (err) {
      console.error(`[cron] ${reason}: Daily digest generation failed or no new articles:`, err instanceof Error ? err.message : err);
    }

    const now = new Date();
    if (now.getDay() === 1) {
      console.log(`[cron] ${reason}: Monday detected, generating weekly digest...`);
      try {
        const weeklyId = await generateWeekly();
        console.log(`[cron] ${reason}: Weekly digest generated successfully: ${weeklyId}`);
      } catch (err) {
        console.error(`[cron] ${reason}: Weekly digest generation failed:`, err instanceof Error ? err.message : err);
      }
    }
  };

  setImmediate(() => runDailyJob("Startup"));

  cron.schedule("0 8 * * *", () => runDailyJob("Scheduled (08:00)"));

  console.log("Scheduler initialized: Run on startup + daily at 08:00");
}
