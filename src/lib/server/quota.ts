import { prisma, type Tx } from "./db";
import { t } from "./sql";
import type { UsageDTO } from "@/lib/types";

/** YYYY-MM-DD for `date` in the given IANA timezone. */
export function dayKey(timezone: string, date: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export const GLOBAL_SCOPE = "global";

/**
 * Atomically reserve one send slot for `scope` on `date`.
 *
 * A single INSERT … ON CONFLICT DO UPDATE … WHERE statement: the row is
 * created with emailsSent=1, or incremented only while below the limit.
 * Concurrent callers serialize on the unique (date, scope) index / row lock,
 * and the WHERE is re-evaluated against the latest committed row, so the
 * counter can never exceed `limit` no matter how many workers race.
 * Returns the new count, or null when the quota is exhausted.
 */
export async function reserveQuota(db: Tx, date: string, scope: string, limit: number): Promise<number | null> {
  if (limit <= 0) return null;
  const rows = await db.$queryRaw<{ emailsSent: number }[]>`
    INSERT INTO ${t("DailyUsage")} ("id", "date", "scope", "emailsSent", "dailyLimit", "updatedAt")
    VALUES (gen_random_uuid()::text, ${date}, ${scope}, 1, ${limit}, now())
    ON CONFLICT ("date", "scope") DO UPDATE
      SET "emailsSent" = ${t("DailyUsage")}."emailsSent" + 1, "dailyLimit" = ${limit}, "updatedAt" = now()
      WHERE ${t("DailyUsage")}."emailsSent" < ${limit}
    RETURNING "emailsSent"`;
  return rows.length ? Number(rows[0].emailsSent) : null;
}

export async function getUsage(timezone: string, limit: number, scope = GLOBAL_SCOPE): Promise<UsageDTO> {
  const date = dayKey(timezone);
  const row = await prisma.dailyUsage.findUnique({ where: { date_scope: { date, scope } } });
  const sent = row?.emailsSent ?? 0;
  return { date, timezone, sent, limit, remaining: Math.max(0, limit - sent) };
}

/** Sends used today per campaign (scope = campaign id). */
export async function getCampaignUsage(timezone: string, campaignIds: string[]): Promise<Map<string, number>> {
  if (!campaignIds.length) return new Map();
  const rows = await prisma.dailyUsage.findMany({ where: { date: dayKey(timezone), scope: { in: campaignIds } } });
  return new Map(rows.map((r) => [r.scope, r.emailsSent]));
}
