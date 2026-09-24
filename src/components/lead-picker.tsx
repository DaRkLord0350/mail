"use client";

import { useState } from "react";
import { Ban, Search, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { LEAD_STATUSES, type LeadDTO, type LeadStatus, type Paginated, type StatusCounts } from "@/lib/types";
import { api, qs } from "@/lib/client/api";
import { useApiQuery, useDebouncedValue } from "@/lib/client/hooks";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { cn, errorMessage, formatNumber, leadDisplayName } from "@/lib/utils";

type LeadsResponse = Paginated<LeadDTO> & { statusCounts: StatusCounts<LeadStatus> };
type RecipientFilter = { status?: LeadStatus; search?: string; notContacted?: boolean };

const PAGE_SIZE = 20;

export function LeadPicker({
  open,
  onClose,
  campaignId,
  onChanged,
  currentCount,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  onChanged: (recipientCount: number) => void;
  /** Recipients before this add; lets us report how many were actually added. */
  currentCount?: number;
}) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 300);
  const [status, setStatus] = useState<"" | LeadStatus>("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const url = open ? `/api/leads${qs({ search: debounced, status: status || undefined, sort: "createdAt", order: "desc", page, pageSize: PAGE_SIZE })}` : null;
  const { data, error, loading, reload } = useApiQuery<LeadsResponse>(url);
  const items = data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((l) => selected.has(l.id));
  const readyCount = data?.statusCounts.counts.READY;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPage) items.forEach((l) => next.delete(l.id));
      else items.forEach((l) => next.add(l.id));
      return next;
    });
  }

  async function add(kind: string, body: { leadIds?: string[]; filter?: RecipientFilter }) {
    setBusy(kind);
    try {
      const r = await api.post<{ recipientCount: number }>(`/api/campaigns/${campaignId}/recipients`, { mode: "add", ...body });
      const added = typeof currentCount === "number" ? r.recipientCount - currentCount : null;
      if (added === 0) {
        // Keep the picker open so the user can adjust the filter/selection.
        toast.warning("No leads added — they're already in this campaign or none match (Ready + not contacted).");
        return;
      }
      toast.success(
        added !== null
          ? `Added ${formatNumber(added)} lead${added === 1 ? "" : "s"} — ${formatNumber(r.recipientCount)} recipients total`
          : `Recipients updated — ${formatNumber(r.recipientCount)} total`,
      );
      onChanged(r.recipientCount);
      setSelected(new Set());
      onClose();
    } catch (err) {
      toast.error(`Couldn't add leads: ${errorMessage(err)}`);
    } finally {
      setBusy(null);
    }
  }

  const hasFilter = Boolean(debounced) || Boolean(status);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Add leads to campaign"
      description="Pick individual leads, or add everything that matches a filter in one go. Leads already in the campaign are not duplicated."
      dismissible={busy === null}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy !== null}>
            Cancel
          </Button>
          <Button onClick={() => add("selected", { leadIds: Array.from(selected) })} disabled={selected.size === 0 || busy !== null} loading={busy === "selected"}>
            {busy !== "selected" && <UserPlus />} Add selected ({formatNumber(selected.size)})
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-col gap-2 rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-700">
            <span className="font-medium">Bulk add</span>
            <span className="block text-xs text-slate-500">Selects matching leads on the server — not limited to this page.</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => add("ready", { filter: { status: "READY", notContacted: true } })}
              loading={busy === "ready"}
              disabled={busy !== null}
            >
              Add all Ready leads (not contacted){typeof readyCount === "number" && !hasFilter ? ` · ${formatNumber(readyCount)}` : ""}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => add("matching", { filter: { search: debounced || undefined, status: status || undefined } })}
              loading={busy === "matching"}
              disabled={busy !== null || !data || data.total === 0}
              title={hasFilter ? "Add every lead matching the current search/filter" : "No filter set — this adds ALL leads"}
            >
              Add all {data ? formatNumber(data.total) : ""} matching{hasFilter ? "" : " (all leads)"}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <label htmlFor="picker-search" className="sr-only">
              Search leads
            </label>
            <Input
              id="picker-search"
              type="search"
              placeholder="Search leads..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9"
              data-autofocus
            />
          </div>
          <label htmlFor="picker-status" className="sr-only">
            Status
          </label>
          <Select
            id="picker-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as "" | LeadStatus);
              setPage(1);
            }}
            className="sm:w-44"
          >
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </div>

        <div className="rounded-lg border border-slate-200">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <label className="flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={allOnPage}
                onChange={togglePage}
                disabled={items.length === 0}
                className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Select page
            </label>
            <span className="flex items-center gap-3">
              {selected.size > 0 && (
                <button type="button" className="text-indigo-700 hover:underline" onClick={() => setSelected(new Set())}>
                  Clear selection
                </button>
              )}
              <span className="tabular-nums">{formatNumber(selected.size)} selected</span>
            </span>
          </div>
          {error && !data ? (
            <ErrorState message={error} onRetry={reload} />
          ) : !data ? (
            <ListSkeleton rows={5} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title={hasFilter ? "No leads match" : "No leads yet"}
              description={hasFilter ? "Try a different search." : "Import a CSV first."}
              className="py-8"
            />
          ) : (
            <ul className={cn("max-h-[45dvh] divide-y divide-slate-100 overflow-y-auto transition-opacity", loading && "opacity-60")}>
              {items.map((l) => (
                <li key={l.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={selected.has(l.id)}
                      onChange={() => toggle(l.id)}
                      className="size-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {leadDisplayName(l) || l.email}
                        {l.companyName && <span className="font-normal text-slate-500"> · {l.companyName}</span>}
                      </span>
                      <span className="block truncate text-xs text-slate-500">{l.email}</span>
                    </span>
                    {l.suppressed && (
                      <Badge tone="red" className="hidden sm:inline-flex">
                        <Ban className="size-3" aria-hidden="true" /> Suppressed
                      </Badge>
                    )}
                    <StatusBadge status={l.status} />
                  </label>
                </li>
              ))}
            </ul>
          )}
          {data && data.total > PAGE_SIZE && (
            <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} itemLabel="leads" />
          )}
        </div>
      </div>
    </Modal>
  );
}
