"use client";

import Link from "next/link";
import { useRef, useState, type DragEvent } from "react";
import { ArrowLeft, Check, FileUp, Megaphone, RotateCcw, TriangleAlert, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { LEAD_FIELDS, LEAD_FIELD_LABELS, type ColumnMapping, type ImportPreviewDTO, type ImportSummaryDTO, type LeadField } from "@/lib/types";
import { api } from "@/lib/client/api";
import { useApiQuery } from "@/lib/client/hooks";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Alert, EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/modal";
import { DataTable, type Column } from "@/components/ui/data-table";
import { TimeAgo } from "@/components/ui/time";
import { ImportIssuesTable, ImportStats } from "@/components/leads/import-summary";
import { cn, errorMessage, formatNumber, toVariableKey } from "@/lib/utils";

const MAX_BYTES = 10 * 1024 * 1024;
type Step = "upload" | "map" | "done";

const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "Upload CSV" },
  { id: "map", label: "Map columns" },
  { id: "done", label: "Import summary" },
];

export function ImportWizard() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewDTO | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [result, setResult] = useState<ImportSummaryDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const history = useApiQuery<{ items: ImportSummaryDTO[] }>("/api/leads/imports");
  const [openImport, setOpenImport] = useState<ImportSummaryDTO | null>(null);

  async function handleFile(f: File | undefined | null) {
    if (!f) return;
    setUploadError(null);
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") {
      setUploadError("Please choose a .csv file.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setUploadError(`File is too large (${(f.size / 1024 / 1024).toFixed(1)} MB). The limit is 10 MB.`);
      return;
    }
    if (f.size === 0) {
      setUploadError("That file is empty.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const p = await api.post<ImportPreviewDTO>("/api/leads/import/preview", fd);
      setFile(f);
      setPreview(p);
      setMapping({ ...p.suggestedMapping });
      setStep("map");
    } catch (err) {
      setUploadError(errorMessage(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void handleFile(e.dataTransfer.files?.[0]);
  }

  async function runImport() {
    if (!file || !mapping) return;
    if (!mapping.email) {
      toast.error("Map a column to Email first");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mapping", JSON.stringify(mapping));
      const r = await api.post<ImportSummaryDTO>("/api/leads/import", fd);
      setResult(r);
      setStep("done");
      history.reload();
      toast.success(`Imported ${formatNumber(r.validLeads)} leads`, {
        description: `${formatNumber(r.createdLeads)} new, ${formatNumber(r.updatedLeads)} updated, ${formatNumber(r.readyToSend)} ready to send`,
      });
    } catch (err) {
      toast.error(`Import failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setMapping(null);
    setResult(null);
    setUploadError(null);
  }

  const mappedCols = new Set(Object.values(mapping ?? {}).filter((v): v is string => Boolean(v)));
  const duplicateCols = mapping
    ? Array.from(mappedCols).filter((c) => Object.values(mapping).filter((v) => v === c).length > 1)
    : [];
  const unmapped = preview ? preview.columns.filter((c) => !mappedCols.has(c)) : [];
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <>
      <PageHeader
        title="Import leads"
        description="Upload a CSV, confirm how its columns map to lead fields, and review exactly what happened."
        back={
          <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-4" aria-hidden="true" /> Leads
          </Link>
        }
      />

      {/* Stepper */}
      <ol className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm" aria-label="Import steps">
        {STEPS.map((s, i) => {
          const done = i < stepIndex;
          const current = i === stepIndex;
          return (
            <li key={s.id} className="flex items-center gap-2" aria-current={current ? "step" : undefined}>
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                  done ? "bg-emerald-600 text-white" : current ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-600",
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
              </span>
              <span className={cn("font-medium", current ? "text-slate-900" : "text-slate-500")}>{s.label}</span>
              {i < STEPS.length - 1 && <span className="mx-1 hidden h-px w-8 bg-slate-300 sm:block" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>

      {step === "upload" && (
        <Card>
          <CardBody>
            <label
              htmlFor="csv-file"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors focus-within:ring-2 focus-within:ring-indigo-500",
                dragging ? "border-indigo-500 bg-indigo-50" : "border-slate-300 hover:border-indigo-400 hover:bg-slate-50",
                busy && "pointer-events-none opacity-60",
              )}
            >
              <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                <FileUp className="size-6" aria-hidden="true" />
              </span>
              <span className="text-sm font-medium text-slate-900">{busy ? "Reading file…" : "Drop a CSV here, or click to choose"}</span>
              <span className="mt-1 text-xs text-slate-500">.csv up to 10 MB · first row must be headers · an email column is required</span>
              <input
                ref={inputRef}
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => void handleFile(e.target.files?.[0])}
                disabled={busy}
              />
            </label>
            {uploadError && (
              <Alert tone="error" title="Couldn't read that file" className="mt-4">
                {uploadError}
              </Alert>
            )}
          </CardBody>
        </Card>
      )}

      {step === "map" && preview && mapping && (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="CSV column mapping"
              description={
                <>
                  <span className="font-medium text-slate-700">{preview.fileName}</span> · {formatNumber(preview.totalRows)} data rows ·{" "}
                  {preview.columns.length} columns. We pre-filled our best guess — check it.
                </>
              }
            />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {LEAD_FIELDS.map((f: LeadField) => {
                  const missing = f === "email" && !mapping.email;
                  return (
                    <div key={f} className="space-y-1.5">
                      <label htmlFor={`map-${f}`} className="block text-sm font-medium text-slate-700">
                        {LEAD_FIELD_LABELS[f]}
                        {f === "email" && <span className="ml-0.5 text-red-500">*</span>}
                        <code className="ml-2 font-mono text-[11px] font-normal text-slate-400">{`{{${f}}}`}</code>
                      </label>
                      <Select
                        id={`map-${f}`}
                        value={mapping[f] ?? ""}
                        onChange={(e) => setMapping({ ...mapping, [f]: e.target.value || null })}
                        aria-invalid={missing || undefined}
                        aria-describedby={missing ? "map-email-error" : undefined}
                      >
                        <option value="">— not mapped —</option>
                        {preview.columns.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </Select>
                      {missing && (
                        <p id="map-email-error" className="text-xs text-red-600">
                          Email is required.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {duplicateCols.length > 0 && (
                <Alert tone="warning" title="Same column mapped twice">
                  {duplicateCols.join(", ")} {duplicateCols.length === 1 ? "is" : "are"} mapped to more than one field. That&apos;s allowed, but double-check it&apos;s
                  intended.
                </Alert>
              )}

              <Alert tone="info" title="Nothing gets thrown away">
                Every column — mapped or not — is preserved on the lead and usable as a template variable.
                {unmapped.length > 0 && (
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {unmapped.map((c) => (
                      <code key={c} className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs text-sky-900 ring-1 ring-sky-200">
                        {`{{${toVariableKey(c)}}}`}
                      </code>
                    ))}
                  </span>
                )}
              </Alert>
            </CardBody>
          </Card>

          <Card className="min-w-0">
            <CardHeader title="Sample rows" description={`First ${preview.sampleRows.length} rows of the file`} />
            {preview.sampleRows.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">No data rows found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      {preview.columns.map((c) => {
                        const field = LEAD_FIELDS.find((f) => mapping[f] === c);
                        return (
                          <th key={c} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap text-slate-600">
                            {c}
                            <span className={cn("mt-0.5 block font-normal", field ? "text-indigo-600" : "text-slate-400")}>
                              {field ? `→ ${LEAD_FIELD_LABELS[field]}` : `{{${toVariableKey(c)}}}`}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.sampleRows.map((r, i) => (
                      <tr key={i}>
                        {preview.columns.map((c) => (
                          <td key={c} className="max-w-56 truncate px-3 py-2 text-slate-700" title={r[c]}>
                            {r[c] || <span className="text-slate-300">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="secondary" onClick={reset} disabled={busy}>
              <RotateCcw /> Choose a different file
            </Button>
            <Button onClick={runImport} loading={busy} disabled={!mapping.email}>
              {!busy && <Upload />} Import {formatNumber(preview.totalRows)} rows
            </Button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="space-y-4">
          <Alert tone={result.validLeads > 0 ? "success" : "warning"} title={`Import finished: ${result.fileName}`}>
            {formatNumber(result.validLeads)} valid leads ({formatNumber(result.createdLeads)} new, {formatNumber(result.updatedLeads)} updated) out of{" "}
            {formatNumber(result.totalRows)} rows. {formatNumber(result.readyToSend)} are ready to send.
          </Alert>
          <ImportStats s={result} />
          <Card>
            <CardHeader
              title="Issues"
              description="Every row that was rejected or needs attention."
              icon={<TriangleAlert />}
            />
            <ImportIssuesTable issues={result.issues} />
          </Card>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={reset}>
              <RotateCcw /> Import another file
            </Button>
            <ButtonLink href="/leads" variant="secondary">
              <Users /> View leads
            </ButtonLink>
            <ButtonLink href="/campaigns/new">
              <Megaphone /> Create a campaign
            </ButtonLink>
          </div>
        </div>
      )}

      {/* Previous imports */}
      <Card className="mt-8">
        <CardHeader title="Previous imports" description="The last 20 imports." />
        {history.error ? (
          <ErrorState message={history.error} onRetry={history.reload} />
        ) : !history.data ? (
          <ListSkeleton rows={3} />
        ) : history.data.items.length === 0 ? (
          <EmptyState title="No imports yet" description="Your import history will show up here." className="py-8" />
        ) : (
          <DataTable
            caption="Previous imports"
            rows={history.data.items}
            rowKey={(r) => r.id}
            onRowClick={setOpenImport}
            rowLabel={(r) => `Open import ${r.fileName}`}
            columns={historyColumns}
          />
        )}
      </Card>

      <Modal open={openImport !== null} onClose={() => setOpenImport(null)} title={openImport?.fileName ?? "Import"} description={openImport ? <TimeAgo value={openImport.createdAt} /> : undefined} size="xl">
        {openImport && (
          <div className="space-y-4">
            <ImportStats s={openImport} />
            <div className="-mx-5 border-t border-slate-100">
              <ImportIssuesTable
                issues={openImport.issues}
                truncatedNote={openImport.issues.length >= 200 ? "Showing the first 200 issues for past imports." : undefined}
              />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

const historyColumns: Column<ImportSummaryDTO>[] = [
  { key: "file", header: "File", primary: true, cell: (r) => <span className="font-medium break-all text-slate-900">{r.fileName}</span> },
  { key: "date", header: "Imported", cell: (r) => <TimeAgo value={r.createdAt} className="whitespace-nowrap" /> },
  { key: "rows", header: "Rows", className: "tabular-nums", cell: (r) => formatNumber(r.totalRows) },
  { key: "valid", header: "Valid", className: "tabular-nums", cell: (r) => formatNumber(r.validLeads) },
  { key: "ready", header: "Ready", className: "tabular-nums text-emerald-700", cell: (r) => formatNumber(r.readyToSend) },
  {
    key: "issues",
    header: "Issues",
    className: "tabular-nums",
    cell: (r) => (r.issues.length ? <span className="text-amber-700">{formatNumber(r.issues.length)}{r.issues.length >= 200 ? "+" : ""}</span> : "0"),
  },
];
