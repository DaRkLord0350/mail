import { prisma } from "./db";
import { env } from "./env";
import { getSettings, formatSender } from "./settings";
import { getUsage } from "./quota";
import { leadStatusCounts } from "./leads";
import { toDTOs } from "./campaigns";
import { deliveryDTO, deliveryInclude, emptyDeliveryCounts } from "./dto";
import { iso } from "./http";
import type { DashboardDTO, DeliveryStatus, WorkerResultDTO } from "@/lib/types";

export async function getDashboard(): Promise<DashboardDTO> {
  const settings = await getSettings();
  const [usage, leads, deliveryGroups, campaigns, recent, worker, templates, campaignCount] = await Promise.all([
    getUsage(settings.timezone, settings.dailyLimit),
    leadStatusCounts(),
    prisma.emailDelivery.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.campaign.findMany({ orderBy: [{ updatedAt: "desc" }], take: 10, where: { status: { in: ["RUNNING", "SCHEDULED", "PAUSED", "READY", "DRAFT", "COMPLETED", "STOPPED"] } } }),
    prisma.emailDelivery.findMany({ where: { lastAttemptAt: { not: null } }, orderBy: { lastAttemptAt: "desc" }, take: 10, include: deliveryInclude }),
    prisma.workerState.findUnique({ where: { id: 1 } }),
    prisma.template.count(),
    prisma.campaign.count(),
  ]);
  const counts = emptyDeliveryCounts();
  let total = 0;
  for (const g of deliveryGroups) { counts[g.status as DeliveryStatus] = g._count._all; total += g._count._all; }
  const rank: Record<string, number> = { RUNNING: 0, SCHEDULED: 1, PAUSED: 2, READY: 3, DRAFT: 4, COMPLETED: 5, STOPPED: 6 };
  campaigns.sort((a, b) => rank[a.status] - rank[b.status]);
  return {
    usage,
    leads,
    deliveries: { total, counts },
    campaigns: await toDTOs(campaigns),
    recent: recent.map(deliveryDTO),
    worker: { lastRunAt: iso(worker?.lastRunAt), nextSendAt: iso(worker?.nextSendAt), lastResult: (worker?.lastResult as unknown as WorkerResultDTO | null) ?? null, haltedReason: worker?.haltedReason ?? null },
    setup: {
      gmailConfigured: Boolean(env.googleRefreshToken),
      senderConfigured: Boolean(formatSender(settings)),
      hasLeads: leads.total > 0,
      hasTemplates: templates > 0,
      hasCampaigns: campaignCount > 0,
    },
  };
}
