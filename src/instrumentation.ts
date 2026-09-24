// Optional in-process worker for single-server deployments (`npm start` on a
// VM/container) that have no external cron. Enabled with
// ENABLE_INTERNAL_WORKER=true. It is only a convenience trigger — the queue
// itself lives in the database, and cron / `npm run worker` work the same way.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.ENABLE_INTERNAL_WORKER !== "true") return;

  const { runWorker } = await import("./lib/server/worker");
  const g = globalThis as unknown as { __mailWorkerStarted?: boolean };
  if (g.__mailWorkerStarted) return;
  g.__mailWorkerStarted = true;

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runWorker({ maxRuntimeMs: 55_000 });
      if (r.processed || r.stopReason === "auth_error" || r.stopReason === "error") console.log(`[mail internal worker] ${r.message}`);
    } catch (e) {
      console.error("[mail internal worker]", e);
    } finally {
      running = false;
    }
  };
  setInterval(tick, 30_000);
  setTimeout(tick, 5_000);
  console.log("[mail] internal queue worker enabled (every 30s)");
}
