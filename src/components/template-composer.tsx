"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Braces, CircleCheck, FlaskConical, Save, Send, Upload } from "lucide-react";
import { toast } from "sonner";
import type { RenderPreviewDTO, TemplateVariableDTO } from "@/lib/types";
import { api } from "@/lib/client/api";
import { useApiQuery, useBeforeUnload, useDebouncedValue } from "@/lib/client/hooks";
import { cn, errorMessage, formatPercent } from "@/lib/utils";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Alert, EmptyState, Skeleton } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { LeadSelect, type LeadOption } from "@/components/lead-select";

export interface ComposerValue {
  name: string;
  subject: string;
  body: string;
}

export interface TemplateComposerProps {
  /** Small caps heading, e.g. "EMAIL TEMPLATE". */
  heading: string;
  initial: ComposerValue;
  showName?: boolean;
  nameLabel?: string;
  readOnly?: boolean;
  readOnlyNote?: ReactNode;
  saveLabel?: string;
  /** Persist; throw to signal failure (the composer shows a toast). */
  onSave: (value: ComposerValue) => Promise<void>;
  /** Send a TEST email; throw on failure. Returns the provider message id. */
  onSendTest: (args: { to: string; leadId: string; subject: string; body: string }) => Promise<string | null | undefined>;
  /** When true, unsaved edits are saved before a test is sent (campaign tests use the saved template). */
  saveBeforeTest?: boolean;
  headerActions?: ReactNode;
  onDirtyChange?: (dirty: boolean) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Field = "subject" | "body";

export function TemplateComposer({
  heading,
  initial,
  showName = true,
  nameLabel = "Template name",
  readOnly,
  readOnlyNote,
  saveLabel = "Save",
  onSave,
  onSendTest,
  saveBeforeTest,
  headerActions,
  onDirtyChange,
}: TemplateComposerProps) {
  const [name, setName] = useState(initial.name);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [saved, setSaved] = useState<ComposerValue>(initial);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastFocused = useRef<Field>("body");

  const dirty = !readOnly && (name !== saved.name || subject !== saved.subject || body !== saved.body);
  useBeforeUnload(dirty);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // ---- variables ----------------------------------------------------------
  const vars = useApiQuery<{ variables: TemplateVariableDTO[] }>("/api/leads/variables");
  const variables = useMemo(() => {
    const order = { field: 0, csv: 1, system: 2 } as const;
    return [...(vars.data?.variables ?? [])].sort((a, b) => order[a.source] - order[b.source]);
  }, [vars.data]);

  function insertVariable(key: string) {
    if (readOnly) return;
    const token = `{{${key}}}`;
    const field = lastFocused.current;
    const el = field === "subject" ? subjectRef.current : bodyRef.current;
    const current = field === "subject" ? subject : body;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    if (field === "subject") setSubject(next);
    else setBody(next);
    const caret = start + token.length;
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  // ---- preview ------------------------------------------------------------
  const [lead, setLead] = useState<LeadOption | null>(null);
  const [noLeads, setNoLeads] = useState(false);
  const previewInput = useDebouncedValue({ subject, body, leadId: lead?.id ?? null }, 400);
  const previewKey = previewInput.leadId && (previewInput.subject || previewInput.body) ? JSON.stringify(previewInput) : null;
  const [preview, setPreview] = useState<{ key: string; data?: RenderPreviewDTO; error?: string } | null>(null);
  const [previewMode, setPreviewMode] = useState<"text" | "html">("text");

  useEffect(() => {
    if (!previewKey) return;
    let cancelled = false;
    const input = JSON.parse(previewKey) as { subject: string; body: string; leadId: string };
    api.post<RenderPreviewDTO>("/api/templates/preview", input).then(
      (data) => !cancelled && setPreview({ key: previewKey, data }),
      (err: unknown) => !cancelled && setPreview({ key: previewKey, error: errorMessage(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [previewKey]);

  const previewLoading = previewKey !== null && preview?.key !== previewKey;
  const pv = preview?.data;

  // ---- save ---------------------------------------------------------------
  async function save(): Promise<boolean> {
    if (readOnly) return false;
    if (showName && !name.trim()) {
      setNameError("Name is required");
      toast.error("Give it a name before saving");
      return false;
    }
    setSaving(true);
    try {
      const value = { name: name.trim(), subject, body };
      await onSave(value);
      setSaved({ name: value.name, subject, body });
      setName(value.name);
      return true;
    } catch (err) {
      toast.error(`Save failed: ${errorMessage(err)}`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (dirty && !saving) void save();
    }
  }

  // ---- test send ----------------------------------------------------------
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  async function sendTest(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(testTo.trim())) {
      setTestError("Enter a valid email address");
      return;
    }
    if (!lead) {
      setTestError("Select a lead to personalise the test with");
      return;
    }
    setTestError(null);
    if (saveBeforeTest && dirty) {
      const ok = await save();
      if (!ok) return;
    }
    setTesting(true);
    try {
      const id = await onSendTest({ to: testTo.trim(), leadId: lead.id, subject, body });
      toast.success(`Test email sent to ${testTo.trim()}`, { description: id ? `Resend ID: ${id}` : undefined });
    } catch (err) {
      toast.error(`Test send failed: ${errorMessage(err)}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4" onKeyDown={onKeyDown}>
      {/* Header row */}
      <Card>
        <div className="flex flex-col gap-3 px-4 py-3 sm:px-5 md:flex-row md:items-center">
          <p className="shrink-0 text-xs font-semibold tracking-[0.15em] text-slate-500 uppercase">{heading}</p>
          {showName ? (
            <div className="min-w-0 flex-1">
              <label htmlFor="composer-name" className="sr-only">
                {nameLabel}
              </label>
              <Input
                id="composer-name"
                value={name}
                placeholder={nameLabel}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(null);
                }}
                readOnly={readOnly}
                aria-invalid={nameError ? true : undefined}
                className="md:max-w-md"
              />
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {dirty ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700" role="status">
                <span className="size-2 rounded-full bg-amber-500" aria-hidden="true" /> Unsaved changes
              </span>
            ) : !readOnly && saved.subject + saved.body !== "" ? (
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <CircleCheck className="size-3.5 text-emerald-600" aria-hidden="true" /> Saved
              </span>
            ) : null}
            {headerActions}
            {!readOnly && (
              <Button onClick={() => void save()} loading={saving} disabled={!dirty} title="Save (Ctrl+S)">
                {!saving && <Save />}
                {saveLabel}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {readOnly && readOnlyNote && (
        <Alert tone="info" title="Read-only">
          {readOnlyNote}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Editor */}
        <Card className="min-w-0">
          <CardBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="composer-subject">Subject</Label>
              <Input
                ref={subjectRef}
                id="composer-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                onFocus={() => (lastFocused.current = "subject")}
                placeholder="Quick idea for {{company_name}}"
                readOnly={readOnly}
                className="font-mono text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="composer-body">Body</Label>
              <Textarea
                ref={bodyRef}
                id="composer-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onFocus={() => (lastFocused.current = "body")}
                rows={16}
                placeholder={"Hi {{first_name|there}},\n\nI came across {{company_name}}…"}
                readOnly={readOnly}
                spellCheck
                className="min-h-72 resize-y font-mono text-[13px]"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Braces className="size-4 text-slate-400" aria-hidden="true" />
                <h3 className="text-sm font-medium text-slate-700">Available variables</h3>
              </div>
              {vars.error ? (
                <p className="text-xs text-red-600">Couldn&apos;t load variables: {vars.error}</p>
              ) : !vars.data ? (
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-7 w-28 rounded-full" />
                  ))}
                </div>
              ) : variables.length === 0 ? (
                <p className="text-xs text-slate-500">No variables yet — import leads to get variables from your CSV columns.</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5" aria-label="Insert a variable">
                  {variables.map((v) => (
                    <li key={v.key}>
                      <VariableChip variable={v} onInsert={insertVariable} disabled={readOnly} />
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-slate-500">
                Click a variable to insert it at the cursor. Use <code className="rounded bg-slate-100 px-1 font-mono">{"{{variable|fallback}}"}</code> to
                provide a fallback, e.g. <code className="rounded bg-slate-100 px-1 font-mono">{"{{first_name|there}}"}</code>.
              </p>
            </div>
          </CardBody>
        </Card>

        {/* Preview */}
        <Card className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <CardHeader
            title="Preview"
            description="Rendered for a real lead — nothing is sent."
            actions={
              pv?.html ? (
                <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs" role="group" aria-label="Preview format">
                  {(["text", "html"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPreviewMode(m)}
                      aria-pressed={previewMode === m}
                      className={cn(
                        "rounded-md px-2 py-1 font-medium uppercase focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none",
                        previewMode === m ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              ) : undefined
            }
          />
          <CardBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="composer-lead">Select lead</Label>
              <LeadSelect id="composer-lead" value={lead} onChange={setLead} autoSelectFirst onEmpty={() => setNoLeads(true)} />
            </div>

            {noLeads && !lead ? (
              <EmptyState
                className="py-8"
                icon={<Upload />}
                title="No leads to preview with"
                description="Import a CSV of leads to see how this email renders for real recipients."
                action={
                  <ButtonLink href="/leads/import" size="sm">
                    Import CSV
                  </ButtonLink>
                }
              />
            ) : !subject && !body ? (
              <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                Start writing a subject and body to see a live preview.
              </p>
            ) : preview?.error && !previewLoading ? (
              <Alert tone="error" title="Preview failed">
                {preview.error}
              </Alert>
            ) : !pv ? (
              <div className="space-y-2" role="status" aria-label="Rendering preview">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-40 w-full" />
              </div>
            ) : (
              <div className={cn("space-y-3 transition-opacity", previewLoading && "opacity-60")} aria-busy={previewLoading}>
                <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <p className="flex gap-2">
                    <span className="w-14 shrink-0 text-slate-500">To:</span>
                    <span className="min-w-0 break-all text-slate-900">{pv.to}</span>
                  </p>
                  <p className="flex gap-2">
                    <span className="w-14 shrink-0 text-slate-500">Subject:</span>
                    <span className="min-w-0 font-medium break-words text-slate-900">{pv.subject || <em className="text-slate-400">(empty)</em>}</span>
                  </p>
                </div>
                {previewMode === "html" && pv.html ? (
                  <iframe
                    title="HTML email preview"
                    sandbox=""
                    srcDoc={pv.html}
                    className="h-96 w-full rounded-lg border border-slate-200 bg-white"
                  />
                ) : (
                  <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words text-slate-800">
                    {pv.body || <em className="text-slate-400">(empty body)</em>}
                  </div>
                )}
                {previewLoading && (
                  <p className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Spinner className="size-3" /> Updating preview…
                  </p>
                )}
                <PreviewWarnings preview={pv} />
              </div>
            )}

            {/* Test send */}
            <form onSubmit={sendTest} className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3" noValidate>
              <div className="flex items-center gap-2">
                <FlaskConical className="size-4 text-indigo-600" aria-hidden="true" />
                <p className="text-xs font-semibold tracking-wide text-indigo-900 uppercase">Test email — does not count toward the daily quota</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label htmlFor="composer-test-to" className="sr-only">
                  Test recipient email
                </label>
                <Input
                  id="composer-test-to"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@yourcompany.com"
                  value={testTo}
                  onChange={(e) => {
                    setTestTo(e.target.value);
                    setTestError(null);
                  }}
                  aria-invalid={testError ? true : undefined}
                  aria-describedby="composer-test-help"
                  className="min-w-0 sm:flex-1"
                />
                <Button type="submit" loading={testing} disabled={!lead || (!subject && !body)}>
                  {!testing && <Send />}
                  {saveBeforeTest && dirty ? "Save & send test" : "Send test"}
                </Button>
              </div>
              <p id="composer-test-help" className={cn("text-xs", testError ? "text-red-600" : "text-slate-500")} role={testError ? "alert" : undefined}>
                {testError ??
                  `Rendered with ${lead ? "the selected lead's" : "a lead's"} data; the subject is prefixed with [TEST]. The lead is not contacted.`}
              </p>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function VariableChip({ variable: v, onInsert, disabled }: { variable: TemplateVariableDTO; onInsert: (key: string) => void; disabled?: boolean }) {
  const system = v.source === "system";
  const cov = system ? null : v.coverage;
  const low = cov !== null && cov < 0.8;
  const tip = [
    v.label,
    system ? "System variable" : `${formatPercent(v.coverage)} of leads have a value`,
    v.sampleValue ? `e.g. "${v.sampleValue}"` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onInsert(v.key)}
      disabled={disabled}
      title={tip}
      aria-label={`Insert {{${v.key}}} — ${tip}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60",
        system
          ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
          : v.source === "field"
            ? "border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
      )}
    >
      {`{{${v.key}}}`}
      <span className={cn("font-sans text-[10px]", system ? "text-amber-600" : low ? "text-amber-700" : "text-slate-500")}>
        {system ? "system" : formatPercent(v.coverage)}
      </span>
    </button>
  );
}

export function PreviewWarnings({ preview }: { preview: Pick<RenderPreviewDTO, "missing" | "unknown" | "skipped" | "skipReason"> }) {
  const items: ReactNode[] = [];
  if (preview.skipped) {
    items.push(
      <Alert key="skip" tone="error" title="This lead would be SKIPPED">
        {preview.skipReason ?? "No reason given"}
      </Alert>,
    );
  }
  if (preview.unknown.length > 0) {
    items.push(
      <Alert key="unknown" tone="warning" title="Unknown variables">
        Not found in any lead or CSV column (typo?): <VarList keys={preview.unknown} />
      </Alert>,
    );
  }
  if (preview.missing.length > 0) {
    items.push(
      <Alert key="missing" tone="warning" title="Missing values for this lead">
        <VarList keys={preview.missing} /> — the missing-variable behaviour from Settings applies (fallback, remove or skip).
      </Alert>,
    );
  }
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-700">
        <CircleCheck className="size-3.5" aria-hidden="true" /> All variables resolved for this lead.
      </p>
    );
  }
  return <div className="space-y-2">{items}</div>;
}

function VarList({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {keys.map((k) => (
        <Badge key={k} tone="slate" className="font-mono">{`{{${k}}}`}</Badge>
      ))}
    </span>
  );
}
