"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Ban,
  Check,
  CircleCheck,
  CircleX,
  Clock,
  FileText,
  Hourglass,
  Mail,
  Megaphone,
  Play,
  Send,
  Server,
  Settings,
  Upload,
  Users,
} from "lucide-react";
import type { DashboardDTO } from "@/lib/types";
import { useApiQuery, useUsageChanged } from "@/lib/client/hooks";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Alert, EmptyState, ErrorState, PageHeader, ProgressBar, Skeleton, StatCard } from "@/components/ui/feedback";
import { DueTime, TimeAgo } from "@/components/ui/time";
import { CampaignProgress } from "@/components/campaign-progress";
import { ProcessQueueButton } from "@/components/process-queue-button";
import { DeliveryDrawer } from "@/components/delivery-drawer";
import { usageTone } from "@/components/usage-meter";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";

export function DashboardView() {
  const { data, error, reload } = useApiQuery<DashboardDTO>("/api/dashboard", { refreshMs: 15_000 });
  useUsageChanged(reload);
  const [openDelivery, setOpenDelivery] = useState<string | null>(null);

  if (error && !data) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      </>
    );
  }
  if (!data) return <DashboardSkeleton />;

  const { usage, leads, deliveries, campaigns, recent, worker, setup } = data;
  const started = campaigns.some((c) => !["DRAFT", "READY"].includes(c.status));

  return (
    <>
      <PageHeader title="Dashboard" description={`Today is ${usage.date} (${usage.timezone}). Refreshes every 15 seconds.`} />

      {worker.haltedReason && (
        <Alert
          tone="error"
          title="All sending is halted"
          className="mb-4"
          action={
            <ButtonLink href="/settings" variant="secondary" size="sm">
              Open settings
            </ButtonLink>
          }
        >
          <span className="block">{worker.haltedReason}</span>Fix the cause, then run &ldquo;Test Resend Connection&rdquo; in Settings or resume a paused campaign.
        </Alert>
      )}

      <GettingStarted setup={setup} started={started} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <UsageCard usage={usage} />
        <WorkerCard worker={worker} onProcessed={reload} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Total leads" value={formatNumber(leads.total)} icon={<Users />} />
        <StatCard label="Ready" value={formatNumber(leads.counts.READY ?? 0)} icon={<Mail />} tone="indigo" hint="leads not yet contacted" />
        <StatCard label="Sent" value={formatNumber(deliveries.counts.SENT ?? 0)} icon={<CircleCheck />} tone="green" hint="emails, all time" />
        <StatCard label="Pending" value={formatNumber((deliveries.counts.PENDING ?? 0) + (deliveries.counts.PROCESSING ?? 0))} icon={<Hourglass />} tone="yellow" hint="in the queue" />
        <StatCard label="Failed" value={formatNumber(deliveries.counts.FAILED ?? 0)} icon={<CircleX />} tone="red" hint="emails" />
        <StatCard label="Skipped" value={formatNumber(deliveries.counts.SKIPPED ?? 0)} icon={<Ban />} tone="gray" hint="emails" />
        <StatCard label="Remaining today" value={formatNumber(usage.remaining)} icon={<Send />} tone="blue" hint={`of ${formatNumber(usage.limit)}`} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader
            title="Campaign progress"
            icon={<Megaphone />}
            actions={
              <Link href="/campaigns" className="text-xs font-medium text-indigo-700 hover:underline">
                All campaigns
              </Link>
            }
          />
          {campaigns.length === 0 ? (
            <EmptyState
              title="No campaigns yet"
              description="Create one once you have leads and a template."
              action={
                <ButtonLink href="/campaigns/new" size="sm">
                  New campaign
                </ButtonLink>
              }
              className="py-8"
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {campaigns.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/campaigns/${c.id}`}
                    className="block space-y-2 px-4 py-3 hover:bg-slate-50 focus-visible:bg-indigo-50/60 focus-visible:outline-none sm:px-5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium text-slate-900">{c.name}</span>
                      <StatusBadge status={c.status} />
                    </div>
                    <CampaignProgress campaign={c} size="sm" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="min-w-0">
          <CardHeader
            title="Recent deliveries"
            icon={<Send />}
            actions={
              <Link href="/history" className="text-xs font-medium text-indigo-700 hover:underline">
                Send history
              </Link>
            }
          />
          {recent.length === 0 ? (
            <EmptyState title="Nothing sent yet" description="Deliveries appear here as soon as the worker sends them." className="py-8" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setOpenDelivery(d.id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 focus-visible:bg-indigo-50/60 focus-visible:outline-none sm:px-5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{d.leadName || d.email}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {d.renderedSubject} · {d.campaignName}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <StatusBadge status={d.status} />
                      <TimeAgo value={d.sentAt ?? d.lastAttemptAt ?? d.createdAt} className="text-[11px] text-slate-400" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <DeliveryDrawer deliveryId={openDelivery} onClose={() => setOpenDelivery(null)} />
    </>
  );
}

function UsageCard({ usage }: { usage: DashboardDTO["usage"] }) {
  const tone = usageTone(usage.sent, usage.limit);
  const bar = { ok: "bg-indigo-600", warn: "bg-amber-500", full: "bg-red-500" }[tone];
  return (
    <Card className="lg:col-span-2">
      <CardBody className="flex h-full flex-col gap-4 sm:py-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Today&apos;s outreach</p>
            <p className="mt-1 text-3xl font-semibold text-slate-900 tabular-nums sm:text-4xl">
              {formatNumber(usage.sent)} <span className="text-slate-400">/ {formatNumber(usage.limit)}</span>{" "}
              <span className="text-base font-medium text-slate-500">Sent</span>
            </p>
          </div>
          <p
            className={cn(
              "text-sm font-medium",
              tone === "full" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-emerald-700",
            )}
          >
            {tone === "full" ? "Daily limit reached — sending resumes tomorrow" : `${formatNumber(usage.remaining)} Remaining`}
          </p>
        </div>
        <ProgressBar size="lg" max={usage.limit} label="Today's sending quota" segments={[{ value: usage.sent, className: bar }]} />
        <p className="mt-auto text-xs text-slate-500">Test emails don&apos;t count toward this limit. The counter resets at midnight {usage.timezone}.</p>
      </CardBody>
    </Card>
  );
}

function WorkerCard({ worker, onProcessed }: { worker: DashboardDTO["worker"]; onProcessed: () => void }) {
  const r = worker.lastResult;
  const bad = r && (r.stopReason === "auth_error" || r.stopReason === "error" || r.stopReason === "not_configured");
  return (
    <Card>
      <CardHeader title="Worker" icon={<Server />} description="Sends queued emails on the server (cron)." />
      <CardBody className="space-y-3 text-sm">
        <dl className="space-y-1.5">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Last run</dt>
            <dd className="text-right text-slate-900">
              {worker.lastRunAt ? <TimeAgo value={worker.lastRunAt} /> : <span className="text-slate-400">Never</span>}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Next send slot</dt>
            <dd className="text-right text-slate-900" title={worker.nextSendAt ? formatDateTime(worker.nextSendAt) : undefined}>
              {worker.nextSendAt ? <DueTime value={worker.nextSendAt} /> : <span className="text-slate-400">Nothing queued</span>}
            </dd>
          </div>
        </dl>
        {r && (
          <div className={cn("rounded-lg border px-3 py-2 text-xs", bad ? "border-red-200 bg-red-50 text-red-800" : "border-slate-200 bg-slate-50 text-slate-700")}>
            <p className="flex items-center gap-1.5 font-medium">
              <Clock className="size-3.5" aria-hidden="true" /> Last result
              <Badge tone={bad ? "red" : "gray"} className="ml-auto">
                {r.stopReason.replace(/_/g, " ")}
              </Badge>
            </p>
            <p className="mt-1 break-words">{r.message}</p>
            <p className="mt-1 text-slate-500">
              {r.sent} sent · {r.failed} failed · {r.skipped} skipped
            </p>
          </div>
        )}
        <ProcessQueueButton className="w-full" onDone={onProcessed} />
      </CardBody>
    </Card>
  );
}

function GettingStarted({ setup, started }: { setup: DashboardDTO["setup"]; started: boolean }) {
  const steps = [
    {
      done: setup.resendConfigured && setup.senderConfigured,
      title: "Configure Resend",
      text: !setup.resendConfigured ? "Add RESEND_API_KEY to the server env, then test the connection." : "Set a verified From address.",
      href: "/settings",
      cta: "Open settings",
      icon: <Settings />,
    },
    { done: setup.hasLeads, title: "Import CSV", text: "Upload your leads — every column becomes a variable.", href: "/leads/import", cta: "Import CSV", icon: <Upload /> },
    { done: setup.hasTemplates, title: "Create template", text: "Write a subject and body with {{variables}}.", href: "/templates/new", cta: "New template", icon: <FileText /> },
    {
      done: setup.hasCampaigns,
      title: "Preview & send test",
      text: "Check the rendered email for real leads and send yourself a test.",
      href: "/templates",
      cta: "Open templates",
      icon: <Send />,
    },
    { done: setup.hasCampaigns, title: "Create campaign", text: "Pick a template and add recipients.", href: "/campaigns/new", cta: "New campaign", icon: <Megaphone /> },
    { done: started, title: "Start", text: "Run the dry-run preview, then start or schedule.", href: "/campaigns", cta: "Open campaigns", icon: <Play /> },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  const nextIdx = steps.findIndex((s) => !s.done);

  return (
    <Card className="mb-4 border-indigo-200">
      <CardHeader
        title="Getting started"
        description={`${doneCount} of ${steps.length} done — follow the steps in order for your first campaign.`}
        className="bg-indigo-50/40"
      />
      <ol className="grid grid-cols-1 divide-y divide-slate-100 md:grid-cols-2 md:divide-y-0 xl:grid-cols-3">
        {steps.map((s, i) => {
          const isNext = i === nextIdx;
          return (
            <li key={s.title} className={cn("flex gap-3 px-4 py-3 sm:px-5", isNext && "bg-indigo-50/60")}>
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  s.done ? "bg-emerald-600 text-white" : isNext ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-600",
                )}
              >
                {s.done ? <Check className="size-3.5" aria-label="done" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-medium", s.done ? "text-slate-500 line-through decoration-slate-300" : "text-slate-900")}>{s.title}</p>
                {!s.done && <p className="mt-0.5 text-xs text-slate-500">{s.text}</p>}
                {isNext && (
                  <ButtonLink href={s.href} size="sm" className="mt-2">
                    {s.cta} <ArrowRight />
                  </ButtonLink>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading dashboard">
      <Skeleton className="mb-6 h-8 w-48" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-44 rounded-xl lg:col-span-2" />
        <Skeleton className="h-44 rounded-xl" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}
