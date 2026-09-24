import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { dbSchema, t } from "@/lib/server/sql";
import { setTransport, type EmailTransport, type OutgoingEmail, type SendResult } from "@/lib/email/resend";
import { runWorker, type WorkerOptions } from "@/lib/server/worker";
import { createCampaign, startCampaign, updateRecipients } from "@/lib/server/campaigns";

export const SENDER = "sender@example.com";

const TABLES = [
  "EmailDelivery",
  "CampaignLead",
  "Campaign",
  "Template",
  "Lead",
  "ImportBatch",
  "Suppression",
  "DailyUsage",
  "TestEmail",
  "Settings",
  "WorkerState",
];

/** TRUNCATE every MAIL table in `mail_test` and re-seed the singleton rows. */
export async function resetDatabase(): Promise<void> {
  const schema = dbSchema();
  if (schema !== "mail_test") throw new Error(`Refusing to reset schema "${schema}" — only mail_test may be reset.`);
  const list = TABLES.map((n) => `"${schema}"."${n}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  await prisma.$executeRaw`INSERT INTO ${t("WorkerState")} ("id", "nextSendAt", "updatedAt") VALUES (1, now(), now()) ON CONFLICT DO NOTHING`;
  await prisma.$executeRaw`INSERT INTO ${t("Settings")} ("id", "updatedAt") VALUES (1, now()) ON CONFLICT DO NOTHING`;
  await prisma.settings.update({ where: { id: 1 }, data: { fromEmail: SENDER, fromName: "Test Sender", dailyLimit: 100, sendDelaySeconds: 0 } });
  // Safety net: nothing may ever reach the real Resend API from a test.
  setTransport(new FakeTransport());
}

export async function updateSettings(data: Prisma.SettingsUpdateInput) {
  await prisma.settings.update({ where: { id: 1 }, data });
}

// ─── Fake transport ─────────────────────────────────────────────────────────

export type Scripted = SendResult | ((email: OutgoingEmail, callIndex: number) => SendResult | Promise<SendResult>);

export const errorResult = (code: string, statusCode: number | null, message = code): SendResult => ({
  ok: false,
  error: { code, message, statusCode },
});

/**
 * Records every send. Results come from `script` (consumed in order), then
 * from `byEmail[to]`, then default success.
 */
export class FakeTransport implements EmailTransport {
  calls: OutgoingEmail[] = [];
  script: Scripted[] = [];
  byEmail = new Map<string, Scripted>();
  private n = 0;

  constructor(script: Scripted[] = []) {
    this.script = [...script];
  }

  async send(email: OutgoingEmail): Promise<SendResult> {
    const i = this.calls.length;
    this.calls.push(email);
    const s = this.script.length ? this.script.shift()! : this.byEmail.get(email.to);
    if (s) return typeof s === "function" ? s(email, i) : s;
    return { ok: true, id: `msg_${++this.n}_${email.to}` };
  }

  async testConnection() {
    return { ok: true, message: "fake" };
  }

  get recipients() {
    return this.calls.map((c) => c.to);
  }
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

export interface LeadSeed {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  metadata?: Record<string, string>;
}

export function leadSeeds(n: number, prefix = "lead"): LeadSeed[] {
  return Array.from({ length: n }, (_, i) => ({
    email: `${prefix}${String(i + 1).padStart(4, "0")}@example.com`,
    firstName: `First${i + 1}`,
    lastName: `Last${i + 1}`,
    companyName: `Company ${i + 1}`,
  }));
}

/** Create leads one statement at a time so ids/createdAt follow array order. */
export async function createLeads(seeds: LeadSeed[]) {
  await prisma.lead.createMany({
    data: seeds.map((s) => ({
      email: s.email,
      firstName: s.firstName ?? null,
      lastName: s.lastName ?? null,
      companyName: s.companyName ?? null,
      metadata: s.metadata ?? {},
    })),
  });
  const rows = await prisma.lead.findMany({ where: { email: { in: seeds.map((s) => s.email) } } });
  const byEmail = new Map(rows.map((r) => [r.email, r]));
  return seeds.map((s) => byEmail.get(s.email)!);
}

export interface CampaignSetup {
  leads?: LeadSeed[] | number;
  name?: string;
  subject?: string;
  body?: string;
  dailyLimit?: number;
  start?: boolean;
  schedule?: { date: string; time: string; timezone: string };
  prefix?: string;
}

export async function setupCampaign(opts: CampaignSetup = {}) {
  const seeds = typeof opts.leads === "number" || opts.leads === undefined ? leadSeeds(opts.leads ?? 3, opts.prefix) : opts.leads;
  const leads = await createLeads(seeds);
  const c = await createCampaign({
    name: opts.name ?? "Test campaign",
    subjectTemplate: opts.subject ?? "Hello {{first_name}}",
    bodyTemplate: opts.body ?? "Hi {{first_name}},\n\nA note for {{company_name}}.",
    dailyLimit: opts.dailyLimit,
  });
  // Add recipients in order (one by one keeps CampaignLead order == lead order).
  await updateRecipients(c.id, { mode: "set", leadIds: leads.map((l) => l.id) });
  if (opts.start !== false) await startCampaign(c.id, opts.schedule);
  return { campaignId: c.id, leads };
}

export function work(transport: EmailTransport, opts: WorkerOptions = {}) {
  return runWorker({
    transport,
    delaySeconds: 0,
    sleep: async () => {},
    batchSize: 1000,
    maxRuntimeMs: 900_000,
    ...opts,
  });
}

export async function deliveries(campaignId: string) {
  return prisma.emailDelivery.findMany({ where: { campaignId }, include: { lead: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}

export async function deliveryByEmail(campaignId: string, email: string) {
  return prisma.emailDelivery.findUniqueOrThrow({ where: { campaignId_email: { campaignId, email } } });
}

export async function globalUsage(): Promise<number> {
  const rows = await prisma.dailyUsage.findMany({ where: { scope: "global" } });
  return rows.reduce((a, r) => a + r.emailsSent, 0);
}

export async function makeDue(campaignId?: string) {
  await prisma.emailDelivery.updateMany({ where: { status: "PENDING", ...(campaignId ? { campaignId } : {}) }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
}
