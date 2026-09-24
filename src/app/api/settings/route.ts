import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { badRequest, handler, json, readJson } from "@/lib/server/http";
import { effectiveFrom, getSettings, getSettingsRow, isValidTimezone, settingsDTO } from "@/lib/server/settings";
import { isValidEmail, normalizeEmail } from "@/lib/email-address";
import { MISSING_VARIABLE_BEHAVIORS } from "@/lib/types";
import { getUsage } from "@/lib/server/quota";

const Body = z.object({
  fromName: z.string().max(200).optional(),
  fromEmail: z.string().max(254).optional(),
  replyTo: z.string().max(254).optional(),
  dailyLimit: z.number().int().min(0).optional(),
  sendDelaySeconds: z.number().int().min(0).max(3600).optional(),
  maxRetries: z.number().int().min(1).max(10).optional(),
  missingVariableBehavior: z.enum(MISSING_VARIABLE_BEHAVIORS).optional(),
  fallbackValues: z.record(z.string().regex(/^[a-z0-9_.-]{1,100}$/i, "Fallback keys must be variable names"), z.string().max(500)).optional(),
  timezone: z.string().max(100).optional(),
  includeUnsubscribe: z.boolean().optional(),
});

export const GET = handler(async () => json(settingsDTO(await getSettings())));

export const PUT = handler(async (req) => {
  const b = await readJson(req, Body);
  if (b.dailyLimit !== undefined && b.dailyLimit > env.dailySendLimit) {
    throw badRequest(`Daily limit can't exceed the server ceiling DAILY_SEND_LIMIT=${env.dailySendLimit}.`);
  }
  for (const k of ["fromEmail", "replyTo"] as const) {
    const v = b[k];
    if (v !== undefined && v.trim() !== "" && !isValidEmail(normalizeEmail(v))) throw badRequest(`${k} is not a valid email address.`);
  }
  if (b.timezone !== undefined && !isValidTimezone(b.timezone)) throw badRequest(`Unknown timezone "${b.timezone}".`);
  const current = effectiveFrom(await getSettingsRow());
  if (b.timezone !== undefined && b.timezone !== current.timezone) {
    // The quota day is keyed by the timezone; switching mid-day would open a
    // fresh counter and allow a second full day's quota.
    const usage = await getUsage(current.timezone, current.dailyLimit);
    if (usage.sent > 0) throw badRequest("The timezone can't be changed on a day when emails were already sent (it would reset today's quota). Try again tomorrow.");
  }
  const row = await prisma.settings.update({
    where: { id: 1 },
    data: {
      ...(b.fromName !== undefined ? { fromName: b.fromName.trim() || null } : {}),
      ...(b.fromEmail !== undefined ? { fromEmail: b.fromEmail.trim() ? normalizeEmail(b.fromEmail) : null } : {}),
      ...(b.replyTo !== undefined ? { replyTo: b.replyTo.trim() ? normalizeEmail(b.replyTo) : null } : {}),
      ...(b.dailyLimit !== undefined ? { dailyLimit: b.dailyLimit } : {}),
      ...(b.sendDelaySeconds !== undefined ? { sendDelaySeconds: b.sendDelaySeconds } : {}),
      ...(b.maxRetries !== undefined ? { maxRetries: b.maxRetries } : {}),
      ...(b.missingVariableBehavior !== undefined ? { missingVariableBehavior: b.missingVariableBehavior } : {}),
      ...(b.fallbackValues !== undefined
        ? { fallbackValues: Object.fromEntries(Object.entries(b.fallbackValues).map(([k, v]) => [k.toLowerCase(), v])) }
        : {}),
      ...(b.timezone !== undefined ? { timezone: b.timezone } : {}),
      ...(b.includeUnsubscribe !== undefined ? { includeUnsubscribe: b.includeUnsubscribe } : {}),
    },
  });
  return json(settingsDTO(effectiveFrom(row)));
});
