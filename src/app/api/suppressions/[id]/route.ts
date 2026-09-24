import { prisma } from "@/lib/server/db";
import { handler, json } from "@/lib/server/http";

export const DELETE = handler<{ id: string }>(async (_req, { params }) => {
  await prisma.suppression.delete({ where: { id: (await params).id } });
  return json({ ok: true });
});
