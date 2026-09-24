"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash } from "lucide-react";
import { toast } from "sonner";
import type { TemplateDTO } from "@/lib/types";
import { api } from "@/lib/client/api";
import { useApiQuery } from "@/lib/client/hooks";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, PageHeader, PageSkeleton } from "@/components/ui/feedback";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TemplateComposer, type ComposerValue } from "@/components/template-composer";

const EMPTY: ComposerValue = { name: "", subject: "", body: "" };

export function TemplateEditor({ templateId }: { templateId: string | null }) {
  const router = useRouter();
  const { data, error, errorStatus, reload } = useApiQuery<TemplateDTO>(templateId ? `/api/templates/${templateId}` : null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const back = (
    <Link href="/templates" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
      <ArrowLeft className="size-4" aria-hidden="true" /> Templates
    </Link>
  );

  if (templateId && error) {
    return (
      <>
        <PageHeader title="Template" back={back} />
        <Card>
          {errorStatus === 404 ? (
            <ErrorState
              title="Template not found"
              message="It may have been deleted."
              action={
                <ButtonLink href="/templates" variant="secondary" size="sm">
                  Back to templates
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
  if (templateId && (!data || data.id !== templateId)) {
    return (
      <>
        <PageHeader title="Template" back={back} />
        <PageSkeleton />
      </>
    );
  }

  const initial: ComposerValue = data ? { name: data.name, subject: data.subject, body: data.body } : EMPTY;

  async function onSave(v: ComposerValue) {
    if (!templateId) {
      const created = await api.post<TemplateDTO>("/api/templates", { name: v.name, subject: v.subject, body: v.body });
      toast.success("Template created");
      router.replace(`/templates/${created.id}`);
      return;
    }
    await api.put<TemplateDTO>(`/api/templates/${templateId}`, { name: v.name, subject: v.subject, body: v.body });
    toast.success("Template saved");
  }

  async function onSendTest(args: { to: string; leadId: string; subject: string; body: string }) {
    const r = await api.post<{ ok: true; providerMessageId: string | null }>("/api/templates/send-test", args);
    return r.providerMessageId;
  }

  async function onDelete() {
    await api.del(`/api/templates/${templateId}`);
    toast.success("Template deleted");
    router.replace("/templates");
  }

  return (
    <>
      <PageHeader
        title={templateId ? data?.name || "Template" : "New template"}
        description="Write once, personalise for every lead. Campaigns copy the template when they're created."
        back={back}
      />
      <TemplateComposer
        key={templateId ?? "new"}
        heading="Email template"
        initial={initial}
        saveLabel={templateId ? "Save" : "Create template"}
        onSave={onSave}
        onSendTest={onSendTest}
        headerActions={
          templateId ? (
            <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(true)} aria-label="Delete template" title="Delete template">
              <Trash className="text-red-600" />
            </Button>
          ) : undefined
        }
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={onDelete}
        destructive
        title="Delete this template?"
        message="Existing campaigns keep their own copy of the content and are not affected. This cannot be undone."
        confirmLabel="Delete template"
      />
    </>
  );
}
