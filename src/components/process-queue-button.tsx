"use client";

import { useState } from "react";
import { Zap } from "lucide-react";
import { toast } from "sonner";
import type { WorkerResultDTO } from "@/lib/types";
import { api } from "@/lib/client/api";
import { notifyUsageChanged } from "@/lib/client/hooks";
import { Button, type ButtonProps } from "@/components/ui/button";
import { errorMessage } from "@/lib/utils";

export function toastWorkerResult(r: WorkerResultDTO) {
  const summary = `Processed ${r.processed}: ${r.sent} sent · ${r.failed} failed · ${r.skipped} skipped${r.retried ? ` · ${r.retried} retrying` : ""}`;
  if (r.stopReason === "auth_error" || r.stopReason === "error" || r.stopReason === "not_configured") {
    toast.error(r.message || "Queue processing failed", { description: summary });
  } else if (r.stopReason === "quota_reached") {
    toast.warning("Daily limit reached", { description: `${summary}. ${r.message}` });
  } else {
    toast.success(r.processed === 0 ? "Nothing to send right now" : summary, { description: r.message });
  }
}

export function ProcessQueueButton({
  onDone,
  label = "Process queue now",
  ...props
}: { onDone?: (r: WorkerResultDTO) => void; label?: string } & Omit<ButtonProps, "onClick">) {
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    try {
      const r = await api.post<WorkerResultDTO>("/api/queue/process");
      toastWorkerResult(r);
      notifyUsageChanged();
      onDone?.(r);
    } catch (err) {
      toast.error(`Couldn't process queue: ${errorMessage(err)}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="secondary" {...props} onClick={run} loading={pending}>
      {!pending && <Zap />}
      {label}
    </Button>
  );
}
