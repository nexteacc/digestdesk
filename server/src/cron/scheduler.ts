import cron from "node-cron";
import { and, eq } from "drizzle-orm";
import { syncAllFeeds } from "../services/rss.js";
import { generateDaily } from "../services/digest.js";
import { getDb } from "../db/index.js";
import { digests, userSettings, users } from "../db/schema.js";
import { getPreviousDateLabel, getTimeZoneClock } from "../utils/timezone.js";

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
    const db = getDb();
    const allUsers = await db.select({ id: users.id }).from(users);

    for (const user of allUsers) {
      const rows = await db
        .select({ key: userSettings.key, value: userSettings.value })
        .from(userSettings)
        .where(eq(userSettings.userId, user.id));
      const config = Object.fromEntries(rows.map((row) => [row.key, row.value]));
      const timezone = config.timezone || "Asia/Shanghai";
      const digestTime = config.digest_time || "08:00";
      const now = new Date();
      const { dateLabel, timeLabel } = getTimeZoneClock(now, timezone);
      const digestDate = getPreviousDateLabel(dateLabel);

      if (timeLabel !== digestTime) {
        continue;
      }

      const [existing] = await db
        .select({ id: digests.id })
        .from(digests)
        .where(and(eq(digests.userId, user.id), eq(digests.type, "daily"), eq(digests.date, digestDate)));
      if (existing) {
        continue;
      }

      console.log(`[cron] ${reason}: Generating daily digest for user ${user.id} on ${digestDate}...`);
      const digestId = await generateDaily(user.id, digestDate);
      console.log(`[cron] Daily digest generated successfully for user ${user.id}: ${digestId}`);
    }
  } catch (err) {
    console.error(`[cron] ${reason}: Daily digest generation failed or no new articles:`, err instanceof Error ? err.message : err);
  }
}

export async function startScheduler() {
  cron.schedule("0 */4 * * *", () => {
    runSyncJob("Scheduled (Every 4h)").catch(err => {
      console.error("[cron] Sync job failed:", err);
    });
  });

  cron.schedule("* * * * *", () => {
    runDigestJob("Scheduled (Per-user Delivery)").catch(err => {
      console.error("[cron] Delivery job failed:", err);
    });
  });

  console.log("Scheduler initialized: Sync every 4h, user digests checked every minute");
}

export function restartDigestJob() {
  console.log("[cron] Scheduler uses live user settings; no restart required.");
}
