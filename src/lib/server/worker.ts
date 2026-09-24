// The persistent send-queue worker. One pass = recover → promote → skip
// suppressed → [gate+claim+quota (one tx) → send → fenced finalize]* → complete.
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { t } from "./sql";
import { env } from "./env";
import { getSettings, formatSender, type EffectiveSettings } from "./settings";
import { dayKey, GLOBAL_SCOPE, getUsage, reserveQuota } from "./quota";
import { buildOutgoing } from "./compose";
import { getTransport, type EmailTransport, type OutgoingEmail } from "@/lib/email/resend";
import { classifySendError, retryDelayMs } from "@/lib/email/errors";
import type { WorkerResultDTO } from "@/lib/types";

export const STALE_LOCK_MINUTES = 10;
export const IDEMPOTENCY_WINDOW_HOURS = 23;
export const PERMANENT_BREAKER = 3;

export interface WorkerOptions {
  batchSize?: number;
  maxRuntimeMs?: number;
  transport?: EmailTransport;
  delaySeconds?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  skipStateUpdate?: boolean;
  waitForPacing?: boolean;
}

/** Is any delivery of a running campaign due within `withinMs`? */
async function hasDueWork(withinMs: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ one: number }[]>`
    SELECT 1 AS "one" FROM ${t("EmailDelivery")} d
    JOIN ${t("Campaign")} c ON c."id" = d."campaignId"
    WHERE d."status" = 'PENDING' AND c."status" = 'RUNNING'
      AND d."nextAttemptAt" <= now() + make_interval(secs => ${withinMs / 1000}::float8)
    LIMIT 1`;
  return rows.length > 0;
}
