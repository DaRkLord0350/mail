import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { handler, json, notFound, readJson } from "@/lib/server/http";
import { getSettings } from "@/lib/server/settings";
import { renderForLead } from "@/lib/server/compose";
import { validateTemplates } from "@/lib/server/campaigns";
import { textToHtml } from "@/lib/template/render";
import type { RenderPreviewDTO } from "@/lib/types";

const Body = z.object({ subject: z.string().max(998), body: z.string().max(100_000), leadId: z.string().min(1) });

// Renders exactly what the lead would receive. Never sends anything.
export const POST = handler(async (req) => {
  const { subject, body, leadId } = await readJson(req, Body);
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw notFound("Lead not found");
  const [settings, suppressed, { unknown }] = await Promise.all([
    getSettings(),
    prisma.suppression.findUnique({ where: { email: lead.email } }),
    validateTemplates(subject, body),
  ]);
  const r = renderForLead(subject, body, lead, settings, { suppressed: Boolean(suppressed) });
  const dto: RenderPreviewDTO = {
    to: lead.email,
    subject: r.subject,
    body: r.body,
    html: textToHtml(r.body),
    missing: r.missing,
    unknown,
    skipped: Boolean(r.skipReason),
    skipReason: r.skipReason,
  };
  return json(dto);
});
