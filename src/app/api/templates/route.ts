import { prisma } from "@/lib/server/db";
import { handler, json, readJson } from "@/lib/server/http";
import { templateDTO } from "@/lib/server/dto";
import { TemplateBody } from "./schemas";

export const GET = handler(async () => {
  const items = await prisma.template.findMany({ orderBy: { updatedAt: "desc" } });
  return json({ items: items.map(templateDTO) });
});

export const POST = handler(async (req) => {
  const data = await readJson(req, TemplateBody);
  return json(templateDTO(await prisma.template.create({ data })), 201);
});
