import type { CampaignDTO } from "@/lib/types";
import { ProgressBar } from "@/components/ui/feedback";
import { formatNumber, formatPercent } from "@/lib/utils";

export function campaignStats(c: Pick<CampaignDTO, "recipientCount" | "counts" | "status">) {
  const { SENT = 0, FAILED = 0, SKIPPED = 0, PENDING = 0, PROCESSING = 0 } = c.counts ?? {};
  const queued = SENT + FAILED + SKIPPED + PENDING + PROCESSING;
  const total = Math.max(c.recipientCount, queued);
  const done = SENT + FAILED + SKIPPED;
  const started = queued > 0;
  const pending = started ? Math.max(0, total - done) : 0;
  return { total, done, sent: SENT, failed: FAILED, skipped: SKIPPED, pending, processing: PROCESSING, started, ratio: total > 0 ? done / total : 0 };
}

export function CampaignProgress({ campaign, size = "md", showPercent }: { campaign: CampaignDTO; size?: "sm" | "md" | "lg"; showPercent?: boolean }) {
  const s = campaignStats(campaign);
  return (
    <div className="min-w-0 space-y-1.5">
      <ProgressBar
        size={size}
        max={s.total}
        label={`${campaign.name} progress: ${s.done} of ${s.total} processed`}
        segments={[
          { value: s.sent, className: "bg-emerald-500", label: `${s.sent} sent` },
          { value: s.failed, className: "bg-red-500", label: `${s.failed} failed` },
          { value: s.skipped, className: "bg-slate-400", label: `${s.skipped} skipped` },
        ]}
      />
      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500 tabular-nums">
        {s.started ? (
          <>
            <span className="text-emerald-700">{formatNumber(s.sent)} Sent</span>
            <span aria-hidden="true">·</span>
            <span className={s.failed ? "text-red-700" : undefined}>{formatNumber(s.failed)} Failed</span>
            {s.skipped > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatNumber(s.skipped)} Skipped</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="text-amber-700">{formatNumber(s.pending)} Pending</span>
            {showPercent && <span className="ml-auto font-medium text-slate-700">{formatPercent(s.ratio)}</span>}
          </>
        ) : (
          <span>
            {formatNumber(s.total)} recipient{s.total === 1 ? "" : "s"} · not started
          </span>
        )}
      </p>
    </div>
  );
}
