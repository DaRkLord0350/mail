import { z } from "zod";
import { handler, json, pagination, readJson, searchParams } from "@/lib/server/http";
import { listRecipients, updateRecipients } from "@/lib/server/campaigns";
import { enrichLeads } from "@/lib/server/leads";
import { LEAD_STATUSES } from "@/lib/types";

const Body = z.object({
  mode: z.enum(["add", "remove", "set", "clear"]),
  leadIds: z.array(z.string().min(1)).max(100_000).optional(),
  filter: z
    .object({ status: z.enum(LEAD_STATUSES).optional(), search: z.string().max(200).optional(), notContacted: z.boolean().optional() })
    .optional(),
});

export const GET = handler<{ id: string }>(async (req, { params }) => {
  const sp = searchParams(req);
  const { page, pageSize, skip, take } = pagination(sp);
  const { rows, total, deliveryStatus } = await listRecipients((await params).id, { search: sp.get("search") || undefined, skip, take });
  const leads = await enrichLeads(rows.map((r) => r.lead));
  return json({ items: leads.map((lead) => ({ lead, deliveryStatus: deliveryStatus.get(lead.id) ?? null })), total, page, pageSize });
});

export const POST = handler<{ id: string }>(async (req, { params }) => json(await updateRecipients((await params).id, await readJson(req, Body))));
