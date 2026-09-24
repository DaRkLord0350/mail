import { prisma } from "@/lib/server/db";
import { handler, json, notFound } from "@/lib/server/http";
import { deliveryDetailDTO, deliveryInclude } from "@/lib/server/dto";

export const GET = handler<{ id: string }>(async (_req, { params }) => {
  const d = await prisma.emailDelivery.findUnique({ where: { id: (await params).id }, include: deliveryInclude });
  if (!d) throw notFound("Delivery not found");
  return json(deliveryDetailDTO(d));
});
