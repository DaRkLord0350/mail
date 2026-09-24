import { Prisma, type Campaign } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { campaignDTO, emptyDeliveryCounts, leadName } from "./dto";
import { badRequest, conflict, notFound } from "./http";
import { getSettings, isValidTimezone, type EffectiveSettings } from "./settings";
import { getUsage } from "./quota";
import { renderForLead } from "./compose";
import { knownVariableKeys, leadWhere, type LeadQuery } from "./leads";
import { clearHalt, IDEMPOTENCY_WINDOW_HOURS } from "./worker";
import { findMalformedPlaceholders, uniqueVariableKeys } from "@/lib/template/render";
import type { CampaignDTO, CampaignPreviewDTO, DeliveryStatus } from "@/lib/types";

const EDITABLE = ["DRAFT", "READY"] as const;

export async function deliveryCounts(campaignIds: string[]): Promise<Map<string, Record<DeliveryStatus, number>>> {
  const map = new Map<string, Record<DeliveryStatus, number>>();
  if (!campaignIds.length) return map;
  const groups = await prisma.emailDelivery.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: campaignIds } }, _count: { _all: true } });
  for (const g of groups) {
    const c = map.get(g.campaignId) ?? emptyDeliveryCounts();
    c[g.status] = g._count._all;
    map.set(g.campaignId, c);
  }
  return map;
}

export async function toDTOs(campaigns: Campaign[]): Promise<CampaignDTO[]> {
  const ids = campaigns.map((c) => c.id);
  const [counts, recipients, worker] = await Promise.all([
    deliveryCounts(ids),
    prisma.campaignLead.groupBy({ by: ["campaignId"], where: { campaignId: { in: ids } }, _count: { _all: true } }),
    prisma.workerState.findUnique({ where: { id: 1 }, select: { haltedReason: true } }),
  ]);
  const rc = new Map(recipients.map((r) => [r.campaignId, r._count._all]));
  return campaigns.map((c) => {
    const cnt = counts.get(c.id) ?? emptyDeliveryCounts();
    const deliveries = Object.values(cnt).reduce((a, b) => a + b, 0);
    return campaignDTO(c, Math.max(rc.get(c.id) ?? 0, deliveries), cnt, worker?.haltedReason ?? null);
  });
}

export async function getCampaignOr404(id: string): Promise<Campaign> {
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c) throw notFound("Campaign not found");
  return c;
}

export async function campaignDTOById(id: string): Promise<CampaignDTO> {
  return (await toDTOs([await getCampaignOr404(id)]))[0];
}

/** DRAFT ⇄ READY: ready when it has recipients and a non-empty subject + body. */
export async function refreshReadiness(id: string): Promise<void> {
  const c = await getCampaignOr404(id);
  if (!EDITABLE.includes(c.status as (typeof EDITABLE)[number])) return;
  const recipients = await prisma.campaignLead.count({ where: { campaignId: id } });
  const ready = recipients > 0 && c.subjectTemplate.trim() !== "" && c.bodyTemplate.trim() !== "";
  const status = ready ? "READY" : "DRAFT";
  if (status !== c.status) await prisma.campaign.updateMany({ where: { id, status: { in: [...EDITABLE] } }, data: { status } });
}

function assertEditable(c: Campaign) {
  if (!EDITABLE.includes(c.status as (typeof EDITABLE)[number])) {
    throw conflict(`Campaign is ${c.status}; its template and recipients were frozen when it started.`);
  }
}

export async function createCampaign(input: { name: string; templateId?: string | null; subjectTemplate?: string; bodyTemplate?: string; dailyLimit?: number }) {
  const settings = await getSettings();
  let subject = input.subjectTemplate ?? "";
  let body = input.bodyTemplate ?? "";
  if (input.templateId) {
    const tpl = await prisma.template.findUnique({ where: { id: input.templateId } });
    if (!tpl) throw badRequest("Template not found");
    if (!subject) subject = tpl.subject;
    if (!body) body = tpl.body;
  }
  const c = await prisma.campaign.create({
    data: {
      name: input.name,
      templateId: input.templateId ?? null,
      subjectTemplate: subject,
      bodyTemplate: body,
      dailyLimit: Math.min(input.dailyLimit ?? settings.dailyLimit, settings.dailyLimitCeiling),
      timezone: settings.timezone,
    },
  });
  return campaignDTOById(c.id);
}

