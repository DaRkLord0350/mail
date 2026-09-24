import { renderEmail, leadContext, textToHtml, type LeadLike, type RenderedEmail } from "@/lib/template/render";
import { isValidEmail } from "@/lib/email-address";
import type { OutgoingEmail } from "@/lib/email/resend";
import { formatSender, type EffectiveSettings } from "./settings";

export interface LeadRender extends RenderedEmail {
  to: string;
  skipReason: string | null;
}

/** Render subject/body exactly as it will be sent and decide whether the lead must be skipped. */
export function renderForLead(
  subjectTemplate: string,
  bodyTemplate: string,
  lead: LeadLike,
  settings: EffectiveSettings,
  opts: { suppressed?: boolean } = {},
): LeadRender {
  // Personal 1-to-1 mail: no unsubscribe variable or footer is injected.
  const ctx = leadContext(lead);
  const r = renderEmail(subjectTemplate, bodyTemplate, ctx, {
    behavior: settings.missingVariableBehavior,
    fallbacks: settings.fallbackValues,
  });

  let skipReason: string | null = null;
  if (opts.suppressed) skipReason = "Email address is on the suppression list";
  else if (!isValidEmail(lead.email)) skipReason = "Invalid email address";
  else if (r.blocked) skipReason = `Missing personalization: ${r.missing.map((m) => `{{${m}}}`).join(", ")}`;
  else if (!r.subject.trim()) skipReason = "Rendered subject is empty";
  else if (!r.body.trim()) skipReason = "Rendered body is empty";

  return { ...r, to: lead.email, skipReason };
}

export function buildOutgoing(
  args: { to: string; subject: string; body: string; idempotencyKey?: string; tags?: { name: string; value: string }[] },
  settings: EffectiveSettings,
): OutgoingEmail {
  const from = formatSender(settings);
  if (!from) throw new Error("Sender is not configured: set FROM_EMAIL (or From Email in Settings).");
  return {
    from,
    to: args.to,
    subject: args.subject,
    text: args.body,
    html: textToHtml(args.body),
    replyTo: settings.replyTo || undefined,
    // Deliberately no List-Unsubscribe headers: this app is configured for
    // direct, personal outreach rather than newsletter-style mail.
    headers: {},
    tags: args.tags,
    idempotencyKey: args.idempotencyKey,
  };
}
