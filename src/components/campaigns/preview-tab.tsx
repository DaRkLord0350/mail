"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, CircleCheck, Eye, FlaskConical, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import type { CampaignDTO, CampaignPreviewDTO } from "@/lib/types";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, EmptyState, ErrorState, Skeleton, StatCard } from "@/components/ui/feedback";
import { cn, errorMessage, formatNumber } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function usePreview(campaignId: string, runKey: string | null, limit: number) {
  const [state, setState] = useState<{ key: string; data?: CampaignPreviewDTO; error?: string } | null>(null);
  useEffect(() => {
    if (!runKey) return;
    let cancelled = false;
    api.post<CampaignPreviewDTO>(`/api/campaigns/${campaignId}/preview`, { limit }).then(
      (data) => !cancelled && setState({ key: runKey, data }),
      (err: unknown) => !cancelled && setState({ key: runKey, error: errorMessage(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [campaignId, runKey, limit]);
  const current = state?.key === runKey;
  return {
    data: state?.data,
    error: current ? state?.error : undefined,
    loading: runKey !== null && !current,
  };
}

export function PreviewTab({
  campaign,
  templateDirty,
  onPreviewed,
  onGoToRecipients,
}: {
  campaign: CampaignDTO;
  templateDirty: boolean;
  onPreviewed: () => void;
  onGoToRecipients: () => void;
}) {
  const [nonce, setNonce] = useState(0);
  const runKey = campaign.recipientCount > 0 ? `${campaign.updatedAt}|${campaign.recipientCount}|${nonce}` : null;
  const { data, error, loading } = usePreview(campaign.id, runKey, 20);
  const [index, setIndex] = useState(0);
  const [testTo, setTestTo] = useState("");
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (data) onPreviewed();
  }, [data, onPreviewed]);

  if (campaign.recipientCount === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Eye />}
          title="Add recipients first"
          description="The dry run renders the email for every recipient and tells you exactly who would be sent or skipped."
          action={<Button onClick={onGoToRecipients}>Go to recipients</Button>}
        />
      </Card>
    );
  }

  const items = data?.items ?? [];
  const safeIndex = Math.min(index, Math.max(0, items.length - 1));
  const sample = items[safeIndex];
  const s = data?.summary;

  async function sendTest(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(testTo.trim())) {
      setTestError("Enter a valid email address");
      return;
    }
    if (!sample) return;
    setTestError(null);
    setTesting(true);
    try {
      const r = await api.post<{ ok: true; providerMessageId: string | null }>(`/api/campaigns/${campaign.id}/send-test`, {
        to: testTo.trim(),
        leadId: sample.leadId,
      });
      toast.success(`Test email sent to ${testTo.trim()}`, { description: r.providerMessageId ? `Resend ID: ${r.providerMessageId}` : undefined });
    } catch (err) {
      toast.error(`Test send failed: ${errorMessage(err)}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4">
      {templateDirty && (
        <Alert tone="warning" title="Unsaved template changes">
          The preview uses the saved template. Save your edits on the Template step to preview them here.
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Preview campaign (dry run)"
          description="Renders every recipient with the saved template. Nothing is sent and no quota is used."
          icon={<Eye />}
          actions={
            <Button variant="secondary" size="sm" onClick={() => setNonce((n) => n + 1)} loading={loading}>
              {!loading && <RefreshCw />} Run again
            </Button>
          }
        />
        <CardBody>
          {error ? (
            <ErrorState title="Preview failed" message={error} onRetry={() => setNonce((n) => n + 1)} className="py-6" />
          ) : !s ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="status" aria-label="Running preview">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className={cn("space-y-3 transition-opacity", loading && "opacity-60")}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="Recipients" value={formatNumber(s.recipients)} />
                <StatCard label="Will send" value={formatNumber(s.willSend)} tone="green" />
                <StatCard label="Will skip" value={formatNumber(s.willSkip)} tone={s.willSkip ? "yellow" : "slate"} />
                <StatCard label="Suppressed" value={formatNumber(s.suppressed)} tone={s.suppressed ? "red" : "slate"} />
                <StatCard label="Already sent" value={formatNumber(s.alreadySent)} tone={s.alreadySent ? "blue" : "slate"} />
                <StatCard label="Missing-variable issues" value={formatNumber(s.missingVariables)} tone={s.missingVariables ? "yellow" : "slate"} />
                <StatCard label="Remaining today" value={formatNumber(s.remainingToday)} hint={`Daily limit ${formatNumber(s.effectiveDailyLimit)}`} />
                <StatCard label="Estimated days" value={formatNumber(s.estimatedDays)} tone="indigo" />
              </div>
              {s.queuedElsewhere > 0 && (
                <Alert tone="info" title={`${formatNumber(s.queuedElsewhere)} recipient${s.queuedElsewhere === 1 ? " is" : "s are"} already queued in another campaign`}>
                  They will be skipped so nobody gets two cold emails at once (see &ldquo;Already queued in campaign …&rdquo; in the samples).
                </Alert>
              )}
              {s.unknownVariables.length > 0 ? (
                <Alert tone="warning" title="Unknown variables in the template">
                  These don&apos;t exist on any lead (typo?):{" "}
                  {s.unknownVariables.map((v) => (
                    <Badge key={v} tone="slate" className="mr-1 font-mono">{`{{${v}}}`}</Badge>
                  ))}
                </Alert>
              ) : s.willSkip === 0 && s.missingVariables === 0 ? (
                <p className="flex items-center gap-1.5 text-sm text-emerald-700">
                  <CircleCheck className="size-4" aria-hidden="true" /> Everything checks out — all recipients will be sent.
                </p>
              ) : null}
            </div>
          )}
        </CardBody>
      </Card>

      {data && items.length > 0 && sample && (
        <Card className="min-w-0">
          <CardHeader
            title="Sample emails"
            description={`Showing ${items.length} of ${formatNumber(s?.recipients ?? items.length)} recipients`}
            actions={
              <div className="flex items-center gap-1">
                <Button variant="secondary" size="icon-sm" onClick={() => setIndex(Math.max(0, safeIndex - 1))} disabled={safeIndex === 0} aria-label="Previous sample">
                  <ChevronLeft />
                </Button>
                <span className="min-w-16 text-center text-xs text-slate-600 tabular-nums" aria-live="polite">
                  {safeIndex + 1} / {items.length}
                </span>
                <Button
                  variant="secondary"
                  size="icon-sm"
                  onClick={() => setIndex(Math.min(items.length - 1, safeIndex + 1))}
                  disabled={safeIndex >= items.length - 1}
                  aria-label="Next sample"
                >
                  <ChevronRight />
                </Button>
              </div>
            }
          />
          <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr]">
            <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto border-b border-slate-100 lg:max-h-[32rem] lg:border-r lg:border-b-0" aria-label="Sample recipients">
              {items.map((it, i) => (
                <li key={it.leadId}>
                  <button
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-current={i === safeIndex ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 px-4 py-2 text-left text-sm focus-visible:bg-indigo-50 focus-visible:outline-none",
                      i === safeIndex ? "bg-indigo-50" : "hover:bg-slate-50",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-900">{it.name || it.to}</span>
                      <span className="block truncate text-xs text-slate-500">{it.companyName || it.to}</span>
                    </span>
                    {it.skipped ? (
                      <Badge tone="gray">Skip</Badge>
                    ) : it.missing.length ? (
                      <Badge tone="yellow">{it.missing.length} missing</Badge>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
            <div className="min-w-0 space-y-3 p-4 sm:p-5">
              {sample.skipped && (
                <Alert tone="error" title="This recipient will be SKIPPED">
                  {sample.skipReason ?? "No reason given"}
                </Alert>
              )}
              {sample.missing.length > 0 && (
                <Alert tone="warning" title="Missing values">
                  {sample.missing.map((m) => (
                    <Badge key={m} tone="slate" className="mr-1 font-mono">{`{{${m}}}`}</Badge>
                  ))}
                </Alert>
              )}
              <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <p className="flex gap-2">
                  <span className="w-16 shrink-0 text-slate-500">To:</span>
                  <span className="min-w-0 break-all">{sample.name ? `${sample.name} <${sample.to}>` : sample.to}</span>
                </p>
                <p className="flex gap-2">
                  <span className="w-16 shrink-0 text-slate-500">Subject:</span>
                  <span className="min-w-0 font-medium break-words">{sample.subject}</span>
                </p>
              </div>
              <div className="max-h-[26rem] overflow-y-auto rounded-lg border border-slate-200 px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words text-slate-800">
                {sample.body}
              </div>

              <form onSubmit={sendTest} className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3" noValidate>
                <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-indigo-900 uppercase">
                  <FlaskConical className="size-4 text-indigo-600" aria-hidden="true" /> Test email — does not count toward the daily quota
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <label htmlFor="campaign-test-to" className="sr-only">
                    Test recipient email
                  </label>
                  <Input
                    id="campaign-test-to"
                    type="email"
                    placeholder="you@yourcompany.com"
                    value={testTo}
                    onChange={(e) => {
                      setTestTo(e.target.value);
                      setTestError(null);
                    }}
                    aria-invalid={testError ? true : undefined}
                    className="min-w-0 sm:flex-1"
                  />
                  <Button type="submit" loading={testing}>
                    {!testing && <Send />} Send test
                  </Button>
                </div>
                <p className={cn("text-xs", testError ? "text-red-600" : "text-slate-500")} role={testError ? "alert" : undefined}>
                  {testError ?? `Sends this sample (rendered for ${sample.name || sample.to}) to your address with a [TEST] subject prefix.`}
                </p>
              </form>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
