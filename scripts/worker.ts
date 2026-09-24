/**
 * Long-running queue worker for self-hosted deployments / local development:
 *
 *   npm run worker
 *
 * Repeatedly runs the same worker pass as /api/cron/process-email-queue.
 * Safe to run alongside cron or other workers (all coordination is in the DB).
 * Stop with Ctrl+C — an in-flight send finishes first.
 */
import "dotenv/config";
import { runWorker } from "../src/lib/server/worker";
import { prisma } from "../src/lib/server/db";

const IDLE_POLL_MS = Number(process.env.WORKER_POLL_SECONDS ?? 20) * 1000;
let stopping = false;

process.on("SIGINT", () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log("\n[worker] stopping after the current pass… (Ctrl+C again to force)");
});
process.on("SIGTERM", () => (stopping = true));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`[worker] started — polling every ${IDLE_POLL_MS / 1000}s when idle`);
  while (!stopping) {
    try {
      // Long budget: this process is not subject to serverless limits.
      const r = await runWorker({ maxRuntimeMs: 5 * 60_000, batchSize: 100 });
      const stamp = new Date().toLocaleTimeString();
      if (r.processed || r.recovered || r.promotedCampaigns || r.completedCampaigns || r.stopReason === "auth_error" || r.stopReason === "error") {
        console.log(`[worker ${stamp}] ${r.message} (usage ${r.usage.sent}/${r.usage.limit})`);
      }
      if (r.stopReason === "batch_complete") continue; // more work right away
    } catch (e) {
      console.error("[worker] pass failed:", e instanceof Error ? e.message : e);
    }
    for (let waited = 0; waited < IDLE_POLL_MS && !stopping; waited += 1000) await sleep(1000);
  }
  await prisma.$disconnect();
  console.log("[worker] stopped");
}

void main();
