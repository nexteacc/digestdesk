import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../db/index.js";
import { digestJobs, userSettings, users } from "../db/schema.js";
import {
  getPreviousDateLabel,
  getScheduledTimeForDate,
  getTimeZoneDateLabel,
  shiftDateLabel,
} from "../utils/timezone.js";
import { executeDailyDigestJob } from "./digest-execution.js";

const JOB_TYPE = "daily_digest" as const;
const DISPATCH_BACKFILL_DAYS = 3;
const DEFAULT_DIGEST_TIME = "08:00";
const DEFAULT_TIMEZONE = "Asia/Shanghai";
const STALE_RUNNING_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 3;

function getRunnerId() {
  return `${process.pid}-${nanoid(6)}`;
}

export async function dispatchDigestJobs(now = new Date()) {
  const db = getDb();
  const allUsers = await db.select({ id: users.id }).from(users);
  let created = 0;
  let existing = 0;

  for (const user of allUsers) {
    const rows = await db
      .select({ key: userSettings.key, value: userSettings.value })
      .from(userSettings)
      .where(eq(userSettings.userId, user.id));
    const config = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    const timezone = config.timezone || DEFAULT_TIMEZONE;
    const digestTime = config.digest_time || DEFAULT_DIGEST_TIME;
    const localToday = getTimeZoneDateLabel(now, timezone);

    for (let offset = DISPATCH_BACKFILL_DAYS - 1; offset >= 0; offset -= 1) {
      const targetDate = shiftDateLabel(getPreviousDateLabel(localToday), -offset);
      const deliveryDate = shiftDateLabel(targetDate, 1);
      const scheduledFor = getScheduledTimeForDate(deliveryDate, digestTime, timezone);

      if (scheduledFor > now.toISOString()) {
        continue;
      }

      const [existingJob] = await db
        .select({ id: digestJobs.id })
        .from(digestJobs)
        .where(
          and(
            eq(digestJobs.userId, user.id),
            eq(digestJobs.jobType, JOB_TYPE),
            eq(digestJobs.targetDate, targetDate),
          ),
        );

      if (existingJob) {
        existing += 1;
        continue;
      }

      const result = await db
        .insert(digestJobs)
        .values({
          id: nanoid(),
          userId: user.id,
          jobType: JOB_TYPE,
          targetDate,
          scheduledFor,
          status: "pending",
          attemptCount: 0,
          createdAt: now.toISOString(),
        })
        .onConflictDoNothing({
          target: [digestJobs.userId, digestJobs.jobType, digestJobs.targetDate],
        })
        .returning({ id: digestJobs.id });

      if (result.length > 0) {
        created += 1;
      } else {
        existing += 1;
      }
    }
  }

  return { created, existing, scannedUsers: allUsers.length };
}

export async function reclaimStaleDigestJobs(now = new Date()) {
  const db = getDb();
  const staleBefore = new Date(now.getTime() - STALE_RUNNING_MS).toISOString();
  const reclaimed = await db
    .update(digestJobs)
    .set({
      status: "pending",
      lockedAt: null,
      lockedBy: null,
      startedAt: null,
      lastError: "Reclaimed after stale running lock.",
    })
    .where(and(eq(digestJobs.status, "running"), lte(digestJobs.lockedAt, staleBefore)));

  return reclaimed.count;
}

export async function runPendingDigestJobs(options?: { limit?: number; now?: Date }) {
  const db = getDb();
  const limit = options?.limit ?? 5;
  const now = options?.now ?? new Date();
  const runnerId = getRunnerId();

  await reclaimStaleDigestJobs(now);

  const candidates = await db
    .select({
      id: digestJobs.id,
      userId: digestJobs.userId,
      targetDate: digestJobs.targetDate,
      attemptCount: digestJobs.attemptCount,
    })
    .from(digestJobs)
    .where(
      and(
        eq(digestJobs.jobType, JOB_TYPE),
        inArray(digestJobs.status, ["pending", "failed"]),
        lte(digestJobs.scheduledFor, now.toISOString()),
        lte(digestJobs.attemptCount, MAX_ATTEMPTS - 1),
      ),
    )
    .orderBy(asc(digestJobs.scheduledFor))
    .limit(limit);

  const claimed: Array<{ id: string; userId: string; targetDate: string; attemptCount: number }> = [];

  for (const candidate of candidates) {
    const result = await db
      .update(digestJobs)
      .set({
        status: "running",
        lockedAt: now.toISOString(),
        lockedBy: runnerId,
        startedAt: now.toISOString(),
      })
      .where(and(eq(digestJobs.id, candidate.id), inArray(digestJobs.status, ["pending", "failed"])));

    if (result.count > 0) {
      claimed.push(candidate);
    }
  }

  const summary = {
    claimed: claimed.length,
    succeeded: 0,
    skipped: 0,
    failed: 0,
  };

  for (const job of claimed) {
    try {
      const digestId = await executeDailyDigestJob(job.userId, job.targetDate);
      await db
        .update(digestJobs)
        .set({
          status: digestId ? "succeeded" : "skipped",
          attemptCount: job.attemptCount + 1,
          lastError: null,
          finishedAt: new Date().toISOString(),
          lockedAt: null,
          lockedBy: null,
        })
        .where(eq(digestJobs.id, job.id));

      if (digestId) {
        summary.succeeded += 1;
      } else {
        summary.skipped += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(digestJobs)
        .set({
          status: "failed",
          attemptCount: job.attemptCount + 1,
          lastError: message,
          finishedAt: new Date().toISOString(),
          lockedAt: null,
          lockedBy: null,
        })
        .where(eq(digestJobs.id, job.id));
      summary.failed += 1;
    }
  }

  return summary;
}

export async function cancelPendingDigestJobsForDate(userId: string, targetDate: string) {
  const db = getDb();
  return db
    .update(digestJobs)
    .set({
      status: "cancelled",
      finishedAt: new Date().toISOString(),
      lockedAt: null,
      lockedBy: null,
    })
    .where(
      and(
        eq(digestJobs.userId, userId),
        eq(digestJobs.jobType, JOB_TYPE),
        eq(digestJobs.targetDate, targetDate),
        inArray(digestJobs.status, ["pending", "failed"]),
      ),
    );
}
