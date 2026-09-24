"use client";

import { useMemo, useState } from "react";
import { Play, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import type { CampaignDTO } from "@/lib/types";
import { api } from "@/lib/client/api";
import { listTimezones, notifyUsageChanged } from "@/lib/client/hooks";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Alert, Skeleton } from "@/components/ui/feedback";
import { usePreview } from "@/components/campaigns/preview-tab";
import { cn, errorMessage, formatNumber } from "@/lib/utils";

const DEFAULT_TZ = "Asia/Kolkata";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Today (local) as YYYY-MM-DD and the next full hour as HH:mm. */
function defaultSchedule() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export function StartDialog({
  open,
  onClose,
  campaign,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  campaign: CampaignDTO;
  onStarted: (c: CampaignDTO) => void;
}) {
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [date, setDate] = useState(() => defaultSchedule().date);
  const [time, setTime] = useState(() => defaultSchedule().time);
  const [timezone, setTimezone] = useState(campaign.timezone || DEFAULT_TZ);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => listTimezones(), []);

  const { data, error: previewError } = usePreview(campaign.id, open ? `start|${campaign.updatedAt}|${campaign.recipientCount}` : null, 1);
  const s = data?.summary;

  async function start() {
    setError(null);
    if (mode === "schedule" && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))) {
      setError("Pick a date and time for the schedule.");
      return;
    }
    setPending(true);
    try {
      const r = await api.post<CampaignDTO & { enqueued: number; skipped: number }>(
        `/api/campaigns/${campaign.id}/start`,
        mode === "schedule" ? { schedule: { date, time, timezone } } : {},
      );
      toast.success(r.status === "SCHEDULED" ? "Campaign scheduled" : "Campaign started", {
        description: `Enqueued ${formatNumber(r.enqueued)}, skipped ${formatNumber(r.skipped)}`,
      });
      notifyUsageChanged();
      onStarted(r);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  const rows: [string, React.ReactNode][] = [
    ["Campaign", <span key="n" className="font-medium">{campaign.name}</span>],
    [
      "Recipients",
      <span key="r">
        {formatNumber(campaign.recipientCount)}{" "}
        {s ? (
          <span className="text-slate-500">
            (will send <span className="font-medium text-emerald-700">{formatNumber(s.willSend)}</span>, will skip{" "}
            <span className={cn("font-medium", s.willSkip ? "text-amber-700" : "")}>{formatNumber(s.willSkip)}</span>)
          </span>
        ) : previewError ? (
          <span className="text-xs text-red-600">(couldn&apos;t compute: {previewError})</span>
        ) : (
          <Skeleton className="inline-block h-3 w-32 align-middle" />
        )}
      </span>,
    ],
    ["Daily limit", formatNumber(s?.effectiveDailyLimit ?? campaign.dailyLimit)],
    ["Remaining today", s ? formatNumber(s.remainingToday) : <Skeleton key="rt" className="inline-block h-3 w-10 align-middle" />],
    ["Template", <span key="t" className="font-mono text-xs break-words">{campaign.subjectTemplate || "(no subject)"}</span>],
    ["Estimated batches (days)", s ? formatNumber(s.estimatedDays) : <Skeleton key="ed" className="inline-block h-3 w-10 align-middle" />],
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!pending}
      title="Start campaign?"
      description={
        mode === "now"
          ? "Emails are queued now and sent by the server worker at your pacing and daily limit. You can pause or stop at any time."
          : "Emails are queued now but nothing is sent before the scheduled time. After that the server worker sends at your pacing and daily limit. You can pause or stop at any time."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={start} loading={pending} disabled={s?.willSend === 0}>
            {!pending && (mode === "now" ? <Play /> : <CalendarClock />)}
            {mode === "now" ? "Start Campaign" : "Schedule Campaign"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[9.5rem_1fr] gap-3 px-3 py-2">
              <dt className="text-slate-500">{k}</dt>
              <dd className="min-w-0 text-slate-900">{v}</dd>
            </div>
          ))}
        </dl>

        {s && s.queuedElsewhere > 0 && (
          <Alert tone="info" title={`${formatNumber(s.queuedElsewhere)} recipient${s.queuedElsewhere === 1 ? " is" : "s are"} already queued in another campaign`}>
            They are skipped here so nobody gets two cold emails at once. Stop that campaign first if you want them sent from this one.
          </Alert>
        )}

        {campaign.sendingHaltedReason && (
          <Alert tone="error" title="Sending is currently halted">
            <span className="block">{campaign.sendingHaltedReason}</span>The campaign will be queued, but nothing is sent until you run &ldquo;Test Resend Connection&rdquo; in Settings.
          </Alert>
        )}

        {s?.willSend === 0 && (
          <Alert tone="warning" title="Nothing would be sent">
            Every recipient would be skipped. Check the Preview step for reasons.
          </Alert>
        )}

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-slate-700">When</legend>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name="start-mode" checked={mode === "now"} onChange={() => setMode("now")} className="size-4 accent-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500" />
            Start now
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name="start-mode"
              checked={mode === "schedule"}
              onChange={() => setMode("schedule")}
              className="size-4 accent-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
            Schedule
          </label>
          {mode === "schedule" && (
            <div className="grid grid-cols-1 gap-2 pl-6 sm:grid-cols-[1fr_7rem_1fr]">
              <div>
                <label htmlFor="sched-date" className="sr-only">
                  Date
                </label>
                <Input id="sched-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <label htmlFor="sched-time" className="sr-only">
                  Time (HH:mm)
                </label>
                <Input id="sched-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} step={60} />
              </div>
              <div>
                <label htmlFor="sched-tz" className="sr-only">
                  Timezone
                </label>
                <Select id="sched-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {!zones.includes(timezone) && <option value={timezone}>{timezone}</option>}
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}
        </fieldset>

        {error && (
          <Alert tone="error" title="Couldn't start">
            {error}
          </Alert>
        )}
      </div>
    </Modal>
  );
}
