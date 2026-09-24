"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { DeliveryDTO, DeliveryStatus, Paginated } from "@/lib/types";
import { qs } from "@/lib/client/api";
import { useApiQuery } from "@/lib/client/hooks";
import { StatusBadge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/feedback";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import { DateStack, DueTime } from "@/components/ui/time";
import { DeliveryDrawer } from "@/components/delivery-drawer";

export type DeliveriesVariant = "history" | "queue" | "campaign";

function recipientCell(d: DeliveryDTO) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-medium text-slate-900">{d.leadName || d.email}</span>
      {d.leadName && <span className="truncate text-xs text-slate-500">{d.email}</span>}
    </span>
  );
}

function campaignCell(d: DeliveryDTO) {
  return (
    <Link href={`/campaigns/${d.campaignId}`} onClick={(e) => e.stopPropagation()} className="block truncate text-indigo-700 hover:underline">
      {d.campaignName}
    </Link>
  );
}

function errorCell(d: DeliveryDTO) {
  return d.errorMessage ? (
    <span className="line-clamp-2 text-xs text-red-700" title={d.errorMessage}>
      {d.errorCode ? <span className="font-mono">[{d.errorCode}] </span> : null}
      {d.errorMessage}
    </span>
  ) : (
    <span className="text-slate-400">—</span>
  );
}

function columnsFor(variant: DeliveriesVariant): Column<DeliveryDTO>[] {
  const status: Column<DeliveryDTO> = { key: "status", header: "Status", cell: (d) => <StatusBadge status={d.status} /> };
  if (variant === "queue") {
    return [
      { key: "recipient", header: "Recipient", primary: true, className: "max-w-64", cell: recipientCell },
      { key: "campaign", header: "Campaign", className: "max-w-48", cell: campaignCell },
      status,
      { key: "attempts", header: "Attempts", className: "tabular-nums", cell: (d) => d.attempts },
      {
        key: "next",
        header: "Next attempt",
        cell: (d) => (d.status === "PROCESSING" ? <span className="text-sky-700">Sending now…</span> : <DueTime value={d.nextAttemptAt} className="whitespace-nowrap" />),
      },
      { key: "error", header: "Last error", className: "max-w-72", cell: errorCell },
    ];
  }
  const date: Column<DeliveryDTO> = {
    key: "date",
    header: "Date",
    cell: (d) => <DateStack value={d.sentAt ?? d.lastAttemptAt ?? d.createdAt} />,
  };
  const subject: Column<DeliveryDTO> = {
    key: "subject",
    header: "Subject",
    className: "max-w-72",
    cell: (d) => (
      <span className="line-clamp-2 break-words" title={d.renderedSubject}>
        {d.renderedSubject || <span className="text-slate-400">—</span>}
      </span>
    ),
  };
  const provider: Column<DeliveryDTO> = {
    key: "provider",
    header: "Provider ID",
    hideOnMobile: true,
    className: "max-w-40",
    cell: (d) =>
      d.providerMessageId ? (
        <span className="block truncate font-mono text-xs text-slate-500" title={d.providerMessageId}>
          {d.providerMessageId}
        </span>
      ) : (
        <span className="text-slate-400">—</span>
      ),
  };
  if (variant === "campaign") {
    return [
      { key: "recipient", header: "Recipient", primary: true, className: "max-w-64", cell: recipientCell },
      { key: "company", header: "Company", className: "max-w-40", cell: (d) => <span className="block truncate">{d.companyName || "—"}</span> },
      status,
      date,
      { key: "attempts", header: "Attempts", className: "tabular-nums", hideOnMobile: true, cell: (d) => d.attempts },
      { key: "error", header: "Error", className: "max-w-64", cell: errorCell },
    ];
  }
  return [
    date,
    { key: "recipient", header: "Recipient", primary: true, className: "max-w-60", cell: recipientCell },
    { key: "company", header: "Company", className: "max-w-40", cell: (d) => <span className="block truncate">{d.companyName || "—"}</span> },
    { key: "campaign", header: "Campaign", className: "max-w-44", cell: campaignCell },
    subject,
    status,
    provider,
  ];
}

/**
 * Paginated deliveries list + detail drawer. Parent should pass a `key`
 * derived from the query so pagination resets when filters change.
 */
export function DeliveriesTable({
  query,
  variant,
  refreshMs,
  empty,
}: {
  query: { status?: DeliveryStatus; campaignId?: string; search?: string };
  variant: DeliveriesVariant;
  refreshMs?: number;
  empty: ReactNode;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, error, loading, reload } = useApiQuery<Paginated<DeliveryDTO>>(`/api/deliveries${qs({ ...query, page, pageSize })}`, { refreshMs });

  return (
    <>
      {error && !data ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <DataTable
          caption="Deliveries"
          columns={columnsFor(variant)}
          rows={data?.items}
          rowKey={(d) => d.id}
          onRowClick={(d) => setOpenId(d.id)}
          rowLabel={(d) => `Open delivery to ${d.email}`}
          loading={loading}
          empty={empty}
        />
      )}
      {data && data.total > 0 && (
        <Pagination
          page={data.page}
          pageSize={pageSize}
          total={data.total}
          itemLabel="emails"
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      )}
      <DeliveryDrawer deliveryId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
