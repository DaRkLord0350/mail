"use client";

import { useState } from "react";
import { MailCheck, Search } from "lucide-react";
import { DELIVERY_STATUSES, type CampaignDTO, type DeliveryStatus } from "@/lib/types";
import { useApiQuery, useDebouncedValue } from "@/lib/client/hooks";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { DeliveriesTable } from "@/components/deliveries-table";

export function HistoryView() {
  const [status, setStatus] = useState<"" | DeliveryStatus>("");
  const [campaignId, setCampaignId] = useState("");
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 300);
  const campaigns = useApiQuery<{ items: CampaignDTO[] }>("/api/campaigns");
  const hasFilters = Boolean(status || campaignId || debounced);

  const query = { status: status || undefined, campaignId: campaignId || undefined, search: debounced || undefined };

  return (
    <>
      <PageHeader title="Send History" description="Every email attempt, newest first. Click a row for the full rendered email and provider details." />
      <Card>
        <div className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[1fr_11rem_14rem] sm:px-5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <label htmlFor="history-search" className="sr-only">
              Search by recipient, company or subject
            </label>
            <Input
              id="history-search"
              type="search"
              placeholder="Search recipient, company, subject..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div>
            <label htmlFor="history-status" className="sr-only">
              Status
            </label>
            <Select id="history-status" value={status} onChange={(e) => setStatus(e.target.value as "" | DeliveryStatus)}>
              <option value="">All statuses</option>
              {DELIVERY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="history-campaign" className="sr-only">
              Campaign
            </label>
            <Select id="history-campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">All campaigns</option>
              {campaigns.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <DeliveriesTable
          key={JSON.stringify(query)}
          variant="history"
          query={query}
          empty={
            hasFilters ? (
              <EmptyState
                icon={<Search />}
                title="No emails match these filters"
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setStatus("");
                      setCampaignId("");
                      setSearch("");
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState icon={<MailCheck />} title="No emails sent yet" description="Once a campaign starts sending, every attempt is recorded here." />
            )
          }
        />
      </Card>
    </>
  );
}
