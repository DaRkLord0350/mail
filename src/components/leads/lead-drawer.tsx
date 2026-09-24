"use client";

import Link from "next/link";
import { useState } from "react";
import { Ban, ExternalLink, Trash } from "lucide-react";
import { toast } from "sonner";
import type { LeadDTO } from "@/lib/types";
import { api } from "@/lib/client/api";
import { Drawer } from "@/components/ui/modal";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KeyValue } from "@/components/ui/feedback";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDateTime, formatRelative, leadDisplayName } from "@/lib/utils";

export function websiteHref(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function LeadDrawer({ lead, onClose, onDeleted }: { lead: LeadDTO | null; onClose: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const name = lead ? leadDisplayName(lead) : "";
  const meta = lead ? Object.entries(lead.metadata ?? {}) : [];

  async function remove() {
    if (!lead) return;
    await api.del(`/api/leads/${lead.id}`);
    toast.success(`Deleted ${lead.email}`);
    onDeleted();
  }

  return (
    <>
      <Drawer
        open={lead !== null}
        onClose={onClose}
        title={name || lead?.email || "Lead"}
        description={
          lead && (
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge status={lead.status} />
              {lead.suppressed && (
                <Badge tone="red">
                  <Ban className="size-3" aria-hidden="true" /> Suppressed
                </Badge>
              )}
            </span>
          )
        }
        footer={
          <Button variant="danger-outline" onClick={() => setConfirm(true)}>
            <Trash /> Delete lead
          </Button>
        }
      >
        {lead && (
          <div className="space-y-6 px-5 py-4">
            <section>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Lead</h3>
              <dl className="divide-y divide-slate-100">
                <KeyValue label="Email">
                  <span className="break-all">{lead.email}</span>
                </KeyValue>
                <KeyValue label="First name">{lead.firstName || "—"}</KeyValue>
                <KeyValue label="Last name">{lead.lastName || "—"}</KeyValue>
                <KeyValue label="Display name">{lead.displayName || "—"}</KeyValue>
                <KeyValue label="Company">{lead.companyName || "—"}</KeyValue>
                <KeyValue label="Website">
                  {lead.website ? (
                    <a
                      href={websiteHref(lead.website)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 break-all text-indigo-700 hover:underline"
                    >
                      {lead.website} <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  ) : (
                    "—"
                  )}
                </KeyValue>
                <KeyValue label="Custom domain">{lead.customDomain || "—"}</KeyValue>
                <KeyValue label="Phone">{lead.phone || "—"}</KeyValue>
              </dl>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Outreach</h3>
              <dl className="divide-y divide-slate-100">
                <KeyValue label="Status">
                  <StatusBadge status={lead.status} />
                </KeyValue>
                <KeyValue label="Emails sent">{lead.sendCount}</KeyValue>
                <KeyValue label="Last sent">{lead.lastSentAt ? `${formatDateTime(lead.lastSentAt)} (${formatRelative(lead.lastSentAt)})` : "Never"}</KeyValue>
                <KeyValue label="Last campaign">
                  {lead.lastCampaign ? (
                    <Link href={`/campaigns/${lead.lastCampaign.id}`} className="text-indigo-700 hover:underline">
                      {lead.lastCampaign.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </KeyValue>
                <KeyValue label="Suppressed">{lead.suppressed ? "Yes — will never be emailed" : "No"}</KeyValue>
                <KeyValue label="Added">{formatDateTime(lead.createdAt)}</KeyValue>
              </dl>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                All CSV fields <span className="font-normal normal-case">({meta.length})</span>
              </h3>
              {meta.length === 0 ? (
                <p className="text-sm text-slate-500">No extra metadata.</p>
              ) : (
                <dl className="divide-y divide-slate-100">
                  {meta.map(([k, v]) => (
                    <KeyValue key={k} label={<code className="font-mono text-xs">{`{{${k}}}`}</code>}>
                      {v === "" ? <span className="text-slate-400">(empty)</span> : v}
                    </KeyValue>
                  ))}
                </dl>
              )}
            </section>
          </div>
        )}
      </Drawer>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={remove}
        destructive
        title="Delete this lead?"
        message={
          <>
            <span className="font-medium text-slate-900">{lead?.email}</span> will be permanently removed. If you want to make sure this address is never emailed
            again (even if re-imported), add it to the suppression list instead.
          </>
        }
        confirmLabel="Delete lead"
      />
    </>
  );
}
