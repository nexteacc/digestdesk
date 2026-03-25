import "dotenv/config";
import { initDb } from "./db/index.js";
import { startScheduler } from "./cron/scheduler.js";

async function main() {
  console.log("[scheduler] Starting initialization...");
  await initDb();
  console.log("[scheduler] Database initialized.");
  startScheduler();
  console.log("[scheduler] Service started.");
}

main().catch((error) => {
  console.error("[scheduler] Fatal startup error:", error);
  process.exit(1);
});
