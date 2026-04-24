import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { nanoid } from "nanoid";
import pLimit from "p-limit";
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
    console.log(
      `[digest-jobs] Dispatch scan user=${user.id} timezone=${timezone} digestTime=${digestTime} localToday=${localToday}`,
    );

    for (let offset = DISPATCH_BACKFILL_DAYS - 1; offset >= 0; offset -= 1) {
      const targetDate = shiftDateLabel(getPreviousDateLabel(localToday), -offset);
      const deliveryDate = shiftDateLabel(targetDate, 1);
      const scheduledFor = getScheduledTimeForDate(deliveryDate, digestTime, timezone);

      if (scheduledFor > now.toISOString()) {
        console.log(
          `[digest-jobs] Dispatch skip future user=${user.id} targetDate=${targetDate} scheduledFor=${scheduledFor}`,
        );
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
        console.log(
          `[digest-jobs] Dispatch existing user=${user.id} targetDate=${targetDate} jobId=${existingJob.id}`,
        );
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
        console.log(
          `[digest-jobs] Dispatch created user=${user.id} targetDate=${targetDate} jobId=${result[0].id} scheduledFor=${scheduledFor}`,
        );
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

  if (reclaimed.count > 0) {
    console.warn(`[digest-jobs] Reclaimed stale running jobs count=${reclaimed.count} staleBefore=${staleBefore}`);
  }
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
  console.log(
    `[digest-jobs] Runner candidate scan runnerId=${runnerId} now=${now.toISOString()} limit=${limit} candidates=${candidates.length}`,
  );

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
      console.log(
        `[digest-jobs] Claimed jobId=${candidate.id} user=${candidate.userId} targetDate=${candidate.targetDate} attempt=${candidate.attemptCount + 1} runnerId=${runnerId}`,
      );
    }
  }

  const summary = {
    claimed: claimed.length,
    succeeded: 0,
    skipped: 0,
    failed: 0,
  };

  const jobLimit = pLimit(3);
  const jobResults = await Promise.allSettled(
    claimed.map(job =>
      jobLimit(async () => {
        const jobStartedAt = Date.now();
        const digestId = await executeDailyDigestJob(job.userId, job.targetDate);
        console.log(
          digestId
            ? `[digest-jobs] Job done jobId=${job.id} user=${job.userId} targetDate=${job.targetDate} digestId=${digestId} durationMs=${Date.now() - jobStartedAt}`
            : `[digest-jobs] Job done (empty) jobId=${job.id} user=${job.userId} targetDate=${job.targetDate} durationMs=${Date.now() - jobStartedAt}`,
        );
        return digestId;
      }),
    ),
  );

  for (let i = 0; i < jobResults.length; i++) {
    const result = jobResults[i];
    const job = claimed[i];
    if (result.status === "fulfilled") {
      const digestId = result.value;
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
        console.log(`[digest-jobs] Job succeeded jobId=${job.id} user=${job.userId} targetDate=${job.targetDate} digestId=${digestId}`);
      } else {
        summary.skipped += 1;
        console.log(`[digest-jobs] Job skipped jobId=${job.id} user=${job.userId} targetDate=${job.targetDate} reason=empty_digest`);
      }
    } else {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
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
      console.error(`[digest-jobs] Job failed jobId=${job.id} user=${job.userId} targetDate=${job.targetDate} error=${message}`);
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
