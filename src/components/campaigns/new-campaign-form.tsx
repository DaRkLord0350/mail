"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { toast } from "sonner";
import type { CampaignDTO, SettingsDTO, TemplateDTO } from "@/lib/types";
import { api } from "@/lib/client/api";
import { useApiQuery } from "@/lib/client/hooks";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { PageHeader, Skeleton } from "@/components/ui/feedback";
import { errorMessage } from "@/lib/utils";

export function NewCampaignForm() {
  const router = useRouter();
  const templates = useApiQuery<{ items: TemplateDTO[] }>("/api/templates");
  const settings = useApiQuery<SettingsDTO>("/api/settings");
  const ceiling = settings.data?.dailyLimitCeiling ?? 100;

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [dailyLimit, setDailyLimit] = useState<string>("");
  const [errors, setErrors] = useState<{ name?: string; dailyLimit?: string }>({});
  const [pending, setPending] = useState(false);

  const defaultLimit = Math.min(100, ceiling);
  const effectiveLimit = dailyLimit === "" ? defaultLimit : Number(dailyLimit);
  const selectedTemplate = templates.data?.items.find((t) => t.id === templateId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = "Give the campaign a name";
    if (!Number.isInteger(effectiveLimit) || effectiveLimit < 1) errs.dailyLimit = "Enter a whole number of at least 1";
    else if (effectiveLimit > ceiling) errs.dailyLimit = `Can't exceed the account ceiling of ${ceiling}`;
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setPending(true);
    try {
      const c = await api.post<CampaignDTO>("/api/campaigns", {
        name: name.trim(),
        ...(templateId ? { templateId } : { subjectTemplate: "", bodyTemplate: "" }),
        dailyLimit: effectiveLimit,
      });
      toast.success("Campaign created");
      router.push(`/campaigns/${c.id}`);
    } catch (err) {
      toast.error(`Couldn't create campaign: ${errorMessage(err)}`);
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New campaign"
        description="Start from a saved template (its content is copied into the campaign) or from a blank email."
        back={
          <Link href="/campaigns" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-4" aria-hidden="true" /> Campaigns
          </Link>
        }
      />
      <Card className="max-w-2xl">
        <CardBody>
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <Field label="Campaign name" htmlFor="c-name" required error={errors.name}>
              <Input
                id="c-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. D2C Outreach — September"
                autoFocus
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? "c-name-error" : undefined}
              />
            </Field>

            <Field
              label="Template"
              htmlFor="c-template"
              hint={
                templates.data && templates.data.items.length === 0 ? (
                  <>
                    No templates yet — start blank, or{" "}
                    <Link href="/templates/new" className="text-indigo-700 hover:underline">
                      create a template
                    </Link>{" "}
                    first.
                  </>
                ) : (
                  "You can still edit the subject and body inside the campaign until it starts."
                )
              }
            >
              {templates.data ? (
                <Select id="c-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">Start blank</option>
                  {templates.data.items.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              ) : templates.error ? (
                <p className="text-sm text-red-600">Couldn&apos;t load templates: {templates.error}</p>
              ) : (
                <Skeleton className="h-9 w-full" />
              )}
            </Field>

            {selectedTemplate && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="font-mono text-xs break-words text-slate-700">{selectedTemplate.subject || "(no subject)"}</p>
                <p className="mt-2 line-clamp-4 text-xs whitespace-pre-line text-slate-500">{selectedTemplate.body}</p>
              </div>
            )}

            <Field
              label="Daily limit for this campaign"
              htmlFor="c-limit"
              error={errors.dailyLimit}
              hint={`Default ${defaultLimit}. Max ${ceiling} (account-wide ceiling). The global daily limit in Settings also applies.`}
            >
              <Input
                id="c-limit"
                type="number"
                inputMode="numeric"
                min={1}
                max={ceiling}
                step={1}
                placeholder={String(defaultLimit)}
                value={dailyLimit}
                onChange={(e) => setDailyLimit(e.target.value)}
                className="max-w-40"
                aria-invalid={errors.dailyLimit ? true : undefined}
              />
            </Field>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
              <ButtonLink href="/campaigns" variant="secondary">
                Cancel
              </ButtonLink>
              <Button type="submit" loading={pending}>
                {!pending && <Plus />} Create campaign
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
