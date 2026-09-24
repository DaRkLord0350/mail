"use client";

import { useState } from "react";
import { Ban, Search, Trash, UserMinus, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import type { DeliveryStatus, LeadDTO, Paginated } from "@/lib/types";
import { api, qs } from "@/lib/client/api";
import { useApiQuery, useDebouncedValue } from "@/lib/client/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LeadPicker } from "@/components/lead-picker";
import { cn, errorMessage, formatNumber, leadDisplayName } from "@/lib/utils";

type Recipient = { lead: LeadDTO; deliveryStatus: DeliveryStatus | null };

export function RecipientsTab({
  campaignId,
  editable,
  recipientCount,
  onCountChange,
}: {
  campaignId: string;
  editable: boolean;
  recipientCount: number;
  onCountChange: (n: number) => void;
}) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [removing, setRemoving] = useState(false);

  const { data, error, loading, reload } = useApiQuery<Paginated<Recipient>>(
    `/api/campaigns/${campaignId}/recipients${qs({ search: debounced, page, pageSize })}`,
  );
  const items = data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((r) => selected.has(r.lead.id));

  function changed(n: number) {
    onCountChange(n);
    setSelected(new Set());
    reload();
  }

  async function removeSelected() {
    setRemoving(true);
    try {
      const r = await api.post<{ recipientCount: number }>(`/api/campaigns/${campaignId}/recipients`, { mode: "remove", leadIds: Array.from(selected) });
      toast.success(`Removed ${formatNumber(selected.size)} — ${formatNumber(r.recipientCount)} recipients left`);
      changed(r.recipientCount);
    } catch (err) {
      toast.error(`Couldn't remove: ${errorMessage(err)}`);
    } finally {
      setRemoving(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader
        title={`Recipients · ${formatNumber(recipientCount)}`}
        description={
          editable
            ? "Choose who receives this campaign. Suppressed and already-contacted leads are flagged in the preview and skipped when sending."
            : "The recipient list is locked because the campaign has started."
        }
        icon={<Users />}
        actions={
          editable && (
            <>
              {selected.size > 0 && (
                <Button variant="danger-outline" size="sm" onClick={removeSelected} loading={removing}>
                  {!removing && <UserMinus />} Remove selected ({formatNumber(selected.size)})
                </Button>
              )}
              {recipientCount > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>
                  <Trash /> Clear all
                </Button>
              )}
              <Button size="sm" onClick={() => setPickerOpen(true)}>
                <UserPlus /> Add leads
              </Button>
            </>
          )
        }
      />
      <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
        {editable && (
          <input
            type="checkbox"
            aria-label="Select all recipients on this page"
            checked={allOnPage}
            disabled={items.length === 0}
            onChange={() =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (allOnPage) items.forEach((r) => next.delete(r.lead.id));
                else items.forEach((r) => next.add(r.lead.id));
                return next;
              })
            }
            className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
        )}
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <label htmlFor="recipient-search" className="sr-only">
            Search recipients
          </label>
          <Input
            id="recipient-search"
            type="search"
            placeholder="Search recipients..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>
      </div>

      {error && !data ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        debounced ? (
          <EmptyState icon={<Search />} title="No recipients match" description="Try a different search." />
        ) : (
          <EmptyState
            icon={<Users />}
            title="No recipients yet"
            description="Add leads to this campaign — for example all Ready leads that haven't been contacted."
            action={
              editable && (
                <Button onClick={() => setPickerOpen(true)}>
                  <UserPlus /> Add leads
                </Button>
              )
            }
          />
        )
      ) : (
        <ul className={cn("divide-y divide-slate-100 border-t border-slate-100 transition-opacity", loading && "opacity-60")}>
          {items.map(({ lead, deliveryStatus }) => {
            const inner = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">
                    {leadDisplayName(lead) || lead.email}
                    {lead.companyName && <span className="font-normal text-slate-500"> · {lead.companyName}</span>}
                  </span>
                  <span className="block truncate text-xs text-slate-500">{lead.email}</span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {lead.suppressed && (
                    <Badge tone="red">
                      <Ban className="size-3" aria-hidden="true" /> Suppressed
                    </Badge>
                  )}
                  {deliveryStatus ? <StatusBadge status={deliveryStatus} /> : <StatusBadge status={lead.status} />}
                </span>
              </>
            );
            return (
              <li key={lead.id}>
                {editable ? (
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50 sm:px-5">
                    <input
                      type="checkbox"
                      checked={selected.has(lead.id)}
                      onChange={() => toggle(lead.id)}
                      className="size-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    {inner}
                  </label>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-2.5 sm:px-5">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {data && data.total > 0 && (
        <Pagination
          page={data.page}
          pageSize={pageSize}
          total={data.total}
          itemLabel="recipients"
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      )}

      <LeadPicker open={pickerOpen} onClose={() => setPickerOpen(false)} campaignId={campaignId} onChanged={changed} currentCount={recipientCount} />
      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        destructive
        title="Remove all recipients?"
        message={`All ${formatNumber(recipientCount)} recipients will be removed from this campaign. The leads themselves are not deleted.`}
        confirmLabel="Clear recipients"
        onConfirm={async () => {
          const r = await api.post<{ recipientCount: number }>(`/api/campaigns/${campaignId}/recipients`, { mode: "clear" });
          toast.success("Recipients cleared");
          changed(r.recipientCount);
        }}
      />
    </Card>
  );
}
