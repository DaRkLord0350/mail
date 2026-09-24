"use client";

import Link from "next/link";
import { useState } from "react";
import { Ban, Search, Trash, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { LEAD_STATUSES, type LeadDTO, type LeadStatus, type Paginated, type StatusCounts } from "@/lib/types";
import { api, qs } from "@/lib/client/api";
import { useApiQuery, useDebouncedValue } from "@/lib/client/hooks";
import { ButtonLink, Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/feedback";
import { Tabs } from "@/components/ui/tabs";
import { Pagination } from "@/components/ui/pagination";
import { DataTable, type Column, type SortState } from "@/components/ui/data-table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TimeAgo } from "@/components/ui/time";
import { Spinner } from "@/components/ui/spinner";
import { LeadDrawer, websiteHref } from "@/components/leads/lead-drawer";
import { leadDisplayName } from "@/lib/utils";

type LeadsResponse = Paginated<LeadDTO> & { statusCounts: StatusCounts<LeadStatus> };
type StatusFilter = "ALL" | LeadStatus;

export function LeadsView() {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 300);
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [sort, setSort] = useState<SortState>({ key: "createdAt", order: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<LeadDTO | null>(null);
  const [toDelete, setToDelete] = useState<LeadDTO | null>(null);

  const url = `/api/leads${qs({
    search: debounced,
    status: status === "ALL" ? undefined : status,
    sort: sort.key,
    order: sort.order,
    page,
    pageSize,
  })}`;
  const { data, error, loading, reload } = useApiQuery<LeadsResponse>(url);

  const counts = data?.statusCounts;
  const tabs = [
    { value: "ALL" as StatusFilter, label: "All", count: counts?.total },
    ...LEAD_STATUSES.map((s) => ({ value: s as StatusFilter, label: s.charAt(0) + s.slice(1).toLowerCase(), count: counts?.counts[s] })),
  ];

  const columns: Column<LeadDTO>[] = [
    {
      key: "name",
      header: "Name",
      sortKey: "name",
      primary: true,
      cell: (l) => (
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="font-medium text-slate-900">{leadDisplayName(l) || <span className="text-slate-400">—</span>}</span>
          {l.suppressed && (
            <Badge tone="red" title="On the suppression list — will never be emailed">
              <Ban className="size-3" aria-hidden="true" /> Suppressed
            </Badge>
          )}
          <span className="block w-full truncate text-xs font-normal text-slate-500 md:hidden">{l.email}</span>
        </span>
      ),
    },
    { key: "company", header: "Company", sortKey: "company", cell: (l) => l.companyName || <span className="text-slate-400">—</span> },
    {
      key: "email",
      header: "Email",
      sortKey: "email",
      hideOnMobile: true,
      className: "max-w-56",
      cell: (l) => <span className="block truncate" title={l.email}>{l.email}</span>,
    },
    {
      key: "website",
      header: "Website",
      // Shown in mobile cards and the lead drawer; only in the table on wide screens so it fits at 1280px.
      className: "hidden max-w-44 2xl:table-cell",
      headerClassName: "hidden 2xl:table-cell",
      cell: (l) =>
        l.website ? (
          <a
            href={websiteHref(l.website)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="block truncate text-indigo-700 hover:underline"
            title={l.website}
          >
            {l.website.replace(/^https?:\/\//i, "").replace(/\/$/, "")}
          </a>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    { key: "status", header: "Status", sortKey: "status", cell: (l) => <StatusBadge status={l.status} /> },
    {
      key: "lastSent",
      header: "Last Sent",
      sortKey: "lastSent",
      cell: (l) => <TimeAgo value={l.lastSentAt} fallback="Never" className="whitespace-nowrap text-slate-600" />,
    },
    {
      key: "campaign",
      header: "Campaign",
      className: "max-w-40",
      cell: (l) =>
        l.lastCampaign ? (
          <Link
            href={`/campaigns/${l.lastCampaign.id}`}
            onClick={(e) => e.stopPropagation()}
            className="block truncate text-indigo-700 hover:underline"
          >
            {l.lastCampaign.name}
          </Link>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      mobileNoLabel: true,
      className: "w-10 text-right",
      cell: (l) => (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${l.email}`}
          title="Delete lead"
          onClick={(e) => {
            e.stopPropagation();
            setToDelete(l);
          }}
        >
          <Trash className="text-slate-400 hover:text-red-600" />
        </Button>
      ),
    },
  ];

  const hasFilters = Boolean(debounced) || status !== "ALL";

  return (
    <>
      <PageHeader
        title="Leads"
        description="Everyone you can email. Import from CSV; every column stays available as a template variable."
        actions={
          <ButtonLink href="/leads/import">
            <Upload /> Import CSV
          </ButtonLink>
        }
      />

      <Card>
        <div className="space-y-3 px-4 pt-4 sm:px-5">
          <div className="flex items-center gap-3">
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <label htmlFor="lead-search" className="sr-only">
                Search leads
              </label>
              <Input
                id="lead-search"
                type="search"
                placeholder="Search leads..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9"
              />
            </div>
            {loading && data && <Spinner className="size-4 text-slate-400" label="Loading" />}
          </div>
          <Tabs
            ariaLabel="Filter by status"
            tabs={tabs}
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          />
        </div>

        {error && !data ? (
          <ErrorState message={error} onRetry={reload} />
        ) : (
          <DataTable
            caption="Leads"
            columns={columns}
            rows={data?.items}
            rowKey={(l) => l.id}
            onRowClick={setSelected}
            rowLabel={(l) => `Open lead ${leadDisplayName(l) || l.email}`}
            loading={loading}
            sort={sort}
            onSortChange={(s) => {
              setSort(s);
              setPage(1);
            }}
            empty={
              hasFilters ? (
                <EmptyState
                  icon={<Search />}
                  title="No leads match"
                  description="Try a different search or status filter."
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSearch("");
                        setStatus("ALL");
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<Users />}
                  title="No leads yet"
                  description="Import a CSV with at least an email column. Names, companies and any other columns become personalisation variables."
                  action={
                    <ButtonLink href="/leads/import">
                      <Upload /> Import CSV
                    </ButtonLink>
                  }
                />
              )
            }
          />
        )}
        {data && data.total > 0 && (
          <Pagination
            page={data.page}
            pageSize={pageSize}
            total={data.total}
            itemLabel="leads"
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          />
        )}
      </Card>

      <LeadDrawer
        lead={selected}
        onClose={() => setSelected(null)}
        onDeleted={() => {
          setSelected(null);
          reload();
        }}
      />
      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        destructive
        title="Delete this lead?"
        message={
          <>
            <span className="font-medium text-slate-900">{toDelete?.email}</span> will be permanently removed. To block it from future imports too, use the suppression list.
          </>
        }
        confirmLabel="Delete lead"
        onConfirm={async () => {
          if (!toDelete) return;
          await api.del(`/api/leads/${toDelete.id}`);
          toast.success(`Deleted ${toDelete.email}`);
          reload();
        }}
      />
    </>
  );
}
