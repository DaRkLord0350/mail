"use client";

import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarClock, Check, Inbox, Pause, Play, RotateCcw, Save, Square, Trash } from "lucide-react";
import { toast } from "sonner";
import { DELIVERY_STATUSES, type CampaignDTO, type DeliveryStatus, type SettingsDTO } from "@/lib/types";
import { api } from "@/lib/client/api";
import { useApiQuery } from "@/lib/client/hooks";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Alert, EmptyState, ErrorState, PageHeader, PageSkeleton, StatCard } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TemplateComposer, type ComposerValue } from "@/components/template-composer";
import { RecipientsTab } from "@/components/campaigns/recipients-tab";
import { PreviewTab, usePreview } from "@/components/campaigns/preview-tab";
import { StartDialog } from "@/components/campaigns/start-dialog";
import { CampaignProgress, campaignStats } from "@/components/campaign-progress";
import { DeliveriesTable } from "@/components/deliveries-table";
import { ProcessQueueButton } from "@/components/process-queue-button";
import { cn, errorMessage, formatDateTime, formatDateTimeInZone, formatNumber, formatRelative } from "@/lib/utils";

type Step = "template" | "recipients" | "preview" | "review";
type LiveTab = "deliveries" | "template" | "recipients";

const STEPS: { id: Step; label: string }[] = [
  { id: "template", label: "Template" },
  { id: "recipients", label: "Recipients" },
  { id: "preview", label: "Preview & Validate" },
  { id: "review", label: "Review & Start" },
];

function hasTemplate(c: CampaignDTO) {
  return c.subjectTemplate.trim() !== "" && c.bodyTemplate.trim() !== "";
}

function defaultStep(c: CampaignDTO): Step {
  if (!hasTemplate(c)) return "template";
  if (c.recipientCount === 0) return "recipients";
  return "preview";
}

