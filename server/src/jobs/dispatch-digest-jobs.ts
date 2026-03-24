import "dotenv/config";
import { initDb } from "../db/index.js";
import { dispatchDigestJobs } from "../services/digest-jobs.js";

async function main() {
  await initDb();
  const result = await dispatchDigestJobs();
  console.log(`[jobs/dispatch-digest-jobs] scannedUsers=${result.scannedUsers} created=${result.created} existing=${result.existing}`);
}

main().catch((error) => {
  console.error("[jobs/dispatch-digest-jobs] Failed:", error);
  process.exit(1);
});
