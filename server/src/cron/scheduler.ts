import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import { syncAllFeeds } from "../services/rss.js";
import { generateDaily } from "../services/digest.js";
import { getDb } from "../db/index.js";
import { settings } from "../db/schema.js";

let digestTask: ScheduledTask | null = null;

async function runSyncJob(reason: string) {
  console.log(`[cron] ${reason}: Starting RSS sync and AI pre-processing...`);
  try {
    await syncAllFeeds();
    console.log(`[cron] ${reason}: RSS sync and pre-processing complete.`);
  } catch (err) {
    console.error(`[cron] ${reason}: RSS sync failed:`, err);
  }
}

async function runDigestJob(reason: string) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    console.log(`[cron] ${reason}: Generating daily digest for ${today}...`);
    const digestId = await generateDaily(today);
    console.log(`[cron] Daily digest generated successfully: ${digestId}`);
  } catch (err) {
    console.error(`[cron] ${reason}: Daily digest generation failed or no new articles:`, err instanceof Error ? err.message : err);
  }
}

function scheduleDigestJob(timeStr: string, timezone: string) {
  if (digestTask) {
    digestTask.stop();
  }

  const [hour, minute] = timeStr.split(":").map(Number);
  const cronExpr = `${minute} ${hour} * * *`;

  digestTask = cron.schedule(cronExpr, () => {
    runDigestJob(`Scheduled (${timeStr} Delivery)`).catch(err => {
      console.error("[cron] Delivery job failed:", err);
    });
  }, {
    timezone: timezone
  });

  console.log(`[cron] Digest job scheduled for ${timeStr} (${timezone})`);
}

export async function startScheduler() {
  const db = getDb();
  const rows = await db.select().from(settings);
  const config: Record<string, string> = {};
  rows.forEach(row => { config[row.key] = row.value; });

  const initialTime = config.digest_time || "08:00";
  const initialTimezone = config.timezone || "Asia/Shanghai";

  cron.schedule("0 */4 * * *", () => {
    runSyncJob("Scheduled (Every 4h)").catch(err => {
      console.error("[cron] Sync job failed:", err);
    });
  });

  scheduleDigestJob(initialTime, initialTimezone);

  console.log(`Scheduler initialized: Sync every 4h, Delivery daily at ${initialTime} (${initialTimezone})`);
}

export function restartDigestJob(timeStr: string, timezone: string) {
  console.log(`[cron] Rescheduling digest job to ${timeStr} (${timezone})...`);
  scheduleDigestJob(timeStr, timezone);
}
