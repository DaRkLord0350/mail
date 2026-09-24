"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Megaphone, Plus } from "lucide-react";
import type { CampaignDTO } from "@/lib/types";
import { useApiQuery } from "@/lib/client/hooks";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/feedback";
import { DataTable, type Column } from "@/components/ui/data-table";
import { TimeAgo } from "@/components/ui/time";
import { CampaignProgress } from "@/components/campaign-progress";
import { formatNumber } from "@/lib/utils";

export function CampaignsList() {
  const router = useRouter();
  const { data, error, reload } = useApiQuery<{ items: CampaignDTO[] }>("/api/campaigns", { refreshMs: 15_000 });

  const columns: Column<CampaignDTO>[] = [
    {
      key: "name",
      header: "Campaign",
      primary: true,
      cell: (c) => (
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <Link href={`/campaigns/${c.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-slate-900 hover:text-indigo-700">
            {c.name}
          </Link>
          <span className="md:hidden">
            <StatusBadge status={c.status} />
          </span>
        </span>
      ),
    },
    { key: "status", header: "Status", hideOnMobile: true, cell: (c) => <StatusBadge status={c.status} /> },
    { key: "progress", header: "Progress", className: "min-w-56", mobileNoLabel: true, cell: (c) => <CampaignProgress campaign={c} size="sm" /> },
    { key: "recipients", header: "Recipients", className: "tabular-nums", cell: (c) => formatNumber(c.recipientCount) },
    { key: "limit", header: "Daily limit", className: "tabular-nums", hideOnMobile: true, cell: (c) => formatNumber(c.dailyLimit) },
    { key: "created", header: "Created", cell: (c) => <TimeAgo value={c.createdAt} className="whitespace-nowrap" /> },
    {
      key: "started",
      header: "Started",
      cell: (c) =>
        c.startedAt ? (
          <TimeAgo value={c.startedAt} className="whitespace-nowrap" />
        ) : c.status === "SCHEDULED" && c.scheduledAt ? (
          <span className="whitespace-nowrap text-purple-700">
            Scheduled <TimeAgo value={c.scheduledAt} />
          </span>
        ) : c.status === "STOPPED" || c.status === "COMPLETED" ? (
          <span className="text-slate-500">Never started</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: "open",
      header: <span className="sr-only">Actions</span>,
      mobileNoLabel: true,
      hideOnMobile: true,
      className: "text-right",
      cell: (c) => (
        <ButtonLink href={`/campaigns/${c.id}`} variant="secondary" size="sm" onClick={(e) => e.stopPropagation()}>
          Open
        </ButtonLink>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="A campaign = a template + a set of recipients, sent at your daily limit."
        actions={
          <ButtonLink href="/campaigns/new">
            <Plus /> New campaign
          </ButtonLink>
        }
      />
      <Card>
        {error && !data ? (
          <ErrorState message={error} onRetry={reload} />
        ) : (
          <DataTable
            caption="Campaigns"
            columns={columns}
            rows={data?.items}
            rowKey={(c) => c.id}
            onRowClick={(c) => router.push(`/campaigns/${c.id}`)}
            rowLabel={(c) => `Open campaign ${c.name}`}
            empty={
              <EmptyState
                icon={<Megaphone />}
                title="No campaigns yet"
                description="Create a campaign from a template, add recipients, preview every email, then start sending."
                action={
                  <ButtonLink href="/campaigns/new">
                    <Plus /> Create your first campaign
                  </ButtonLink>
                }
              />
            }
          />
        )}
      </Card>
    </>
  );
}
