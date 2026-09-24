import { prisma } from "@/lib/server/db";
import { handler, json, notFound, readJson } from "@/lib/server/http";
import { templateDTO } from "@/lib/server/dto";
import { TemplateBody } from "../schemas";

export const GET = handler<{ id: string }>(async (_req, { params }) => {
  const t = await prisma.template.findUnique({ where: { id: (await params).id } });
  if (!t) throw notFound("Template not found");
  return json(templateDTO(t));
});

export const PUT = handler<{ id: string }>(async (req, { params }) => {
  const data = await readJson(req, TemplateBody.partial());
  return json(templateDTO(await prisma.template.update({ where: { id: (await params).id }, data })));
});

// Campaigns keep their own copy of the template, so deleting is always safe.
export const DELETE = handler<{ id: string }>(async (_req, { params }) => {
  await prisma.template.delete({ where: { id: (await params).id } });
  return json({ ok: true });
});