export function CampaignWorkspace({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const { data: campaign, error, errorStatus, reload, setData } = useApiQuery<CampaignDTO>(`/api/campaigns/${campaignId}`, {
    refreshMs: live ? 10_000 : undefined,
  });
  const isLive = campaign?.status === "RUNNING" || campaign?.status === "SCHEDULED";
  if (campaign && isLive !== live) setLive(isLive);

  const [step, setStep] = useState<Step | null>(null);
  const [liveTab, setLiveTab] = useState<LiveTab>("deliveries");
  const [deliveryFilter, setDeliveryFilter] = useState<"ALL" | DeliveryStatus>("ALL");
  const [templateDirty, setTemplateDirty] = useState(false);
  const [previewed, setPreviewed] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const markPreviewed = useCallback(() => setPreviewed(true), []);

  const back = (
    <Link href="/campaigns" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
      <ArrowLeft className="size-4" aria-hidden="true" /> Campaigns
    </Link>
  );

  if (error && !campaign) {
    return (
      <>
        <PageHeader title="Campaign" back={back} />
        <Card>
          {errorStatus === 404 ? (
            <ErrorState
              title="Campaign not found"
              message="It may have been deleted."
              action={
                <ButtonLink href="/campaigns" variant="secondary" size="sm">
                  Back to campaigns
                </ButtonLink>
              }
            />
          ) : (
            <ErrorState message={error} onRetry={reload} />
          )}
        </Card>
      </>
    );
  }
  if (!campaign) {
    return (
      <>
        <PageHeader title="Campaign" back={back} />
        <PageSkeleton />
      </>
    );
  }

  const c = campaign;
  const editable = c.status === "DRAFT" || c.status === "READY";
  const current = step ?? defaultStep(c);
  const stepDone: Record<Step, boolean> = {
    template: hasTemplate(c),
    recipients: c.recipientCount > 0,
    preview: previewed,
    review: false,
  };

  async function action(name: "pause" | "resume" | "stop" | "retry-failed") {
    setBusy(name);
    try {
      const r = await api.post<CampaignDTO & { requeued?: number }>(`/api/campaigns/${c.id}/${name}`);
      setData(r);
      if (name === "retry-failed") toast.success(`Requeued ${formatNumber(r.requeued ?? 0)} failed emails`);
      else toast.success({ pause: "Campaign paused", resume: "Campaign resumed", stop: "Campaign stopped" }[name]);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    } finally {
      setBusy(null);
    }
  }

  async function saveTemplate(v: ComposerValue) {
    const r = await api.patch<CampaignDTO>(`/api/campaigns/${c.id}`, { name: v.name, subjectTemplate: v.subject, bodyTemplate: v.body });
    setData(r);
    setPreviewed(false);
    toast.success("Campaign template saved");
  }

  async function sendCampaignTest(args: { to: string; leadId: string }) {
    const r = await api.post<{ ok: true; providerMessageId: string | null }>(`/api/campaigns/${c.id}/send-test`, { to: args.to, leadId: args.leadId });
    return r.providerMessageId;
  }

  const composer = (
    <TemplateComposer
      key={c.id}
      heading="Campaign template"
      nameLabel="Campaign name"
      initial={{ name: c.name, subject: c.subjectTemplate, body: c.bodyTemplate }}
      readOnly={!editable}
      readOnlyNote="The template was frozen when the campaign started. Every recipient gets exactly this content."
      onSave={saveTemplate}
      onSendTest={sendCampaignTest}
      saveBeforeTest
      onDirtyChange={setTemplateDirty}
    />
  );

  return (
    <>
      <PageHeader
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {c.name}
            <StatusBadge status={c.status} />
          </span>
        }
        description={
          <>
            Created {formatRelative(c.createdAt)} · daily limit {formatNumber(c.dailyLimit)}
            {c.templateId ? " · from a saved template" : ""}
          </>
        }
        actions={
          !isLive && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash className="text-red-600" /> Delete
            </Button>
          )
        }
      />

      {c.sendingHaltedReason && (c.status === "RUNNING" || c.status === "SCHEDULED") && (
        <Alert tone="error" title="Sending is halted for all campaigns" className="mb-4">
          <span className="block">{c.sendingHaltedReason}</span>Nothing is sent until you fix the cause and run &ldquo;Test Resend Connection&rdquo; in{" "}
          <Link href="/settings" className="font-medium underline">
            Settings
          </Link>
          .
        </Alert>
      )}

      {c.lastError && (
        <Alert tone="error" title={c.status === "PAUSED" ? "Campaign paused because of an error" : "Last error"} className="mb-4">
          {c.lastError}
          {c.status === "PAUSED" && (
            <span className="mt-1 block text-xs">
              Fix the cause (e.g. check the Resend API key in{" "}
              <Link href="/settings" className="font-medium underline">
                Settings
              </Link>
              ) and then resume.
            </span>
          )}
        </Alert>
      )}

      {editable ? (
        <>
          {/* Stepper */}
          <nav aria-label="Campaign setup steps" className="mb-5">
            <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {STEPS.map((s, i) => {
                const active = s.id === current;
                const done = stepDone[s.id];
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setStep(s.id)}
                      aria-current={active ? "step" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none",
                        active ? "border-indigo-300 bg-indigo-50 text-indigo-900" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                          done ? "bg-emerald-600 text-white" : active ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-600",
                        )}
                      >
                        {done ? <Check className="size-3.5" aria-label="done" /> : i + 1}
                      </span>
                      <span className="min-w-0 truncate font-medium">{s.label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div hidden={current !== "template"}>{composer}</div>
          {current === "recipients" && (
            <RecipientsTab
              campaignId={c.id}
              editable
              recipientCount={c.recipientCount}
              onCountChange={(n) => {
                setPreviewed(false);
                setData((prev) => ({ ...(prev ?? c), recipientCount: n }));
                reload();
              }}
            />
          )}
          {current === "preview" && (
            <PreviewTab campaign={c} templateDirty={templateDirty} onPreviewed={markPreviewed} onGoToRecipients={() => setStep("recipients")} />
          )}
          {current === "review" && (
            <ReviewStep
              campaign={c}
              previewed={previewed}
              templateDirty={templateDirty}
              onGoto={setStep}
              onUpdated={setData}
              onStart={() => setStartOpen(true)}
            />
          )}

          {current !== "review" && (
            <div className="mt-5 flex justify-end">
              <Button
                variant="secondary"
                onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, STEPS.findIndex((s) => s.id === current) + 1)].id)}
              >
                Next: {STEPS[STEPS.findIndex((s) => s.id === current) + 1]?.label}
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <ProgressPanel
            campaign={c}
            busy={busy}
            onPause={() => action("pause").catch(() => {})}
            onResume={() => action("resume").catch(() => {})}
            onStop={() => setConfirmStop(true)}
            onRetry={() => action("retry-failed").catch(() => {})}
            onProcessed={reload}
          />

          <Tabs
            className="mt-6 mb-4"
            ariaLabel="Campaign sections"
            value={liveTab}
            onChange={setLiveTab}
            tabs={[
              { value: "deliveries", label: "Deliveries" },
              { value: "template", label: "Template" },
              { value: "recipients", label: "Recipients", count: c.recipientCount },
            ]}
          />
          {liveTab === "deliveries" && (
            <Card>
              <div className="px-4 pt-3 sm:px-5">
                <Tabs
                  ariaLabel="Filter deliveries by status"
                  value={deliveryFilter}
                  onChange={setDeliveryFilter}
                  tabs={[
                    { value: "ALL" as const, label: "All", count: DELIVERY_STATUSES.reduce((a, s) => a + (c.counts[s] ?? 0), 0) },
                    ...DELIVERY_STATUSES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase(), count: c.counts[s] ?? 0 })),
                  ]}
                />
              </div>
              <DeliveriesTable
                key={deliveryFilter}
                variant="campaign"
                query={{ campaignId: c.id, status: deliveryFilter === "ALL" ? undefined : deliveryFilter }}
                refreshMs={c.status === "RUNNING" ? 10_000 : undefined}
                empty={<EmptyState icon={<Inbox />} title="No emails here" description="Nothing matches this status for this campaign yet." />}
              />
            </Card>
          )}
          <div hidden={liveTab !== "template"}>{composer}</div>
          {liveTab === "recipients" && <RecipientsTab campaignId={c.id} editable={false} recipientCount={c.recipientCount} onCountChange={() => {}} />}
        </>
      )}

      <StartDialog
        open={startOpen}
        onClose={() => setStartOpen(false)}
        campaign={c}
        onStarted={(r) => {
          setData(r);
          reload();
        }}
      />
      <ConfirmDialog
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        destructive
        title="Stop this campaign?"
        message="Remaining pending emails will be skipped. Emails already sent are unaffected. A stopped campaign cannot be restarted."
        confirmLabel="Stop campaign"
        onConfirm={() => action("stop")}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        destructive
        title="Delete this campaign?"
        message="The campaign and its recipient list are removed. Leads are not deleted. This cannot be undone."
        confirmLabel="Delete campaign"
        onConfirm={async () => {
          await api.del(`/api/campaigns/${c.id}`);
          toast.success("Campaign deleted");
          router.replace("/campaigns");
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function ReviewStep({
  campaign: c,
  previewed,
  templateDirty,
  onGoto,
  onUpdated,
  onStart,
}: {
  campaign: CampaignDTO;
  previewed: boolean;
  templateDirty: boolean;
  onGoto: (s: Step) => void;
  onUpdated: (c: CampaignDTO) => void;
  onStart: () => void;
}) {
  const settings = useApiQuery<SettingsDTO>("/api/settings");
  const ceiling = settings.data?.dailyLimitCeiling;
  const [limit, setLimit] = useState(String(c.dailyLimit));
  const [savingLimit, setSavingLimit] = useState(false);
  const { data: preview } = usePreview(c.id, c.recipientCount > 0 ? `review|${c.updatedAt}|${c.recipientCount}` : null, 1);
  const s = preview?.summary;

  const limitNum = Number(limit);
  const limitInvalid = !Number.isInteger(limitNum) || limitNum < 1 || (ceiling !== undefined && limitNum > ceiling);

  async function saveLimit() {
    if (limitInvalid) return;
    setSavingLimit(true);
    try {
      const r = await api.patch<CampaignDTO>(`/api/campaigns/${c.id}`, { dailyLimit: limitNum });
      onUpdated(r);
      toast.success("Daily limit updated");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSavingLimit(false);
    }
  }

  const checks: { ok: boolean; label: ReactNode; step: Step; warnOnly?: boolean }[] = [
    { ok: hasTemplate(c) && !templateDirty, label: templateDirty ? "Template has unsaved changes" : "Subject and body written", step: "template" },
    { ok: c.recipientCount > 0, label: `${formatNumber(c.recipientCount)} recipients selected`, step: "recipients" },
    { ok: previewed, label: previewed ? "Dry run reviewed" : "Dry run not reviewed yet (recommended)", step: "preview", warnOnly: true },
  ];
  const blocked = checks.some((x) => !x.ok && !x.warnOnly);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
      <Card>
        <CardHeader title="Review & start" description="Last check before emails are queued." />
        <CardBody className="space-y-5">
          <ul className="space-y-2">
            {checks.map((x, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full",
                    x.ok ? "bg-emerald-100 text-emerald-700" : x.warnOnly ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700",
                  )}
                >
                  {x.ok ? <Check className="size-3" aria-label="ok" /> : <span aria-label="needs attention">!</span>}
                </span>
                <span className="flex-1 text-slate-700">{x.label}</span>
                {!x.ok && (
                  <Button variant="ghost" size="sm" onClick={() => onGoto(x.step)}>
                    Fix
                  </Button>
                )}
              </li>
            ))}
          </ul>

          <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
            <div className="grid grid-cols-[8rem_1fr] gap-3 px-3 py-2">
              <dt className="text-slate-500">Subject</dt>
              <dd className="min-w-0 font-mono text-xs break-words">{c.subjectTemplate || "—"}</dd>
            </div>
            <div className="grid grid-cols-[8rem_1fr] gap-3 px-3 py-2">
              <dt className="text-slate-500">Will send</dt>
              <dd>{s ? `${formatNumber(s.willSend)} (skip ${formatNumber(s.willSkip)})` : "—"}</dd>
            </div>
            <div className="grid grid-cols-[8rem_1fr] gap-3 px-3 py-2">
              <dt className="text-slate-500">Remaining today</dt>
              <dd>{s ? formatNumber(s.remainingToday) : "—"}</dd>
            </div>
            <div className="grid grid-cols-[8rem_1fr] gap-3 px-3 py-2">
              <dt className="text-slate-500">Estimated days</dt>
              <dd>{s ? formatNumber(s.estimatedDays) : "—"}</dd>
            </div>
          </dl>

          <div className="space-y-1.5">
            <label htmlFor="review-limit" className="block text-sm font-medium text-slate-700">
              Daily limit for this campaign
            </label>
            <div className="flex gap-2">
              <Input
                id="review-limit"
                type="number"
                min={1}
                max={ceiling}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                className="max-w-32"
                aria-invalid={limitInvalid || undefined}
                aria-describedby="review-limit-hint"
              />
              <Button variant="secondary" onClick={saveLimit} loading={savingLimit} disabled={limitInvalid || limitNum === c.dailyLimit}>
                {!savingLimit && <Save />} Save
              </Button>
            </div>
            <p id="review-limit-hint" className={cn("text-xs", limitInvalid ? "text-red-600" : "text-slate-500")}>
              {ceiling !== undefined ? `1–${ceiling}. ` : ""}The global daily limit in Settings also applies.
            </p>
          </div>
        </CardBody>
      </Card>

      <Card className="self-start">
        <CardBody className="space-y-3">
          <p className="text-sm text-slate-600">
            Starting queues one email per eligible recipient. The server sends them at your pacing, up to the daily limit, and continues on following days
            until done.
          </p>
          <Button className="w-full" onClick={onStart} disabled={blocked}>
            <Play /> Start campaign…
          </Button>
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <CalendarClock className="size-3.5" aria-hidden="true" /> You can also schedule it for later in the next step.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProgressPanel({
  campaign: c,
  busy,
  onPause,
  onResume,
  onStop,
  onRetry,
  onProcessed,
}: {
  campaign: CampaignDTO;
  busy: string | null;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRetry: () => void;
  onProcessed: () => void;
}) {
  const s = campaignStats(c);
  const canPause = c.status === "RUNNING" || c.status === "SCHEDULED";
  const canResume = c.status === "PAUSED";
  const canStop = c.status === "RUNNING" || c.status === "PAUSED" || c.status === "SCHEDULED";
  const canRetry = s.failed > 0 && c.status !== "STOPPED";

  return (
    <Card>
      <CardHeader
        title="Progress"
        description={
          c.status === "SCHEDULED" && c.scheduledAt
            ? `Scheduled for ${formatDateTimeInZone(c.scheduledAt, c.timezone)} (${formatRelative(c.scheduledAt)})`
            : c.status === "RUNNING"
              ? "Sending — this page refreshes every 10 seconds. You can close it; sending continues on the server."
              : c.status === "PAUSED"
                ? `Paused ${c.pausedAt ? formatRelative(c.pausedAt) : ""}`
                : c.status === "COMPLETED"
                  ? `Completed ${c.completedAt ? formatDateTime(c.completedAt) : ""}`
                  : "Stopped — remaining emails were skipped."
        }
        actions={
          <>
            {canPause && (
              <Button variant="secondary" size="sm" onClick={onPause} loading={busy === "pause"} disabled={busy !== null}>
                {busy !== "pause" && <Pause />} Pause
              </Button>
            )}
            {canResume && (
              <Button size="sm" onClick={onResume} loading={busy === "resume"} disabled={busy !== null}>
                {busy !== "resume" && <Play />} Resume
              </Button>
            )}
            {canRetry && (
              <Button variant="secondary" size="sm" onClick={onRetry} loading={busy === "retry-failed"} disabled={busy !== null}>
                {busy !== "retry-failed" && <RotateCcw />} Retry failed
              </Button>
            )}
            {(c.status === "RUNNING" || c.status === "SCHEDULED") && <ProcessQueueButton size="sm" onDone={onProcessed} />}
            {canStop && (
              <Button variant="danger-outline" size="sm" onClick={onStop} disabled={busy !== null}>
                <Square /> Stop
              </Button>
            )}
          </>
        }
      />
      <CardBody className="space-y-4">
        <CampaignProgress campaign={c} size="lg" showPercent />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Total" value={formatNumber(s.total)} />
          <StatCard label="Sent" value={formatNumber(s.sent)} tone="green" />
          <StatCard label="Failed" value={formatNumber(s.failed)} tone={s.failed ? "red" : "slate"} />
          <StatCard label="Skipped" value={formatNumber(s.skipped)} tone="gray" />
          <StatCard label="Pending" value={formatNumber(c.counts.PENDING ?? 0)} tone="yellow" />
          <StatCard label="Processing" value={formatNumber(s.processing)} tone="blue" />
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-slate-500 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="inline">Started: </dt>
            <dd className="inline text-slate-700">{formatDateTime(c.startedAt)}</dd>
          </div>
          <div>
            <dt className="inline">Scheduled: </dt>
            <dd className="inline text-slate-700">{c.scheduledAt ? formatDateTimeInZone(c.scheduledAt, c.timezone) : "—"}</dd>
          </div>
          <div>
            <dt className="inline">Daily limit: </dt>
            <dd className="inline text-slate-700">{formatNumber(c.dailyLimit)}</dd>
          </div>
          <div>
            <dt className="inline">Completed: </dt>
            <dd className="inline text-slate-700">{formatDateTime(c.completedAt)}</dd>
          </div>
        </dl>
      </CardBody>
    </Card>
  );
}
