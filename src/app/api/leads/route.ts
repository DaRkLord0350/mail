import { handler, json, pagination, searchParams } from "@/lib/server/http";
import { leadStatusCounts, listLeads } from "@/lib/server/leads";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/types";

export const GET = handler(async (req) => {
  const sp = searchParams(req);
  const { page, pageSize, skip, take } = pagination(sp);
  const statusParam = sp.get("status")?.toUpperCase();
  const status = LEAD_STATUSES.includes(statusParam as LeadStatus) ? (statusParam as LeadStatus) : undefined;
  const search = sp.get("search")?.slice(0, 200) || undefined;
  const [{ items, total }, statusCounts] = await Promise.all([
    listLeads({ search, status, notContacted: sp.get("notContacted") === "true", sort: sp.get("sort") ?? undefined, order: sp.get("order") ?? undefined, skip, take }),
    leadStatusCounts(search),
  ]);
  return json({ items, total, page, pageSize, statusCounts });
});
