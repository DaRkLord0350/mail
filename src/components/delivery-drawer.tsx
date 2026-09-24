"use client";

import Link from "next/link";
import type { DeliveryDetailDTO } from "@/lib/types";
import { useApiQuery } from "@/lib/client/hooks";
import { Drawer } from "@/components/ui/modal";
import { StatusBadge } from "@/components/ui/badge";
import { Alert, ErrorState, KeyValue, Skeleton } from "@/components/ui/feedback";
import { formatDateTime, formatRelative } from "@/lib/utils";
import { DueTime } from "@/components/ui/time";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-slate-100 px-5 py-4 last:border-b-0">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-sans text-sm leading-relaxed whitespace-pre-wrap break-words text-slate-800">
      {children}
    </pre>
  );
}

export function DeliveryDrawer({ deliveryId, onClose }: { deliveryId: string | null; onClose: () => void }) {
  const { data, error, loading, reload } = useApiQuery<DeliveryDetailDTO>(deliveryId ? `/api/deliveries/${deliveryId}` : null);
  const d = data && data.id === deliveryId ? data : undefined;

  return (
    <Drawer
      open={deliveryId !== null}
      onClose={onClose}
      title={d ? d.renderedSubject || "(no subject)" : "Delivery details"}
      description={d ? <StatusBadge status={d.status} /> : undefined}
      width="sm:max-w-2xl"
    >
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !d || loading ? (
        <div className="space-y-3 p-5" role="status" aria-label="Loading delivery">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <>
          {d.errorMessage && (
            <div className="px-5 pt-4">
              <Alert tone={d.status === "FAILED" ? "error" : "warning"} title={d.errorCode ? `Error (${d.errorCode})` : "Error"}>
                {d.errorMessage}
              </Alert>
            </div>
          )}
          <Section title="Delivery">
            <dl className="divide-y divide-slate-100">
              <KeyValue label="Recipient">
                {d.leadName ? (
                  <>
                    {d.leadName} <span className="text-slate-500">&lt;{d.email}&gt;</span>
                  </>
                ) : (
                  d.email
                )}
                {d.companyName && <span className="block text-xs text-slate-500">{d.companyName}</span>}
              </KeyValue>
              <KeyValue label="Status">
                <StatusBadge status={d.status} />
              </KeyValue>
              <KeyValue label="Sent at">{d.sentAt ? `${formatDateTime(d.sentAt)} (${formatRelative(d.sentAt)})` : "—"}</KeyValue>
              <KeyValue label="Last attempt">{d.lastAttemptAt ? `${formatDateTime(d.lastAttemptAt)} (${formatRelative(d.lastAttemptAt)})` : "—"}</KeyValue>
              {(d.status === "PENDING" || d.status === "PROCESSING") && (
                <KeyValue label="Next attempt"><>
                    {formatDateTime(d.nextAttemptAt)} (<DueTime value={d.nextAttemptAt} />)
                  </></KeyValue>
              )}
              <KeyValue label="Attempts">{d.attempts}</KeyValue>
              <KeyValue label="Campaign">
                <Link href={`/campaigns/${d.campaignId}`} className="text-indigo-700 hover:underline">
                  {d.campaignName}
                </Link>
              </KeyValue>
              <KeyValue label="Resend message ID" mono>
                {d.providerMessageId ?? "—"}
              </KeyValue>
              <KeyValue label="Queued">{formatDateTime(d.createdAt)}</KeyValue>
            </dl>
          </Section>
          <Section title="Rendered email">
            <p className="mb-2 text-sm">
              <span className="text-slate-500">Subject: </span>
              <span className="font-medium text-slate-900">{d.renderedSubject || "—"}</span>
            </p>
            <Pre>{d.renderedBody || "—"}</Pre>
          </Section>
          <Section title="Template (raw)">
            <p className="mb-2 font-mono text-xs break-words text-slate-700">
              <span className="font-sans text-slate-500">Subject: </span>
              {d.subjectTemplate}
            </p>
            <Pre>
              <span className="font-mono text-xs">{d.bodyTemplate}</span>
            </Pre>
          </Section>
        </>
      )}
    </Drawer>
  );
}
