"use client";

import { useState } from "react";
import { Inbox, Info } from "lucide-react";
import type { DashboardDTO, DeliveryStatus } from "@/lib/types";
import { useApiQuery } from "@/lib/client/hooks";
import { Card } from "@/components/ui/card";
import { Alert, EmptyState, PageHeader } from "@/components/ui/feedback";
import { Tabs } from "@/components/ui/tabs";
import { ButtonLink } from "@/components/ui/button";
import { DueTime, TimeAgo } from "@/components/ui/time";
import { DeliveriesTable } from "@/components/deliveries-table";
import { ProcessQueueButton } from "@/components/process-queue-button";

type QueueTab = Extract<DeliveryStatus, "PENDING" | "PROCESSING" | "FAILED">;

export function QueueView() {
  const [tab, setTab] = useState<QueueTab>("PENDING");
  const [refreshKey, setRefreshKey] = useState(0);
  const dash = useApiQuery<DashboardDTO>("/api/dashboard", { refreshMs: 15_000 });
  const counts = dash.data?.deliveries.counts;
  const worker = dash.data?.worker;

  return (
    <>
      <PageHeader
        title="Email Queue"
        description="Emails waiting to be sent or currently being sent."
        actions={
          <ProcessQueueButton
            variant="primary"
            onDone={() => {
              setRefreshKey((k) => k + 1);
              dash.reload();
            }}
          />
        }
      />

      <Alert tone="info" className="mb-4" title="Sending happens on the server">
        A cron-triggered worker sends queued emails in small batches, respecting the delay between emails and the daily limit — you don&apos;t need to keep
        this page open. &ldquo;Process queue now&rdquo; just runs one pass immediately.
        {worker && (
          <span className="mt-1 block text-xs">
            Last run: {worker.lastRunAt ? <TimeAgo value={worker.lastRunAt} /> : "never"} · next send slot:{" "}
            {worker.nextSendAt ? <DueTime value={worker.nextSendAt} /> : "—"}
          </span>
        )}
      </Alert>

      <Card>
        <div className="px-4 pt-3 sm:px-5">
          <Tabs
            ariaLabel="Queue status"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "PENDING", label: "Pending", count: counts?.PENDING },
              { value: "PROCESSING", label: "Processing", count: counts?.PROCESSING },
              { value: "FAILED", label: "Failed", count: counts?.FAILED },
            ]}
          />
        </div>
        {tab === "FAILED" && (
          <p className="flex items-start gap-1.5 px-4 pt-3 text-xs text-slate-500 sm:px-5">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> Transient failures are retried automatically up to the max-retries setting. Use
            &ldquo;Retry failed&rdquo; on a campaign to requeue the rest.
          </p>
        )}
        <DeliveriesTable
          key={`${tab}-${refreshKey}`}
          variant="queue"
          query={{ status: tab }}
          refreshMs={10_000}
          empty={
            <EmptyState
              icon={<Inbox />}
              title={tab === "PENDING" ? "The queue is empty" : tab === "PROCESSING" ? "Nothing is being sent right now" : "No failed emails"}
              description={tab === "PENDING" ? "Start a campaign to queue emails." : undefined}
              action={
                tab === "PENDING" ? (
                  <ButtonLink href="/campaigns" size="sm">
                    Go to campaigns
                  </ButtonLink>
                ) : undefined
              }
            />
          }
        />
      </Card>
    </>
  );
}
