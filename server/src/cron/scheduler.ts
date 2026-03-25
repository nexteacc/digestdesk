import cron from "node-cron";
import { dispatchDigestJobs, runPendingDigestJobs } from "../services/digest-jobs.js";

const DEFAULT_DISPATCH_CRON = "*/5 * * * *";
const DEFAULT_RUN_CRON = "* * * * *";
const DEFAULT_RUN_LIMIT = 20;

let isDispatchRunning = false;
let isRunRunning = false;

function getDispatchCron() {
  return process.env.DIGEST_DISPATCH_CRON || DEFAULT_DISPATCH_CRON;
}

function getRunCron() {
  return process.env.DIGEST_RUN_CRON || DEFAULT_RUN_CRON;
}

function getRunLimit() {
  const raw = Number(process.env.DIGEST_JOB_RUN_LIMIT ?? DEFAULT_RUN_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_RUN_LIMIT;
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

export function startScheduler() {
  const enabled = process.env.ENABLE_SCHEDULER_SERVICE !== "false";

  if (!enabled) {
    console.log("[scheduler] Disabled by ENABLE_SCHEDULER_SERVICE=false");
    return;
  }

  void runDispatch("Startup catch-up");
  void runPending("Startup catch-up");

  cron.schedule(getDispatchCron(), () => {
    void runDispatch("Scheduled tick");
  });
  cron.schedule(getRunCron(), () => {
    void runPending("Scheduled tick");
  });

  console.log(
    `[scheduler] Initialized: dispatchCron="${getDispatchCron()}", runCron="${getRunCron()}", runLimit=${getRunLimit()}, mode=digest_jobs`,
  );
}
