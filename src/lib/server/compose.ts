import { renderEmail, leadContext, textToHtml, type LeadLike, type RenderedEmail } from "@/lib/template/render";
import { isValidEmail } from "@/lib/email-address";
import type { OutgoingEmail } from "@/lib/email/resend";
import { formatSender, type EffectiveSettings } from "./settings";
import { unsubscribePostUrl, unsubscribeUrl } from "./tokens";

export const UNSUBSCRIBE_FOOTER = (url: string) => `\n\n--\nNot interested? Unsubscribe here: ${url}`;

export interface LeadRender extends RenderedEmail {
  to: string;
  skipReason: string | null;
}

/**
 * Render subject/body for one lead exactly as it will be sent (including the
 * unsubscribe footer), and decide whether the lead must be skipped.
 */
export function renderForLead(
  subjectTemplate: string,
  bodyTemplate: string,
  lead: LeadLike,
  settings: EffectiveSettings,
  opts: { suppressed?: boolean; /** Address the unsubscribe link is for (test sends use the tester's). */ unsubscribeFor?: string } = {},
): LeadRender {
  const unsub = unsubscribeUrl(opts.unsubscribeFor ?? lead.email);
  const ctx = leadContext(lead, { unsubscribe_url: unsub });
  const r = renderEmail(subjectTemplate, bodyTemplate, ctx, {
    behavior: settings.missingVariableBehavior,
    fallbacks: settings.fallbackValues,
  });
  let body = r.body;
  if (settings.includeUnsubscribe && !/\{\{\s*unsubscribe_url\s*(\|[^}]*)?\}\}/i.test(bodyTemplate)) {
    body += UNSUBSCRIBE_FOOTER(unsub);
  }

  let skipReason: string | null = null;
  if (opts.suppressed) skipReason = "Email address is on the suppression list";
  else if (!isValidEmail(lead.email)) skipReason = "Invalid email address";
  else if (r.blocked) skipReason = `Missing personalization: ${r.missing.map((m) => `{{${m}}}`).join(", ")}`;
  else if (!r.subject.trim()) skipReason = "Rendered subject is empty";
  else if (!body.trim()) skipReason = "Rendered body is empty";

  return { ...r, body, to: lead.email, skipReason };
}

export function buildOutgoing(
  args: { to: string; subject: string; body: string; idempotencyKey?: string; tags?: { name: string; value: string }[] },
  settings: EffectiveSettings,
): OutgoingEmail {
  const from = formatSender(settings);
  if (!from) throw new Error("Sender is not configured: set FROM_EMAIL (or From Email in Settings).");
  const headers: Record<string, string> = {};
  if (settings.includeUnsubscribe) {
    headers["List-Unsubscribe"] = `<${unsubscribePostUrl(args.to)}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return {
    from,
    to: args.to,
    subject: args.subject,
    text: args.body,
    html: textToHtml(args.body),
    replyTo: settings.replyTo || undefined,
    headers,
    tags: args.tags,
    idempotencyKey: args.idempotencyKey,
  };
}