export async function updateCampaign(id: string, input: { name?: string; templateId?: string | null; subjectTemplate?: string; bodyTemplate?: string; dailyLimit?: number }) {
  const c = await getCampaignOr404(id);
  const settings = await getSettings();
  const onlyName = Object.keys(input).every((k) => k === "name" || (k === "dailyLimit" && input.dailyLimit !== undefined));
  if (!onlyName) assertEditable(c);
  const data: Prisma.CampaignUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.subjectTemplate !== undefined) data.subjectTemplate = input.subjectTemplate;
  if (input.bodyTemplate !== undefined) data.bodyTemplate = input.bodyTemplate;
  if (input.dailyLimit !== undefined) data.dailyLimit = Math.min(input.dailyLimit, settings.dailyLimitCeiling);
  if (input.templateId !== undefined) {
    if (input.templateId === null) data.template = { disconnect: true };
    else {
      const tpl = await prisma.template.findUnique({ where: { id: input.templateId } });
      if (!tpl) throw badRequest("Template not found");
      data.template = { connect: { id: tpl.id } };
      if (input.subjectTemplate === undefined) data.subjectTemplate = tpl.subject;
      if (input.bodyTemplate === undefined) data.bodyTemplate = tpl.body;
    }
  }
  await prisma.campaign.update({ where: { id }, data });
  await refreshReadiness(id);
  return campaignDTOById(id);
}

export async function deleteCampaign(id: string) {
  const c = await getCampaignOr404(id);
  if (c.status === "RUNNING" || c.status === "SCHEDULED") throw conflict("Pause or stop the campaign before deleting it.");
  const deliveries = await prisma.emailDelivery.count({ where: { campaignId: id } });
  if (deliveries > 0) throw conflict("This campaign has send history, which is kept for auditing. Stop it instead of deleting.");
  await prisma.campaign.delete({ where: { id } });
}

// ─── Recipients ─────────────────────────────────────────────────────────────

export async function updateRecipients(
  id: string,
  input: { mode: "add" | "remove" | "set" | "clear"; leadIds?: string[]; filter?: LeadQuery },
): Promise<{ recipientCount: number }> {
  const c = await getCampaignOr404(id);
  assertEditable(c);

  let ids: string[] = [];
  if (input.filter) {
    const leads = await prisma.lead.findMany({ where: leadWhere(input.filter), select: { id: true } });
    ids = leads.map((l) => l.id);
  }
  if (input.leadIds?.length) ids = [...new Set([...ids, ...input.leadIds])];

  await prisma.$transaction(
    async (tx) => {
      if (input.mode === "clear" || input.mode === "set") await tx.campaignLead.deleteMany({ where: { campaignId: id } });
      if (input.mode === "add" || input.mode === "set") {
        const valid = await tx.lead.findMany({ where: { id: { in: ids } }, select: { id: true } });
        for (let i = 0; i < valid.length; i += 1000) {
          await tx.campaignLead.createMany({ data: valid.slice(i, i + 1000).map((l) => ({ campaignId: id, leadId: l.id })), skipDuplicates: true });
        }
      }
      if (input.mode === "remove") await tx.campaignLead.deleteMany({ where: { campaignId: id, leadId: { in: ids } } });
    },
    { timeout: 60_000 },
  );
  await refreshReadiness(id);
  return { recipientCount: await prisma.campaignLead.count({ where: { campaignId: id } }) };
}

