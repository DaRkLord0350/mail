"use client";

import { useState, type FormEvent } from "react";
import { Ban, Plus, Search, Trash } from "lucide-react";
import { toast } from "sonner";
import type { Paginated, SuppressionDTO } from "@/lib/types";
import { api, qs } from "@/lib/client/api";
import { useApiQuery, useDebouncedValue } from "@/lib/client/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/feedback";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TimeAgo } from "@/components/ui/time";
import { errorMessage } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOURCE_TONES: Record<SuppressionDTO["source"], BadgeTone> = { MANUAL: "slate", UNSUBSCRIBE: "indigo", BOUNCE: "orange", COMPLAINT: "red" };

export function SuppressionsView() {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const { data, error, loading, reload } = useApiQuery<Paginated<SuppressionDTO>>(`/api/suppressions${qs({ search: debounced, page, pageSize })}`);

  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [toRemove, setToRemove] = useState<SuppressionDTO | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) {
      setFormError("Enter a valid email address");
      return;
    }
    setFormError(null);
    setAdding(true);
    try {
      await api.post<SuppressionDTO>("/api/suppressions", { email: value, reason: reason.trim() || undefined });
      toast.success(`${value} suppressed`);
      setEmail("");
      setReason("");
      reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  const columns: Column<SuppressionDTO>[] = [
    { key: "email", header: "Email", primary: true, cell: (s) => <span className="font-medium break-all text-slate-900">{s.email}</span> },
    { key: "source", header: "Source", cell: (s) => <Badge tone={SOURCE_TONES[s.source]}>{s.source.charAt(0) + s.source.slice(1).toLowerCase()}</Badge> },
    { key: "reason", header: "Reason", className: "max-w-72", cell: (s) => <span className="line-clamp-2 text-slate-600">{s.reason || "—"}</span> },
    { key: "added", header: "Added", cell: (s) => <TimeAgo value={s.createdAt} className="whitespace-nowrap" /> },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      mobileNoLabel: true,
      className: "text-right",
      cell: (s) => (
        <Button variant="ghost" size="sm" onClick={() => setToRemove(s)} aria-label={`Remove ${s.email} from suppression list`}>
          <Trash /> Remove
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Suppression list"
        description="Suppressed addresses are never emailed — by any campaign, ever. Unsubscribes, bounces and complaints are added automatically."
      />

      <Card className="mb-4">
        <CardHeader title="Add address" icon={<Ban />} />
        <CardBody>
          <form onSubmit={add} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]" noValidate>
            <div>
              <label htmlFor="sup-email" className="sr-only">
                Email
              </label>
              <Input
                id="sup-email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFormError(null);
                }}
                aria-invalid={formError ? true : undefined}
                aria-describedby={formError ? "sup-error" : undefined}
              />
            </div>
            <div>
              <label htmlFor="sup-reason" className="sr-only">
                Reason (optional)
              </label>
              <Input id="sup-reason" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </div>
            <Button type="submit" loading={adding}>
              {!adding && <Plus />} Suppress
            </Button>
          </form>
          {formError && (
            <p id="sup-error" className="mt-2 text-xs text-red-600" role="alert">
              {formError}
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <div className="px-4 py-3 sm:px-5">
          <div className="relative sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <label htmlFor="sup-search" className="sr-only">
              Search suppressed addresses
            </label>
            <Input
              id="sup-search"
              type="search"
              placeholder="Search suppressed emails..."
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
        ) : (
          <DataTable
            caption="Suppressed addresses"
            columns={columns}
            rows={data?.items}
            rowKey={(s) => s.id}
            loading={loading}
            empty={
              debounced ? (
                <EmptyState icon={<Search />} title="No matches" description="No suppressed address matches that search." />
              ) : (
                <EmptyState icon={<Ban />} title="No suppressed addresses" description="Add addresses above that must never be contacted." />
              )
            }
          />
        )}
        {data && data.total > 0 && (
          <Pagination
            page={data.page}
            pageSize={pageSize}
            total={data.total}
            itemLabel="addresses"
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          />
        )}
      </Card>

      <ConfirmDialog
        open={toRemove !== null}
        onClose={() => setToRemove(null)}
        title="Remove from suppression list?"
        message={
          <>
            <span className="font-medium text-slate-900">{toRemove?.email}</span> could be emailed again by future campaigns.
            {toRemove?.source === "UNSUBSCRIBE" && (
              <span className="mt-2 block font-medium text-red-700">This person unsubscribed. Only remove it if they explicitly asked to be re-added.</span>
            )}
          </>
        }
        destructive
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!toRemove) return;
          await api.del(`/api/suppressions/${toRemove.id}`);
          toast.success(`${toRemove.email} removed from suppression list`);
          reload();
        }}
      />
    </>
  );
}
