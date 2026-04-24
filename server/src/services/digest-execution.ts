import { and, eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { digests } from "../db/schema.js";
import { generateDaily } from "./digest.js";
import { presummarizeForUser } from "./presummarize.js";
import { syncUserFeeds } from "./rss.js";

export async function executeDailyDigestJob(
  userId: string,
  targetDate?: string,
  options?: { force?: boolean },
) {
  const startedAt = Date.now();
  const db = getDb();
  console.log(
    `[digest-execution] Start user=${userId} targetDate=${targetDate ?? "auto"} force=${Boolean(options?.force)}`,
  );

  if (options?.force && targetDate) {
    await db
      .delete(digests)
      .where(and(eq(digests.userId, userId), eq(digests.type, "daily"), eq(digests.date, targetDate)));
  }

  // Step 1: Sync feeds (fetch new articles, no AI)
  await syncUserFeeds(userId);

  // Step 2: Pre-generate summaries for articles in the target date range.
  // Runs after sync so new articles are already in the DB.
  // Uses the user's language setting so the cache is always correct.
  // generateDaily() will hit the cache and complete near-instantly.
  await presummarizeForUser(userId, targetDate);

  // Step 3: Assemble and persist the digest (reads from cache, no AI calls)
  const digestId = await generateDaily(userId, targetDate);
  console.log(
    `[digest-execution] Complete user=${userId} targetDate=${targetDate ?? "auto"} digestId=${digestId || "empty"} durationMs=${Date.now() - startedAt}`,
  );
  return digestId;
}
