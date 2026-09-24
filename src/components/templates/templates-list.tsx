"use client";

import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import type { TemplateDTO } from "@/lib/types";
import { useApiQuery } from "@/lib/client/hooks";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/feedback";
import { TimeAgo } from "@/components/ui/time";

export function TemplatesList() {
  const { data, error, reload } = useApiQuery<{ items: TemplateDTO[] }>("/api/templates");

  return (
    <>
      <PageHeader
        title="Templates"
        description="Reusable subject + body with {{variables}}. Campaigns copy a template when created."
        actions={
          <ButtonLink href="/templates/new">
            <Plus /> New template
          </ButtonLink>
        }
      />
      {error ? (
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : !data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="space-y-3 p-5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-16 w-full" />
            </Card>
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText />}
            title="No templates yet"
            description="Write your first email with personalised variables like {{first_name}} and {{company_name}}, then preview it against real leads."
            action={
              <ButtonLink href="/templates/new">
                <Plus /> Create template
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.items.map((t) => (
            <li key={t.id}>
              <Link
                href={`/templates/${t.id}`}
                className="group flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                    <FileText className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-slate-900 group-hover:text-indigo-700">{t.name}</h2>
                    <p className="mt-0.5 truncate font-mono text-xs text-slate-600">{t.subject || "(no subject)"}</p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-3 flex-1 text-sm whitespace-pre-line text-slate-500">{t.body || "(empty body)"}</p>
                <p className="mt-4 text-xs text-slate-400">
                  Updated <TimeAgo value={t.updatedAt} />
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
