import { handler, json } from "@/lib/server/http";
import { runWorker } from "@/lib/server/worker";

export const maxDuration = 60;

// Manual "Process queue now": same code path as cron; safe to run concurrently.
// It never sleeps for pacing, so the request returns quickly; cron / the
// worker process keep draining the queue at the configured delay.
export const POST = handler(async () => json(await runWorker({ maxRuntimeMs: 35_000, waitForPacing: false })));
