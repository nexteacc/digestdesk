import { and, eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { digests } from "../db/schema.js";
import { generateDaily } from "./digest.js";
import { syncUserFeeds } from "./rss.js";

export async function executeDailyDigestJob(
  userId: string,
  targetDate?: string,
  options?: { force?: boolean },
) {
  const db = getDb();

  if (options?.force && targetDate) {
    await db
      .delete(digests)
      .where(and(eq(digests.userId, userId), eq(digests.type, "daily"), eq(digests.date, targetDate)));
  }

  await syncUserFeeds(userId);
  return generateDaily(userId, targetDate);
}