export async function listRecipients(id: string, q: { search?: string; skip: number; take: number }) {
  await getCampaignOr404(id);
  const where: Prisma.CampaignLeadWhereInput = { campaignId: id, ...(q.search ? { lead: leadWhere({ search: q.search }) } : {}) };
  const [rows, total] = await Promise.all([
    prisma.campaignLead.findMany({ where, include: { lead: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: q.skip, take: q.take }),
    prisma.campaignLead.count({ where }),
  ]);
  const deliveries = await prisma.emailDelivery.findMany({ where: { campaignId: id, leadId: { in: rows.map((r) => r.leadId) } }, select: { leadId: true, status: true } });
  const ds = new Map(deliveries.map((d) => [d.leadId, d.status]));
  return { rows, total, deliveryStatus: ds };
}

// ─── Validation / dry run ───────────────────────────────────────────────────

export async function validateTemplates(subject: string, body: string) {
  const known = await knownVariableKeys();
  const used = uniqueVariableKeys(subject, body);
  const unknown = used.filter((k) => !known.has(k));
  const malformed = findMalformedPlaceholders(`${subject}\n${body}`);
  return { unknown, malformed };
}

async function renderRecipients(c: Campaign, settings: EffectiveSettings, onlyLeadIds?: string[]) {
  const rows = await prisma.campaignLead.findMany({
    where: { campaignId: c.id, ...(onlyLeadIds ? { leadId: { in: onlyLeadIds } } : {}) },
    include: { lead: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const emails = rows.map((r) => r.lead.email);
  const suppressed = new Set<string>();
  for (let i = 0; i < emails.length; i += 1000) {
    (await prisma.suppression.findMany({ where: { email: { in: emails.slice(i, i + 1000) } }, select: { email: true } })).forEach((s) => suppressed.add(s.email));
  }
  // Never queue the same person in two campaigns at once (two cold emails).
  const queuedElsewhere = await findQueuedElsewhere(prisma, c.id, rows.map((r) => r.leadId));
  return rows.map((r) => {
    const render = renderForLead(c.subjectTemplate, c.bodyTemplate, r.lead, settings, { suppressed: suppressed.has(r.lead.email) });
    const other = queuedElsewhere.get(r.leadId);
    const elsewhere = !render.skipReason && other !== undefined;
    if (elsewhere) render.skipReason = queuedElsewhereReason(other);
    return { lead: r.lead, suppressed: suppressed.has(r.lead.email), queuedElsewhere: elsewhere, render };
  });
}

/**
 * Deliveries that still "occupy" a lead in another campaign: in flight, or
 * pending in a campaign that can still send (a STOPPED campaign never will).
 */
function activeElsewhere(campaignId: string): Prisma.EmailDeliveryWhereInput {
  return {
    campaignId: { not: campaignId },
    OR: [{ status: "PROCESSING" }, { status: "PENDING", campaign: { status: { not: "STOPPED" } } }],
  };
}

const queuedElsewhereReason = (name: string) => `Already queued in campaign "${name}"`;

/** leadId → name of another campaign that has this lead queued. */
async function findQueuedElsewhere(db: Pick<Tx, "emailDelivery">, campaignId: string, leadIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < leadIds.length; i += 1000) {
    const active = await db.emailDelivery.findMany({
      where: { leadId: { in: leadIds.slice(i, i + 1000) }, ...activeElsewhere(campaignId) },
      select: { leadId: true, campaign: { select: { name: true } } },
    });
    active.forEach((a) => out.set(a.leadId, a.campaign.name));
  }
  return out;
}

/**
 * Serializes every transaction that moves leads into the send queue (start,
 * retry-failed), so the "already queued elsewhere" check can't race: two
 * campaigns started at the same moment with the same lead queue it once.
 */
async function lockQueueing(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${QUEUE_LOCK_KEY}::bigint)`;
}
const QUEUE_LOCK_KEY = 0x4d41494c; // "MAIL"

export async function previewCampaign(id: string, opts: { leadIds?: string[]; limit?: number }): Promise<CampaignPreviewDTO> {
  const c = await getCampaignOr404(id);
  const settings = await getSettings();
  const all = await renderRecipients(c, settings);
  const { unknown } = await validateTemplates(c.subjectTemplate, c.bodyTemplate);
  const alreadySent = new Set(
    (await prisma.emailDelivery.findMany({ where: { campaignId: id, status: "SENT" }, select: { leadId: true } })).map((d) => d.leadId),
  );

  let willSend = 0;
  let suppressed = 0;
  let missingVariables = 0;
  let queuedElsewhere = 0;
  for (const r of all) {
    if (r.suppressed) suppressed++;
    else if (r.render.missing.length) missingVariables++;
    if (r.queuedElsewhere && !alreadySent.has(r.lead.id)) queuedElsewhere++;
    if (!r.render.skipReason && !alreadySent.has(r.lead.id)) willSend++;
  }
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const sample = opts.leadIds?.length ? all.filter((r) => opts.leadIds!.includes(r.lead.id)) : all.slice(0, limit);
  const usage = await getUsage(settings.timezone, settings.dailyLimit);
  const effectiveDailyLimit = Math.min(c.dailyLimit, settings.dailyLimit);

  return {
    items: sample.map((r) => ({
      leadId: r.lead.id,
      to: r.lead.email,
      name: leadName(r.lead) ?? r.lead.email,
      companyName: r.lead.companyName,
      subject: r.render.subject,
      body: r.render.body,
      missing: r.render.missing,
      skipped: Boolean(r.render.skipReason) || alreadySent.has(r.lead.id),
      skipReason: alreadySent.has(r.lead.id) ? "Already sent in this campaign" : r.render.skipReason,
    })),
    summary: {
      recipients: all.length,
      willSend,
      willSkip: all.length - willSend,
      suppressed,
      alreadySent: alreadySent.size,
      missingVariables,
      queuedElsewhere,
      unknownVariables: unknown,
      effectiveDailyLimit,
      remainingToday: usage.remaining,
      estimatedDays: effectiveDailyLimit > 0 ? Math.max(willSend > 0 ? 1 : 0, Math.ceil(willSend / effectiveDailyLimit)) : 0,
    },
  };
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

/** Convert a wall-clock date+time in an IANA timezone to a UTC instant. */
export function zonedTimeToUtc(date: string, time: string, timezone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw badRequest("Schedule must be date YYYY-MM-DD and time HH:mm.");
  if (!isValidTimezone(timezone)) throw badRequest(`Unknown timezone "${timezone}".`);
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Offset of the zone at that instant, applied twice to settle DST edges.
  const offset = (ts: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(ts))
        .map((p) => [p.type, p.value]),
    );
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - ts;
  };
  let ts = asUtc - offset(asUtc);
  ts = asUtc - offset(ts);
  return new Date(ts);
}

export async function startCampaign(id: string, schedule?: { date: string; time: string; timezone: string }) {
  const c = await getCampaignOr404(id);
  if (!EDITABLE.includes(c.status as (typeof EDITABLE)[number])) throw conflict(`Campaign is already ${c.status}.`);
  if (!c.subjectTemplate.trim() || !c.bodyTemplate.trim()) throw badRequest("The campaign needs a subject and a body.");
  const { unknown, malformed } = await validateTemplates(c.subjectTemplate, c.bodyTemplate);
  if (malformed.length) throw badRequest(`Malformed placeholder(s): ${malformed.join(", ")}. Use {{variable}}.`);
  if (unknown.length) throw badRequest(`Unknown variable(s): ${unknown.map((u) => `{{${u}}}`).join(", ")}. They don't match any CSV column.`);

  let scheduledAt: Date | null = null;
  if (schedule) {
    scheduledAt = zonedTimeToUtc(schedule.date, schedule.time, schedule.timezone);
    if (scheduledAt.getTime() < Date.now() - 60_000) throw badRequest("The scheduled time is in the past.");
  }

  const settings = await getSettings();
  const rendered = await renderRecipients(c, settings);
  if (!rendered.length) throw badRequest("Add at least one recipient first.");

  const enqueue = rendered.map((r) => ({
    campaignId: c.id,
    leadId: r.lead.id,
    email: r.lead.email,
    renderedSubject: r.render.subject,
    renderedBody: r.render.body,
    subjectTemplate: c.subjectTemplate,
    bodyTemplate: c.bodyTemplate,
    status: (r.render.skipReason ? "SKIPPED" : "PENDING") as DeliveryStatus,
    errorMessage: r.render.skipReason,
    errorCode: r.render.skipReason ? (r.suppressed ? "suppressed" : r.queuedElsewhere ? "queued_elsewhere" : "render_skipped") : null,
    // Scheduled campaigns: deliveries are due at the scheduled time.
    nextAttemptAt: scheduledAt && scheduledAt.getTime() > Date.now() ? scheduledAt : new Date(),
  }));
  let pendingIds: string[] = [];
  let skippedIds: string[] = [];
  const status = scheduledAt && scheduledAt.getTime() > Date.now() ? "SCHEDULED" : "RUNNING";

  await prisma.$transaction(
    async (tx) => {
      await lockQueueing(tx);
      // Re-check under the lock: another campaign may have queued some of
      // these leads since they were rendered above.
      const clash = await findQueuedElsewhere(tx, c.id, enqueue.filter((e) => e.status === "PENDING").map((e) => e.leadId));
      for (const e of enqueue) {
        const other = e.status === "PENDING" ? clash.get(e.leadId) : undefined;
        if (other !== undefined) Object.assign(e, { status: "SKIPPED", errorMessage: queuedElsewhereReason(other), errorCode: "queued_elsewhere" });
      }
      pendingIds = enqueue.filter((e) => e.status === "PENDING").map((e) => e.leadId);
      skippedIds = enqueue.filter((e) => e.status === "SKIPPED").map((e) => e.leadId);

      // Conditional transition: two concurrent "Start" clicks can't both enqueue.
      const moved = await tx.campaign.updateMany({
        where: { id: c.id, status: { in: [...EDITABLE] } },
        data: {
          status,
          scheduledAt,
          timezone: schedule?.timezone ?? c.timezone,
          startedAt: status === "RUNNING" ? new Date() : null,
          lastError: null,
          completedAt: null,
        },
      });
      if (moved.count !== 1) throw conflict("Campaign was started by another request.");
      for (let i = 0; i < enqueue.length; i += 1000) {
        await tx.emailDelivery.createMany({ data: enqueue.slice(i, i + 1000), skipDuplicates: true });
      }
      for (let i = 0; i < pendingIds.length; i += 5000) {
        await tx.lead.updateMany({ where: { id: { in: pendingIds.slice(i, i + 5000) }, status: { not: "SENT" } }, data: { status: "PENDING" } });
      }
      for (let i = 0; i < skippedIds.length; i += 5000) {
        await tx.lead.updateMany({ where: { id: { in: skippedIds.slice(i, i + 5000) }, status: { notIn: ["SENT", "PENDING"] } }, data: { status: "SKIPPED" } });
      }
    },
    { timeout: 300_000, maxWait: 10_000 },
  );
  return { ...(await campaignDTOById(c.id)), enqueued: pendingIds.length, skipped: skippedIds.length };
}

export async function pauseCampaign(id: string) {
  const r = await prisma.campaign.updateMany({ where: { id, status: { in: ["RUNNING", "SCHEDULED"] } }, data: { status: "PAUSED", pausedAt: new Date() } });
  if (!r.count) throw conflict(`Only running or scheduled campaigns can be paused (it is ${(await getCampaignOr404(id)).status}).`);
  return campaignDTOById(id);
}

export async function resumeCampaign(id: string) {
  const c = await getCampaignOr404(id);
  if (c.status !== "PAUSED") throw conflict(`Only paused campaigns can be resumed (it is ${c.status}).`);
  const status = c.scheduledAt && c.scheduledAt.getTime() > Date.now() ? "SCHEDULED" : "RUNNING";
  const r = await prisma.campaign.updateMany({
    where: { id, status: "PAUSED" },
    data: { status, pausedAt: null, lastError: null, startedAt: c.startedAt ?? (status === "RUNNING" ? new Date() : null) },
  });
  if (!r.count) throw conflict("Campaign changed state; refresh and try again.");
  // The user resuming is the signal that a halting problem (API key…) was fixed.
  await clearHalt();
  return campaignDTOById(id);
}

export async function stopCampaign(id: string) {
  const c = await getCampaignOr404(id);
  if (!["RUNNING", "PAUSED", "SCHEDULED"].includes(c.status)) throw conflict(`Campaign is ${c.status}; nothing to stop.`);
  await prisma.$transaction(async (tx) => {
    const r = await tx.campaign.updateMany({
      where: { id, status: { in: ["RUNNING", "PAUSED", "SCHEDULED"] } },
      data: { status: "STOPPED", completedAt: new Date() },
    });
    if (!r.count) throw conflict("Campaign changed state; refresh and try again.");
    const pending = await tx.emailDelivery.findMany({ where: { campaignId: id, status: "PENDING" }, select: { leadId: true } });
    await tx.emailDelivery.updateMany({
      where: { campaignId: id, status: "PENDING" },
      data: { status: "SKIPPED", errorMessage: "Campaign stopped before this email was sent", errorCode: "campaign_stopped" },
    });
    const leadIds = pending.map((p) => p.leadId);
    for (let i = 0; i < leadIds.length; i += 5000) {
      await tx.lead.updateMany({ where: { id: { in: leadIds.slice(i, i + 5000) }, status: "PENDING" }, data: { status: "SKIPPED" } });
    }
  });
  return campaignDTOById(id);
}

/** Requeue failures that may succeed on retry (not permanent / unknown-outcome). */
export async function retryFailed(id: string) {
  const c = await getCampaignOr404(id);
  if (c.status === "STOPPED") throw conflict("Stopped campaigns can't be retried.");
  if (["DRAFT", "READY"].includes(c.status)) throw conflict("Campaign hasn't started.");
  const where: Prisma.EmailDeliveryWhereInput = {
    campaignId: id,
    status: "FAILED",
    OR: [{ errorKind: null }, { errorKind: { in: ["TRANSIENT", "AUTH"] } }],
    // Never requeue a lead that another campaign has queued meanwhile.
    lead: { deliveries: { none: activeElsewhere(id) } },
  };
  // A failure whose outcome was ambiguous (timeout / 5xx) kept its idempotency
  // key: retry with the SAME key (and frozen payload) so Resend dedupes if the
  // earlier attempt was actually delivered. Past Resend's 24h key window that
  // protection is gone, so those rows are left FAILED for manual review.
  const windowStart = new Date(Date.now() - IDEMPOTENCY_WINDOW_HOURS * 3600_000);
  const fresh: Prisma.EmailDeliveryWhereInput = { AND: [where, { idempotencyKey: null }] };
  const keyed: Prisma.EmailDeliveryWhereInput = { AND: [where, { idempotencyKey: { not: null } }, { lastAttemptAt: { gt: windowStart } }] };
  const reset = { status: "PENDING" as const, attempts: 0, nextAttemptAt: new Date(), errorMessage: null, errorCode: null, errorKind: null };
  const requeued = await prisma.$transaction(async (tx) => {
    await lockQueueing(tx);
    const rows = await tx.emailDelivery.findMany({ where: { OR: [fresh, keyed] }, select: { leadId: true } });
    const a = await tx.emailDelivery.updateMany({ where: fresh, data: { ...reset, payload: Prisma.DbNull } });
    const b = await tx.emailDelivery.updateMany({ where: keyed, data: reset });
    const u = { count: a.count + b.count };
    if (u.count) {
      await tx.lead.updateMany({ where: { id: { in: rows.map((r) => r.leadId) }, status: "FAILED" }, data: { status: "PENDING" } });
      if (c.status === "COMPLETED") await tx.campaign.update({ where: { id }, data: { status: "RUNNING", completedAt: null } });
    }
    return u.count;
  });
  return { ...(await campaignDTOById(id)), requeued };
}
