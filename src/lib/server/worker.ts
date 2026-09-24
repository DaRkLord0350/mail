// The persistent send-queue worker. One pass = recover → promote → skip
// suppressed → [gate+claim+quota (one tx) → send → fenced finalize]* → complete.
//
// Safe to run concurrently from any number of processes (cron, manual
// "process now", `npm run worker`, internal interval):
//  • The pacing gate row (WorkerState id=1) is updated inside the claim
//    transaction, which serializes claimers across instances for a few ms and
//    enforces the delay between emails globally.
//  • Deliveries are claimed with FOR UPDATE SKIP LOCKED.
//  • The daily quota is reserved with a single conditional upsert in the same
//    transaction — if anything fails, the whole claim rolls back.
//  • Finalize writes are fenced by lockToken, so a worker whose lock expired
//    can never overwrite a row that was recovered and re-claimed.
//  • Resend idempotency keys make a recovered in-flight send dedupe on Resend.
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
/** Resend keeps idempotency keys for 24h; past this, a resend could duplicate. */
export const IDEMPOTENCY_WINDOW_HOURS = 23;
/** Consecutive identical permanent failures that halt sending. */
export const PERMANENT_BREAKER = 3;

export interface WorkerOptions {
  batchSize?: number;
  maxRuntimeMs?: number;
  transport?: EmailTransport;
  /** Override the delay between emails (seconds). */
  delaySeconds?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Skip saving lastRunAt/lastResult (tests). */
  skipStateUpdate?: boolean;
  /** Sleep until the next pacing slot when possible (default true). Manual runs pass false to return fast. */
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

interface ClaimedDelivery {
  id: string;
  campaignId: string;
  leadId: string;
  email: string;
  renderedSubject: string;
  renderedBody: string;
  attempts: number;
  idempotencyKey: string;
  /** Payload frozen by a previous attempt with the same idempotency key. */
  payload: OutgoingEmail | null;
  lockToken: string;
  /** DailyUsage date the quota slot was reserved on (for refunds). */
  quotaDate: string;
}

type ClaimResult =
  | { kind: "claimed"; delivery: ClaimedDelivery }
  | { kind: "paced"; waitMs: number }
  | { kind: "empty" }
  | { kind: "quota" }
  | { kind: "campaign_quota" };

class Rollback extends Error {
  constructor(public result: ClaimResult) {
    super("rollback");
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** PROCESSING rows whose worker died: back to PENDING (same idempotency key), or FAILED if too old to dedupe. */
export async function recoverStaleDeliveries(): Promise<number> {
  const unknownMsg = `Worker stopped mid-send more than ${IDEMPOTENCY_WINDOW_HOURS}h ago; the email may or may not have been delivered. Check Resend before retrying.`;
  const unknown = await prisma.$queryRaw<{ leadId: string }[]>`
    UPDATE ${t("EmailDelivery")}
    SET "status" = 'FAILED', "errorKind" = 'UNKNOWN_OUTCOME', "errorCode" = 'unknown_outcome',
        "errorMessage" = ${unknownMsg},
        "lockedAt" = NULL, "lockToken" = NULL, "updatedAt" = now()
    WHERE "status" = 'PROCESSING'
      AND "lockedAt" < now() - make_interval(mins => ${STALE_LOCK_MINUTES}::int)
      AND "lastAttemptAt" < now() - make_interval(hours => ${IDEMPOTENCY_WINDOW_HOURS}::int)
    RETURNING "leadId"`;
  if (unknown.length) {
    // Keep the lead status mirroring the delivery outcome (it was stuck on PENDING).
    await prisma.lead.updateMany({ where: { id: { in: unknown.map((r) => r.leadId) }, status: "PENDING" }, data: { status: "FAILED" } });
  }
  const requeued = await prisma.$executeRaw`
    UPDATE ${t("EmailDelivery")}
    SET "status" = 'PENDING', "lockedAt" = NULL, "lockToken" = NULL, "nextAttemptAt" = now(),
        "errorMessage" = 'Recovered after the worker stopped mid-send; will retry with the same idempotency key.',
        "updatedAt" = now()
    WHERE "status" = 'PROCESSING' AND "lockedAt" < now() - make_interval(mins => ${STALE_LOCK_MINUTES}::int)`;
  return unknown.length + Number(requeued);
}

/**
 * PENDING deliveries of a STOPPED campaign: a send that was in flight when the
 * campaign was stopped can come back as PENDING (transient retry, crash
 * recovery, halt). It will never be sent, so skip it — otherwise the lead
 * would stay PENDING and look "already queued" to every other campaign.
 */
export async function skipStoppedPending(): Promise<number> {
  const rows = await prisma.$queryRaw<{ leadId: string }[]>`
    UPDATE ${t("EmailDelivery")} d
    SET "status" = 'SKIPPED', "errorMessage" = 'Campaign stopped before this email was sent', "errorCode" = 'campaign_stopped',
        "lockedAt" = NULL, "lockToken" = NULL, "updatedAt" = now()
    FROM ${t("Campaign")} c
    WHERE c."id" = d."campaignId" AND c."status" = 'STOPPED' AND d."status" = 'PENDING'
    RETURNING d."leadId"`;
  if (rows.length) {
    await prisma.lead.updateMany({
      // …unless the lead is queued in another (active) campaign meanwhile.
      where: { id: { in: rows.map((r) => r.leadId) }, status: "PENDING", deliveries: { none: { status: { in: ["PENDING", "PROCESSING"] } } } },
      data: { status: "SKIPPED" },
    });
  }
  return rows.length;
}

/** Give back one reserved daily-quota slot (global + campaign, same fixed order as the claim). */
async function refundQuota(tx: Prisma.TransactionClient, date: string, campaignId: string): Promise<void> {
  for (const scope of [GLOBAL_SCOPE, campaignId]) {
    await tx.$executeRaw`
      UPDATE ${t("DailyUsage")} SET "emailsSent" = "emailsSent" - 1, "updatedAt" = now()
      WHERE "date" = ${date} AND "scope" = ${scope} AND "emailsSent" > 0`;
  }
}

export async function promoteScheduledCampaigns(): Promise<number> {
  // Deliveries were enqueued due at scheduledAt (app clock); once the DB says
  // the campaign is due, make its never-attempted deliveries due as well so
  // clock skew or a changed schedule can't leave a RUNNING campaign idle.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH promoted AS (
      UPDATE ${t("Campaign")} SET "status" = 'RUNNING', "startedAt" = COALESCE("startedAt", now()), "updatedAt" = now()
      WHERE "status" = 'SCHEDULED' AND "scheduledAt" <= now()
      RETURNING "id"
    ), due AS (
      UPDATE ${t("EmailDelivery")} d SET "nextAttemptAt" = now(), "updatedAt" = now()
      FROM promoted p
      WHERE d."campaignId" = p."id" AND d."status" = 'PENDING' AND d."attempts" = 0 AND d."nextAttemptAt" > now()
      RETURNING d."id"
    )
    SELECT "id" FROM promoted`;
  return rows.length;
}

/** Pending deliveries whose address got suppressed since the campaign started. */
export async function skipSuppressedPending(): Promise<number> {
  const rows = await prisma.$queryRaw<{ leadId: string }[]>`
    UPDATE ${t("EmailDelivery")} d
    SET "status" = 'SKIPPED', "errorMessage" = 'Email address is on the suppression list', "errorCode" = 'suppressed',
        "lockedAt" = NULL, "lockToken" = NULL, "updatedAt" = now()
    FROM ${t("Suppression")} s
    WHERE s."email" = d."email" AND d."status" = 'PENDING'
    RETURNING d."leadId"`;
  if (rows.length) {
    await prisma.lead.updateMany({ where: { id: { in: rows.map((r) => r.leadId) }, status: { not: "SENT" } }, data: { status: "SKIPPED" } });
  }
  return rows.length;
}

export async function completeFinishedCampaigns(): Promise<number> {
  return Number(
    await prisma.$executeRaw`
      UPDATE ${t("Campaign")} c SET "status" = 'COMPLETED', "completedAt" = now(), "updatedAt" = now()
      WHERE c."status" = 'RUNNING'
        AND NOT EXISTS (
          SELECT 1 FROM ${t("EmailDelivery")} d
          WHERE d."campaignId" = c."id" AND d."status" IN ('PENDING', 'PROCESSING'))`,
  );
}

/** Pacing gate + claim + quota reservation, atomically. */
async function claimNext(settings: EffectiveSettings, delaySeconds: number): Promise<ClaimResult> {
  const date = dayKey(settings.timezone);
  const globalLimit = settings.dailyLimit;
  try {
    return await prisma.$transaction(
      async (tx) => {
        // 1. Pacing gate (row lock serializes concurrent claimers).
        const gate = await tx.$queryRaw<{ id: number }[]>`
          UPDATE ${t("WorkerState")} SET "nextSendAt" = now() + make_interval(secs => ${delaySeconds}::float8), "updatedAt" = now()
          WHERE "id" = 1 AND "nextSendAt" <= now()
          RETURNING "id"`;
        if (!gate.length) {
          const w = await tx.$queryRaw<{ wait: number | null }[]>`
            SELECT (EXTRACT(EPOCH FROM ("nextSendAt" - now())) * 1000)::float8 AS "wait" FROM ${t("WorkerState")} WHERE "id" = 1`;
          if (!w.length) throw new Error("WorkerState row missing — run database migrations.");
          throw new Rollback({ kind: "paced", waitMs: Math.max(0, Number(w[0].wait ?? 0)) });
        }

        // 2. Next deliverable row: campaign running, due, not suppressed, campaign under its daily cap.
        const candidates = await tx.$queryRaw<{ id: string; campaignId: string; dailyLimit: number }[]>`
          SELECT d."id", d."campaignId", c."dailyLimit"
          FROM ${t("EmailDelivery")} d
          JOIN ${t("Campaign")} c ON c."id" = d."campaignId"
          WHERE d."status" = 'PENDING' AND c."status" = 'RUNNING' AND d."nextAttemptAt" <= now()
            AND NOT EXISTS (SELECT 1 FROM ${t("Suppression")} s WHERE s."email" = d."email")
            AND NOT EXISTS (
              SELECT 1 FROM ${t("DailyUsage")} u
              WHERE u."date" = ${date} AND u."scope" = c."id" AND u."emailsSent" >= LEAST(c."dailyLimit", ${globalLimit}))
          ORDER BY d."nextAttemptAt", d."createdAt", d."id"
          LIMIT 1
          FOR UPDATE OF d SKIP LOCKED`;
        if (!candidates.length) {
          // The per-campaign filter above also hides rows once a campaign's cap
          // (min(campaign, global)) is used up; if the GLOBAL cap is the reason,
          // report quota_reached rather than a misleading "queue is empty".
          const g = await tx.$queryRaw<{ emailsSent: number }[]>`
            SELECT "emailsSent" FROM ${t("DailyUsage")} WHERE "date" = ${date} AND "scope" = ${GLOBAL_SCOPE}`;
          if (globalLimit <= 0 || (g.length && Number(g[0].emailsSent) >= globalLimit)) throw new Rollback({ kind: "quota" });
          throw new Rollback({ kind: "empty" });
        }
        const cand = candidates[0];

        // 3. Quota: global first, then campaign (fixed order → no deadlocks).
        if ((await reserveQuota(tx, date, GLOBAL_SCOPE, globalLimit)) === null) throw new Rollback({ kind: "quota" });
        const campaignLimit = Math.min(cand.dailyLimit, globalLimit);
        if ((await reserveQuota(tx, date, cand.campaignId, campaignLimit)) === null) throw new Rollback({ kind: "campaign_quota" });

        // 4. Claim with a fencing token.
        const token = randomUUID();
        const claimed = await tx.$queryRaw<Omit<ClaimedDelivery, "lockToken">[]>`
          UPDATE ${t("EmailDelivery")}
          SET "status" = 'PROCESSING', "lockedAt" = now(), "lockToken" = ${token}, "attempts" = "attempts" + 1,
              "lastAttemptAt" = now(), "updatedAt" = now(),
              "idempotencyKey" = COALESCE("idempotencyKey", 'mail-' || "id" || '-' || ("attempts" + 1)::text)
          WHERE "id" = ${cand.id} AND "status" = 'PENDING'
          RETURNING "id", "campaignId", "leadId", "email", "renderedSubject", "renderedBody", "attempts", "idempotencyKey", "payload"`;
        if (!claimed.length) throw new Rollback({ kind: "empty" });
        return { kind: "claimed", delivery: { ...claimed[0], lockToken: token, quotaDate: date } } as ClaimResult;
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
  } catch (e) {
    if (e instanceof Rollback) return e.result;
    throw e;
  }
}

type Outcome = "sent" | "failed" | "retried" | "auth_error" | "lost_lock";

async function sendAndFinalize(
  d: ClaimedDelivery,
  settings: EffectiveSettings,
  transport: EmailTransport,
): Promise<{ outcome: Outcome; message?: string; errorKind?: string }> {
  const fence = { id: d.id, status: "PROCESSING" as const, lockToken: d.lockToken };
  // A retry that reuses the idempotency key must resend the byte-identical
  // payload (settings such as From/Reply-To may have changed in between), so
  // the payload is frozen on the row before the first request with that key.
  let outgoing: OutgoingEmail;
  if (d.payload && d.payload.idempotencyKey === d.idempotencyKey) {
    outgoing = d.payload;
  } else {
    outgoing = buildOutgoing(
      { to: d.email, subject: d.renderedSubject, body: d.renderedBody, idempotencyKey: d.idempotencyKey, tags: [{ name: "campaign", value: d.campaignId }] },
      settings,
    );
    const saved = await prisma.emailDelivery.updateMany({ where: fence, data: { payload: outgoing as unknown as Prisma.InputJsonValue } });
    if (saved.count !== 1) return { outcome: "lost_lock" };
  }
  const res = await transport.send(outgoing);

  if (res.ok) {
    // Only mark SENT after Resend confirmed the request, storing its message id.
    const now = new Date();
    const ok = await prisma.$transaction(async (tx) => {
      const u = await tx.emailDelivery.updateMany({
        where: fence,
        data: { status: "SENT", providerMessageId: res.id, sentAt: now, lockedAt: null, lockToken: null, errorMessage: null, errorCode: null, errorKind: null },
      });
      if (u.count !== 1) return false;
      await tx.lead.update({ where: { id: d.leadId }, data: { status: "SENT", lastSentAt: now, sendCount: { increment: 1 } } });
      return true;
    });
    if (!ok) {
      console.warn(`[mail] delivery ${d.id}: sent (resend id ${res.id}) but lock was lost; not overwriting.`);
      return { outcome: "lost_lock" };
    }
    return { outcome: "sent" };
  }

  const cls = classifySendError(res.error);
  const msg = `${res.error.message}${res.error.statusCode ? ` (HTTP ${res.error.statusCode})` : ""}`;
  const common = { lockedAt: null, lockToken: null, errorMessage: msg.slice(0, 1000), errorCode: res.error.code, errorKind: cls.kind };

  if (cls.haltAll) {
    // Global problem (API key, sender domain, Resend account quota): don't burn
    // this lead's retries, halt everything until the user fixes it.
    const reason = `Sending halted: ${msg}`;
    await prisma.$transaction(async (tx) => {
      const u = await tx.emailDelivery.updateMany({ where: fence, data: { ...common, status: "PENDING", attempts: { decrement: 1 }, idempotencyKey: null, payload: Prisma.DbNull, nextAttemptAt: new Date() } });
      // Resend refused the request outright (key / sender / account quota), so
      // nothing was sent: give the reserved daily-quota slot back. Global and
      // campaign in the same fixed order as the claim.
      if (u.count === 1) await refundQuota(tx, d.quotaDate, d.campaignId);
      await tx.campaign.updateMany({ where: { status: "RUNNING" }, data: { status: "PAUSED", pausedAt: new Date(), lastError: reason } });
      await tx.workerState.update({ where: { id: 1 }, data: { haltedReason: reason } });
    });
    return { outcome: "auth_error", message: reason };
  }

  const canRetry = cls.kind === "TRANSIENT" && d.attempts < settings.maxRetries;
  if (canRetry) {
    const u = await prisma.emailDelivery.updateMany({
      where: fence,
      data: {
        ...common,
        status: "PENDING",
        nextAttemptAt: new Date(Date.now() + retryDelayMs(d.attempts)),
        ...(cls.keepIdempotencyKey ? {} : { idempotencyKey: null, payload: Prisma.DbNull }),
      },
    });
    return { outcome: u.count ? "retried" : "lost_lock", errorKind: cls.kind };
  }

  const ok = await prisma.$transaction(async (tx) => {
    const u = await tx.emailDelivery.updateMany({ where: fence, data: { ...common, status: "FAILED" } });
    if (u.count !== 1) return false;
    await tx.lead.updateMany({ where: { id: d.leadId, status: { not: "SENT" } }, data: { status: "FAILED" } });
    return true;
  });
  return { outcome: ok ? "failed" : "lost_lock", message: msg, errorKind: cls.kind };
}

export async function runWorker(opts: WorkerOptions = {}): Promise<WorkerResultDTO> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const startedAt = new Date(now());
  const batchSize = opts.batchSize ?? env.cronBatchSize;
  const budgetMs = opts.maxRuntimeMs ?? env.cronMaxRuntimeSeconds * 1000;
  const transport = opts.transport ?? getTransport();
  const deadline = now() + budgetMs;

  const settings = await getSettings();
  const delaySeconds = opts.delaySeconds ?? settings.sendDelaySeconds;
  const result: WorkerResultDTO = {
    startedAt: startedAt.toISOString(),
    finishedAt: "",
    recovered: 0,
    promotedCampaigns: 0,
    completedCampaigns: 0,
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    retried: 0,
    stopReason: "batch_complete",
    message: "",
    usage: await getUsage(settings.timezone, settings.dailyLimit),
  };

  try {
    await prisma.workerState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    result.recovered = await recoverStaleDeliveries();
    result.promotedCampaigns = await promoteScheduledCampaigns();
    result.skipped += await skipSuppressedPending();
    result.skipped += await skipStoppedPending();

    const state = await prisma.workerState.findUnique({ where: { id: 1 } });
    if (state?.haltedReason) {
      result.stopReason = "auth_error";
      result.message = `${state.haltedReason} — fix the problem, then run "Test Resend Connection" in Settings or resume a campaign.`;
    } else if (!opts.transport && !env.resendApiKey) {
      result.stopReason = "not_configured";
      result.message = "RESEND_API_KEY is not configured — nothing was sent.";
    } else if (!formatSender(settings)) {
      result.stopReason = "not_configured";
      result.message = "Sender is not configured (FROM_EMAIL) — nothing was sent.";
    } else if (settings.includeUnsubscribe && env.isProduction && !env.appUrl.startsWith("https://")) {
      // Unsubscribe links / List-Unsubscribe (RFC 8058) must be public https URLs.
      result.stopReason = "not_configured";
      result.message = "APP_URL must be the public https:// URL of this app (used in unsubscribe links) — nothing was sent.";
    } else {
      let guard = 0;
      // Circuit breaker: the same permanent error for several leads in a row is
      // almost certainly a configuration problem, not a bad recipient.
      let lastPermanent = "";
      let streak: { id: string; leadId: string; campaignId: string; quotaDate: string }[] = [];
      loop: while (result.processed < batchSize) {
        if (++guard > batchSize * 5 + 20) break;
        if (now() >= deadline) {
          result.stopReason = "time_budget";
          break;
        }
        const claim = await claimNext(settings, delaySeconds);
        switch (claim.kind) {
          case "paced": {
            // Don't sleep through the delay just to discover there's nothing to send.
            if (!(await hasDueWork(claim.waitMs))) {
              result.stopReason = "queue_empty";
              break loop;
            }
            if (opts.waitForPacing !== false && now() + claim.waitMs + 250 < deadline) {
              await sleep(claim.waitMs + 50);
              continue;
            }
            result.stopReason = "paced";
            break loop;
          }
          case "empty":
            result.stopReason = "queue_empty";
            break loop;
          case "quota":
            result.stopReason = "quota_reached";
            break loop;
          case "campaign_quota":
            continue; // another worker filled that campaign's cap; the filter now excludes it
          case "claimed": {
            result.processed++;
            let r: { outcome: Outcome; message?: string; errorKind?: string };
            try {
              r = await sendAndFinalize(claim.delivery, settings, transport);
            } catch (e) {
              // DB failure after claiming: the row stays PROCESSING and is
              // recovered later with the same idempotency key.
              console.error("[mail] finalize failed", e);
              result.stopReason = "error";
              result.message = "Database error while recording a send — see server logs. The email will be recovered automatically.";
              break loop;
            }
            if (r.outcome === "sent") result.sent++;
            else if (r.outcome === "failed") result.failed++;
            else if (r.outcome === "retried") result.retried++;

            if (r.outcome === "failed" && r.errorKind === "PERMANENT" && r.message) {
              if (r.message !== lastPermanent) streak = [];
              lastPermanent = r.message;
              const { id, leadId, campaignId, quotaDate } = claim.delivery;
              streak.push({ id, leadId, campaignId, quotaDate });
              if (streak.length >= PERMANENT_BREAKER) {
                const reason = `Sending halted: ${PERMANENT_BREAKER} emails in a row failed with the same error ("${r.message}"). This looks like a configuration problem.`;
                // Resend rejected these outright (nothing was sent): put them back
                // in the queue so they go out once the configuration is fixed,
                // and give their daily-quota slots back.
                const tripped = streak;
                await prisma.$transaction(async (tx) => {
                  for (const x of tripped) {
                    const u = await tx.emailDelivery.updateMany({
                      where: { id: x.id, status: "FAILED" },
                      data: { status: "PENDING", attempts: 0, idempotencyKey: null, payload: Prisma.DbNull, errorKind: "AUTH", nextAttemptAt: new Date() },
                    });
                    if (u.count === 1) await refundQuota(tx, x.quotaDate, x.campaignId);
                  }
                  await tx.lead.updateMany({ where: { id: { in: tripped.map((x) => x.leadId) }, status: "FAILED" }, data: { status: "PENDING" } });
                  await tx.campaign.updateMany({ where: { status: "RUNNING" }, data: { status: "PAUSED", pausedAt: new Date(), lastError: reason } });
                  await tx.workerState.update({ where: { id: 1 }, data: { haltedReason: reason } });
                });
                result.failed -= streak.length;
                result.stopReason = "auth_error";
                result.message = reason;
                break loop;
              }
            } else if (r.outcome === "sent") {
              streak = [];
              lastPermanent = "";
            }
            if (r.outcome === "auth_error") {
              result.stopReason = "auth_error";
              result.message = r.message ?? "Sending halted.";
              break loop;
            }
            break;
          }
        }
      }
    }
    result.completedCampaigns = await completeFinishedCampaigns();
  } catch (e) {
    console.error("[mail] worker error", e);
    result.stopReason = "error";
    result.message = "Worker error (database unavailable?) — see server logs.";
  }

  result.usage = await getUsage(settings.timezone, settings.dailyLimit).catch(() => result.usage);
  if (!result.message) {
    const parts = [`Sent ${result.sent}`, `failed ${result.failed}`, `retrying ${result.retried}`];
    if (result.skipped) parts.push(`skipped ${result.skipped}`);
    const why: Record<WorkerResultDTO["stopReason"], string> = {
      batch_complete: "batch size reached",
      queue_empty: "queue is empty",
      quota_reached: `daily limit reached (${result.usage.sent}/${result.usage.limit})`,
      time_budget: "time budget used",
      paced: `waiting ${delaySeconds}s between emails`,
      auth_error: "halted",
      not_configured: "not configured",
      error: "error",
    };
    result.message = `${parts.join(", ")} — ${why[result.stopReason]}.`;
  }
  result.finishedAt = new Date(now()).toISOString();

  if (!opts.skipStateUpdate) {
    await prisma.workerState
      .update({ where: { id: 1 }, data: { lastRunAt: new Date(), lastResult: result as unknown as object } })
      .catch(() => undefined);
  }
  return result;
}

/** Clear a global halt (after a successful connection test or a manual resume). */
export async function clearHalt(): Promise<void> {
  await prisma.workerState.upsert({ where: { id: 1 }, update: { haltedReason: null }, create: { id: 1 } });
}
