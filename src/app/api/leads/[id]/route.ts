import { prisma } from "@/lib/server/db";
import { conflict, handler, json, notFound } from "@/lib/server/http";
import { enrichLeads } from "@/lib/server/leads";

export const GET = handler<{ id: string }>(async (_req, { params }) => {
  const { id } = await params;
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) throw notFound("Lead not found");
  return json((await enrichLeads([lead]))[0]);
});

export const DELETE = handler<{ id: string }>(async (_req, { params }) => {
  const { id } = await params;
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) throw notFound("Lead not found");
  const history = await prisma.emailDelivery.count({ where: { leadId: id } });
  if (history > 0) {
    throw conflict("This lead has send history, which is kept for auditing. Add the address to the suppression list instead to stop emailing it.");
  }
  await prisma.lead.delete({ where: { id } });
  return json({ ok: true });
});
