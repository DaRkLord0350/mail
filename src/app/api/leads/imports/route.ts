import { prisma } from "@/lib/server/db";
import { handler, json } from "@/lib/server/http";
import { importSummaryDTO } from "@/lib/server/dto";

export const GET = handler(async () => {
  const batches = await prisma.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  return json({ items: batches.map((b) => importSummaryDTO(b, 200)) });
});
