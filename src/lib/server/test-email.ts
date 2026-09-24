import { prisma } from "./db";
import { badRequest, HttpError } from "./http";
import { getSettings } from "./settings";
import { buildOutgoing, renderForLead } from "./compose";
import { rateLimit } from "./rate-limit";
import { getTransport, resendTransport } from "@/lib/email/resend";
import { env } from "./env";
import { isValidEmail, normalizeEmail } from "@/lib/email-address";

/**
 * Send a TEST email rendered with a real lead's data to an arbitrary address.
 * Never touches the daily quota, deliveries or lead status; logged in TestEmail.
 */
export async function sendTestEmail(input: { to: string; leadId: string; subject: string; body: string; campaignId?: string }) {
  const to = normalizeEmail(input.to);
  if (!isValidEmail(to)) throw badRequest("Enter a valid test recipient address.");
  if (!rateLimit("test-email", 30, 60 * 60_000).ok) throw new HttpError(429, "Test email limit reached (30/hour).");

  const lead = await prisma.lead.findUnique({ where: { id: input.leadId } });
  if (!lead) throw badRequest("Pick a lead to personalize the test email with.");
  const settings = await getSettings();
  // Personalize with the lead's data, but the unsubscribe link must point at
  // the TEST recipient — clicking it must never suppress the real lead.
  const r = renderForLead(input.subject, input.body, lead, settings, { unsubscribeFor: to });
  if (!r.subject.trim() || !r.body.trim()) throw badRequest("Subject and body can't be empty.");

  const banner = `[TEST EMAIL — personalized for ${lead.email}. Not part of any campaign; does not count toward the daily limit.]`;
  const subject = `[TEST] ${r.subject}`;
  const body = `${banner}\n${r.missing.length ? `[Unresolved variables: ${r.missing.map((m) => `{{${m}}}`).join(", ")} — this lead would be SKIPPED in a campaign.]\n` : ""}\n${r.body}`;

  let outgoing;
  try {
    outgoing = buildOutgoing({ to, subject, body, tags: [{ name: "type", value: "test" }] }, settings);
  } catch (e) {
    throw badRequest(e instanceof Error ? e.message : String(e));
  }
  if (!env.resendApiKey && getTransport() === resendTransport) {
    throw badRequest("RESEND_API_KEY is not configured on the server, so test emails can't be sent yet.");
  }
  const res = await getTransport().send(outgoing);
  await prisma.testEmail.create({
    data: {
      to,
      leadId: lead.id,
      campaignId: input.campaignId ?? null,
      renderedSubject: subject,
      renderedBody: body,
      status: res.ok ? "SENT" : "FAILED",
      providerMessageId: res.ok ? res.id : null,
      errorMessage: res.ok ? null : res.error.message,
    },
  });
  if (!res.ok) throw new HttpError(502, `Test email failed: ${res.error.message} (${res.error.code})`);
  return { ok: true as const, providerMessageId: res.id };
}
