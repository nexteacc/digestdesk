import "dotenv/config";
import { initDb } from "../db/index.js";
import { runPendingDigestJobs } from "../services/digest-jobs.js";

async function main() {
  await initDb();
  const result = await runPendingDigestJobs();
  console.log(
    `[jobs/run-digest-jobs] claimed=${result.claimed} succeeded=${result.succeeded} skipped=${result.skipped} failed=${result.failed}`,
  );
}

main().catch((error) => {
  console.error("[jobs/run-digest-jobs] Failed:", error);
  process.exit(1);
});
