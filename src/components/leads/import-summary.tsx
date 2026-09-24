"use client";

import { useMemo, useState } from "react";
import type { ImportIssue, ImportSummaryDTO } from "@/lib/types";
import { StatCard } from "@/components/ui/feedback";
import { Tabs } from "@/components/ui/tabs";
import { Pagination } from "@/components/ui/pagination";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { CircleCheck } from "lucide-react";
import { formatNumber } from "@/lib/utils";

export const ISSUE_LABELS: Record<ImportIssue["type"], string> = {
  invalid_email: "Invalid email",
  missing_email: "Missing email",
  duplicate_in_file: "Duplicate email",
  blank_row: "Blank row",
  malformed_row: "Malformed row",
  missing_name: "Missing name",
  missing_company: "Missing company",
  already_contacted: "Already contacted",
  suppressed: "Suppressed",
};

const ISSUE_TONES: Record<ImportIssue["type"], BadgeTone> = {
  invalid_email: "red",
  missing_email: "red",
  duplicate_in_file: "orange",
  blank_row: "gray",
  malformed_row: "red",
  missing_name: "yellow",
  missing_company: "yellow",
  already_contacted: "blue",
  suppressed: "red",
};

export function ImportStats({ s }: { s: ImportSummaryDTO }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total rows" value={formatNumber(s.totalRows)} />
        <StatCard label="Valid leads" value={formatNumber(s.validLeads)} tone="indigo" hint={`${formatNumber(s.createdLeads)} new · ${formatNumber(s.updatedLeads)} updated`} />
        <StatCard label="Ready to send" value={formatNumber(s.readyToSend)} tone="green" />
        <StatCard label="Invalid emails" value={formatNumber(s.invalidEmails)} tone={s.invalidEmails ? "red" : "slate"} />
        <StatCard label="Duplicate emails" value={formatNumber(s.duplicateEmails)} tone={s.duplicateEmails ? "yellow" : "slate"} />
        <StatCard label="Missing names" value={formatNumber(s.missingNames)} tone={s.missingNames ? "yellow" : "slate"} />
        <StatCard label="Missing company names" value={formatNumber(s.missingCompanies)} tone={s.missingCompanies ? "yellow" : "slate"} />
        <StatCard label="Already contacted" value={formatNumber(s.alreadyContacted)} tone={s.alreadyContacted ? "blue" : "slate"} />
      </div>
      <p className="text-xs text-slate-500">
        Also: {formatNumber(s.blankRows)} blank row{s.blankRows === 1 ? "" : "s"} and {formatNumber(s.malformedRows)} malformed row
        {s.malformedRows === 1 ? "" : "s"} were ignored. Leads with a missing name or company were still imported — fallbacks apply when rendering.
      </p>
    </div>
  );
}

type IssueFilter = "all" | ImportIssue["type"];
const PAGE = 25;

export function ImportIssuesTable({ issues, truncatedNote }: { issues: ImportIssue[]; truncatedNote?: string }) {
  const [filter, setFilter] = useState<IssueFilter>("all");
  const [page, setPage] = useState(1);

  const byType = useMemo(() => {
    const m = new Map<ImportIssue["type"], number>();
    for (const i of issues) m.set(i.type, (m.get(i.type) ?? 0) + 1);
    return m;
  }, [issues]);

  const filtered = filter === "all" ? issues : issues.filter((i) => i.type === filter);
  const rows = filtered.slice((page - 1) * PAGE, page * PAGE);

  const columns: Column<ImportIssue & { _k: string }>[] = [
    { key: "row", header: "Row", className: "w-20 tabular-nums", cell: (i) => <span title={`CSV line ${i.row + 1}`}>{i.row}</span> },
    { key: "type", header: "Type", primary: false, cell: (i) => <Badge tone={ISSUE_TONES[i.type]}>{ISSUE_LABELS[i.type] ?? i.type}</Badge> },
    { key: "message", header: "Message", cell: (i) => <span className="text-slate-700">{i.message}</span> },
    { key: "email", header: "Email", primary: true, cell: (i) => <span className="break-all text-slate-600">{i.email || "—"}</span> },
  ];

  if (issues.length === 0) {
    return <EmptyState icon={<CircleCheck />} title="No issues" description="Every row imported cleanly." className="py-8" />;
  }

  return (
    <div>
      <div className="px-4 pt-2 sm:px-5">
        <Tabs
          ariaLabel="Filter issues by type"
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
          tabs={[
            { value: "all" as IssueFilter, label: "All", count: issues.length },
            ...Array.from(byType.entries()).map(([t, n]) => ({ value: t as IssueFilter, label: ISSUE_LABELS[t] ?? t, count: n })),
          ]}
        />
      </div>
      <DataTable
        caption="Import issues"
        columns={columns}
        rows={rows.map((r, idx) => ({ ...r, _k: `${r.row}-${r.type}-${idx}` }))}
        rowKey={(r) => r._k}
      />
      {filtered.length > PAGE && <Pagination page={page} pageSize={PAGE} total={filtered.length} onPageChange={setPage} itemLabel="issues" />}
      {truncatedNote && <p className="px-5 pb-3 text-xs text-slate-500">{truncatedNote}</p>}
    </div>
  );
}
