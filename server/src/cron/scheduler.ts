import cron from "node-cron";
import { dispatchDigestJobs, runPendingDigestJobs } from "../services/digest-jobs.js";
import {
  enqueueRecentArticleSummaryBackfill,
  getSummaryJobRunLimit,
  runPendingArticleSummaryJobs,
} from "../services/article-summary-jobs.js";
import { syncAllFeeds } from "../services/rss.js";

const DEFAULT_DISPATCH_CRON = "*/5 * * * *";
const DEFAULT_RUN_CRON = "* * * * *";
const DEFAULT_SUMMARY_RUN_CRON = "*/5 * * * *";
const DEFAULT_FEED_SYNC_CRON = "0 */4 * * *";
const DEFAULT_RUN_LIMIT = 20;
const DEFAULT_BACKFILL_LIMIT = 50;

let isDispatchRunning = false;
let isRunRunning = false;
let isSummaryRunRunning = false;
let isFeedSyncRunning = false;

function getDispatchCron() {
  return process.env.DIGEST_DISPATCH_CRON || DEFAULT_DISPATCH_CRON;
}

function getRunCron() {
  return process.env.DIGEST_RUN_CRON || DEFAULT_RUN_CRON;
}

function getSummaryRunCron() {
  return process.env.ARTICLE_SUMMARY_RUN_CRON || DEFAULT_SUMMARY_RUN_CRON;
}

function getFeedSyncCron() {
  return process.env.FEED_SYNC_CRON || DEFAULT_FEED_SYNC_CRON;
}

function getFeedSyncFreshnessWindowMs() {
  const raw = Number(process.env.FEED_SYNC_FRESHNESS_WINDOW_MS ?? 4 * 60 * 60 * 1000);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 4 * 60 * 60 * 1000;
}

function getRunLimit() {
  const raw = Number(process.env.DIGEST_JOB_RUN_LIMIT ?? DEFAULT_RUN_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_RUN_LIMIT;
}

function isArticleSummaryJobsEnabled() {
  return process.env.ENABLE_ARTICLE_SUMMARY_JOBS === "true";
}

function isBackgroundFeedSyncEnabled() {
  return process.env.ENABLE_BACKGROUND_FEED_SYNC === "true";
}

function isArticleSummaryBackfillEnabled() {
  return process.env.ENABLE_ARTICLE_SUMMARY_BACKFILL === "true";
}

function getBackfillLimit() {
  const raw = Number(process.env.ARTICLE_SUMMARY_BACKFILL_LIMIT ?? DEFAULT_BACKFILL_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_BACKFILL_LIMIT;
}

async function runDispatch(reason: string) {
  if (isDispatchRunning) {
    console.log(`[scheduler] Skip dispatch ${reason}: previous dispatch still running.`);
    return;
  }

  isDispatchRunning = true;
  const now = new Date();

  try {
    const dispatch = await dispatchDigestJobs(now);
    console.log(
      `[scheduler] Dispatch ${reason}: scannedUsers=${dispatch.scannedUsers} created=${dispatch.created} existing=${dispatch.existing}`,
    );
  } catch (error) {
    console.error(`[scheduler] Dispatch ${reason}:`, error);
  } finally {
    isDispatchRunning = false;
  }
}

async function runPending(reason: string) {
  if (isRunRunning) {
    console.log(`[scheduler] Skip runner ${reason}: previous runner still running.`);
    return;
  }

  isRunRunning = true;
  const now = new Date();

  try {
    const run = await runPendingDigestJobs({ now, limit: getRunLimit() });
    console.log(
      `[scheduler] Runner ${reason}: claimed=${run.claimed} succeeded=${run.succeeded} skipped=${run.skipped} failed=${run.failed}`,
    );
  } catch (error) {
    console.error(`[scheduler] Runner ${reason}:`, error);
  } finally {
    isRunRunning = false;
  }
}

async function runPendingSummaries(reason: string) {
  if (!isArticleSummaryJobsEnabled()) return;
  if (isSummaryRunRunning) {
    console.log(`[scheduler] Skip summary runner ${reason}: previous summary runner still running.`);
    return;
  }

  isSummaryRunRunning = true;
  const now = new Date();

  try {
    const run = await runPendingArticleSummaryJobs({ now, limit: getSummaryJobRunLimit() });
    console.log(
      `[scheduler] Summary runner ${reason}: claimed=${run.claimed} succeeded=${run.succeeded} skipped=${run.skipped} failed=${run.failed}`,
    );
  } catch (error) {
    console.error(`[scheduler] Summary runner ${reason}:`, error);
  } finally {
    isSummaryRunRunning = false;
  }
}

async function runFeedSync(reason: string) {
  if (!isBackgroundFeedSyncEnabled()) return;
  if (isFeedSyncRunning) {
    console.log(`[scheduler] Skip feed sync ${reason}: previous feed sync still running.`);
    return;
  }

  isFeedSyncRunning = true;
  const startedAt = Date.now();
  const freshnessWindowMs = getFeedSyncFreshnessWindowMs();

  try {
    await syncAllFeeds({ freshnessWindowMs });
    console.log(`[scheduler] Feed sync ${reason}: succeeded durationMs=${Date.now() - startedAt}`);
  } catch (error) {
    console.error(`[scheduler] Feed sync ${reason}:`, error);
  } finally {
    isFeedSyncRunning = false;
  }
}

async function runSummaryBackfill(reason: string) {
  if (!isArticleSummaryJobsEnabled() || !isArticleSummaryBackfillEnabled()) return;

  try {
    const result = await enqueueRecentArticleSummaryBackfill({
      limit: getBackfillLimit(),
      reason,
    });
    console.log(
      `[scheduler] Summary backfill ${reason}: scanned=${result.scannedArticles} created=${result.created} existing=${result.existing} requeued=${result.requeued}`,
    );
  } catch (error) {
    console.error(`[scheduler] Summary backfill ${reason}:`, error);
  }
}

export function startScheduler() {
  const enabled = process.env.ENABLE_SCHEDULER_SERVICE !== "false";

  if (!enabled) {
    console.log("[scheduler] Disabled by ENABLE_SCHEDULER_SERVICE=false");
    return;
  }

  void runDispatch("Startup catch-up");
  void runPending("Startup catch-up");
  void runPendingSummaries("Startup catch-up");
  void runSummaryBackfill("Startup catch-up");

  cron.schedule(getDispatchCron(), () => {
    void runDispatch("Scheduled tick");
  });
  cron.schedule(getRunCron(), () => {
    void runPending("Scheduled tick");
  });
  cron.schedule(getSummaryRunCron(), () => {
    void runPendingSummaries("Scheduled tick");
  });
  cron.schedule(getFeedSyncCron(), () => {
    void runFeedSync("Scheduled tick");
  });

  console.log(
    `[scheduler] Initialized: dispatchCron="${getDispatchCron()}", runCron="${getRunCron()}", runLimit=${getRunLimit()}, summaryRunCron="${getSummaryRunCron()}", summaryRunLimit=${getSummaryJobRunLimit()}, feedSyncCron="${getFeedSyncCron()}", articleSummaryJobsEnabled=${isArticleSummaryJobsEnabled()}, backgroundFeedSyncEnabled=${isBackgroundFeedSyncEnabled()}, articleSummaryBackfillEnabled=${isArticleSummaryBackfillEnabled()}, mode=digest_jobs+article_summary_jobs`,
  );
}
