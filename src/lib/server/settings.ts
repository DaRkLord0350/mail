import type { Settings } from "@prisma/client";
import { prisma } from "./db";
import { env } from "./env";
import type { MissingVariableBehavior, SettingsDTO } from "@/lib/types";

export interface EffectiveSettings {
  fromName: string;
  fromEmail: string;
  replyTo: string;
  /** Effective global daily limit: min(settings, env ceiling). */
  dailyLimit: number;
  dailyLimitCeiling: number;
  sendDelaySeconds: number;
  maxRetries: number;
  missingVariableBehavior: MissingVariableBehavior;
  fallbackValues: Record<string, string>;
  timezone: string;
}

export async function getSettingsRow(): Promise<Settings> {
  return prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1, timezone: env.timezone } });
}

function toRecord(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
  }
  return out;
}

export function effectiveFrom(row: Settings): EffectiveSettings {
  const ceiling = env.dailySendLimit;
  return {
    fromName: row.fromName?.trim() || env.fromName,
    fromEmail: row.fromEmail?.trim() || env.fromEmail,
    replyTo: row.replyTo?.trim() || "",
    dailyLimit: Math.max(0, Math.min(row.dailyLimit ?? ceiling, ceiling)),
    dailyLimitCeiling: ceiling,
    sendDelaySeconds: row.sendDelaySeconds ?? env.defaultSendDelaySeconds,
    maxRetries: Math.max(1, Math.min(row.maxRetries, 10)),
    missingVariableBehavior: row.missingVariableBehavior,
    fallbackValues: toRecord(row.fallbackValues),
    timezone: row.timezone || env.timezone,
  };
}

export async function getSettings(): Promise<EffectiveSettings> {
  return effectiveFrom(await getSettingsRow());
}

/** "Name <email>" or null when no sender is configured. */
export function formatSender(s: Pick<EffectiveSettings, "fromName" | "fromEmail">): string | null {
  if (!s.fromEmail) return null;
  const name = s.fromName.replace(/["<>\r\n\\]/g, "").trim();
  return name ? `"${name}" <${s.fromEmail}>` : s.fromEmail;
}

export function settingsDTO(s: EffectiveSettings): SettingsDTO {
  const sender = formatSender(s);
  return {
    fromName: s.fromName,
    fromEmail: s.fromEmail,
    replyTo: s.replyTo,
    dailyLimit: s.dailyLimit,
    dailyLimitCeiling: s.dailyLimitCeiling,
    sendDelaySeconds: s.sendDelaySeconds,
    maxRetries: s.maxRetries,
    missingVariableBehavior: s.missingVariableBehavior,
    fallbackValues: s.fallbackValues,
    timezone: s.timezone,
    gmail: { configured: Boolean(env.googleRefreshToken), keyHint: env.googleRefreshToken ? "OAuth configured" : null },
    cron: { configured: Boolean(env.cronSecret), batchSize: env.cronBatchSize },
    sender: { configured: Boolean(sender), formatted: sender },
  };
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
