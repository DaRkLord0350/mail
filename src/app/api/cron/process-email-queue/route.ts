import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { errorResponse, json } from "@/lib/server/http";
import { runWorker } from "@/lib/server/worker";

export const maxDuration = 60;
// The deadline is only checked before claiming, and one Resend call can take up
// to 20 s, so leave headroom below maxDuration (a killed function would strand
// a PROCESSING row for 10 minutes until crash recovery).
const MAX_BUDGET_SECONDS = 35;

async function run(req: Request) {
  if (!env.cronSecret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return json(await runWorker({ maxRuntimeMs: Math.min(env.cronMaxRuntimeSeconds, MAX_BUDGET_SECONDS) * 1000 }));
  } catch (e) {
    return errorResponse(e);
  }
}

// Vercel Cron uses GET with "Authorization: Bearer <CRON_SECRET>"; other schedulers may POST.
export const GET = run;
export const POST = run;
