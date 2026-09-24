import { prisma } from "./db";
import { badRequest, HttpError } from "./http";
import { getSettings } from "./settings";
import { buildOutgoing, renderForLead } from "./compose";
import { rateLimit } from "./rate-limit";
import { isValidEmail, normalizeEmail } from "@/lib/email-address";
import { getTransport } from "@/lib/email/resend";

export async function sendTemplateTestEmail(input: { to: string; leadId: string; subject: string; body: string; templateId: string }) {
  const to = normalizeEmail(input.to);
  if (!isValidEmail(to)) throw badRequest("Enter a valid test recipient address.");
  if (!rateLimit("test-email", 30, 60 * 60_000).ok) throw new HttpError(429, "Test email limit reached (30/hour).");
  const [lead, template] = await Promise.all([
    prisma.lead.findUnique({ where: { id: input.leadId } }),
    prisma.template.findUnique({ where: { id: input.templateId }, select: { id: true } }),
  ]);
  if (!lead) throw badRequest("Pick a lead to personalize the test email with.");
  if (!template) throw badRequest("Template not found.");
  const settings = await getSettings();
  const r = renderForLead(input.subject, input.body, lead, settings);
  if (!r.subject.trim() || !r.body.trim()) throw badRequest("Subject and body can't be empty.");
  const subject = `[TEST] ${r.subject}`;
  const body = `[TEST EMAIL — personalized for ${lead.email}. Not part of any campaign; does not count toward the daily limit.]\n${r.missing.length ? `[Unresolved variables: ${r.missing.map((m) => `{{${m}}}`).join(", ")} — this lead would be SKIPPED in a campaign.]\n` : ""}\n${r.body}`;
  const outgoing = buildOutgoing({ to, subject, body, tags: [{ name: "type", value: "test" }, { name: "template", value: input.templateId }] }, settings);
  const res = await getTransport().send(outgoing);
  await prisma.testEmail.create({ data: { to, leadId: lead.id, campaignId: null, renderedSubject: subject, renderedBody: body, status: res.ok ? "SENT" : "FAILED", providerMessageId: res.ok ? res.id : null, errorMessage: res.ok ? null : res.error.message } });
  if (!res.ok) throw new HttpError(502, `Test email failed: ${res.error.message} (${res.error.code})`);
  return { ok: true as const, providerMessageId: res.id };
}
