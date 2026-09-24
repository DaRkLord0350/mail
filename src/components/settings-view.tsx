"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CircleCheck, CircleX, Clock, KeyRound, Mail, Plus, Save, Send, Sparkles, Trash } from "lucide-react";
import { toast } from "sonner";
import { MISSING_VARIABLE_BEHAVIORS, type MissingVariableBehavior, type SettingsDTO } from "@/lib/types";
import { api } from "@/lib/client/api";
import { listTimezones, notifyUsageChanged, useApiQuery, useBeforeUnload } from "@/lib/client/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, ErrorState, PageHeader, Skeleton } from "@/components/ui/feedback";
import { cn, errorMessage, toVariableKey } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CRON_PATH = "/api/cron/process-email-queue";

type Fallback = { id: number; key: string; value: string };

type FormState = {
  fromName: string;
  fromEmail: string;
  replyTo: string;
  dailyLimit: string;
  sendDelaySeconds: string;
  maxRetries: string;
  missingVariableBehavior: MissingVariableBehavior;
  fallbacks: Fallback[];
  timezone: string;
};

function toForm(s: SettingsDTO): FormState {
  return {
    fromName: s.fromName ?? "",
    fromEmail: s.fromEmail ?? "",
    replyTo: s.replyTo ?? "",
    dailyLimit: String(s.dailyLimit),
    sendDelaySeconds: String(s.sendDelaySeconds),
    maxRetries: String(s.maxRetries),
    missingVariableBehavior: s.missingVariableBehavior,
    fallbacks: Object.entries(s.fallbackValues ?? {}).map(([key, value], i) => ({ id: i, key, value })),
    timezone: s.timezone,
  };
}

function toPayload(f: FormState) {
  const fallbackValues: Record<string, string> = {};
  for (const row of f.fallbacks) {
    const k = toVariableKey(row.key);
    if (k) fallbackValues[k] = row.value;
  }
  return {
    fromName: f.fromName.trim(),
    fromEmail: f.fromEmail.trim(),
    replyTo: f.replyTo.trim(),
    dailyLimit: Number(f.dailyLimit),
    sendDelaySeconds: Number(f.sendDelaySeconds),
    maxRetries: Number(f.maxRetries),
    missingVariableBehavior: f.missingVariableBehavior,
    fallbackValues,
    timezone: f.timezone,
  };
}

const BEHAVIOR_TEXT: Record<MissingVariableBehavior, string> = {
  FALLBACK: "Use an inline or configured fallback value when available.",
  REMOVE: "Remove a missing variable and render it as an empty string.",
  SKIP: "Skip the lead when a required personalization value is missing.",
};

export function SettingsView() {
  const { data, error, reload } = useApiQuery<SettingsDTO>("/api/settings");
  return (
    <>
      <PageHeader title="Settings" description="Sender identity, sending limits and personalisation rules." />
      {error && !data ? <Card><ErrorState message={error} onRetry={reload} /></Card> : !data ? (
        <div className="space-y-4" role="status" aria-label="Loading settings">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : <SettingsForm initial={data} />}
    </>
  );
}

function SettingsForm({ initial }: { initial: SettingsDTO }) {
  const [settings, setSettings] = useState(initial);
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  const [baseline, setBaseline] = useState(() => JSON.stringify(toPayload(toForm(initial))));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [nextId, setNextId] = useState(1000);
  const zones = useMemo(() => listTimezones(), []);

  const payload = toPayload(form);
  const dirty = JSON.stringify(payload) !== baseline;
  useBeforeUnload(dirty);

  const ceiling = settings.dailyLimitCeiling;
  const errors: Record<string, string> = {};
  if (payload.fromEmail && !EMAIL_RE.test(payload.fromEmail)) errors.fromEmail = "Not a valid email address";
  if (payload.replyTo && !EMAIL_RE.test(payload.replyTo)) errors.replyTo = "Not a valid email address";
  if (!Number.isInteger(payload.dailyLimit) || payload.dailyLimit < 1) errors.dailyLimit = "Enter a whole number ≥ 1";
  else if (payload.dailyLimit > ceiling) errors.dailyLimit = `Can't exceed ${ceiling}`;
  if (!Number.isFinite(payload.sendDelaySeconds) || payload.sendDelaySeconds < 0) errors.sendDelaySeconds = "Enter 0 or more seconds";
  if (!Number.isInteger(payload.maxRetries) || payload.maxRetries < 0 || payload.maxRetries > 10) errors.maxRetries = "Enter 0–10";
  const hasErrors = Object.keys(errors).length > 0;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (hasErrors) return toast.error("Fix the highlighted fields first");
    setSaving(true);
    try {
      const s = await api.put<SettingsDTO>("/api/settings", payload);
      setSettings(s);
      const f = toForm(s);
      setForm(f);
      setBaseline(JSON.stringify(toPayload(f)));
      notifyUsageChanged();
      toast.success("Settings saved");
    } catch (err) {
      toast.error(`Save failed: ${errorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function testGmail() {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.post<{ ok: boolean; message: string }>("/api/gmail/test"));
    } catch (err) {
      setTestResult({ ok: false, message: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 pb-20" noValidate>
      <Card>
        <CardHeader title="Email" icon={<Mail />} description="Personal sender identity. Replies go directly to the configured address." />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="From name" htmlFor="s-from-name"><Input id="s-from-name" value={form.fromName} onChange={(e) => set("fromName", e.target.value)} /></Field>
            <Field label="From email" htmlFor="s-from-email" error={errors.fromEmail} hint="Must match the Gmail account authorized with OAuth."><Input id="s-from-email" type="email" value={form.fromEmail} onChange={(e) => set("fromEmail", e.target.value)} aria-invalid={!!errors.fromEmail} /></Field>
            <Field label="Reply-To" htmlFor="s-reply-to" error={errors.replyTo} hint="Optional — where replies go."><Input id="s-reply-to" type="email" value={form.replyTo} onChange={(e) => set("replyTo", e.target.value)} aria-invalid={!!errors.replyTo} /></Field>
          </div>
          <p className="text-sm text-slate-600">Currently sending as: {settings.sender.configured ? <span className="font-medium text-slate-900">{settings.sender.formatted}</span> : <Badge tone="red">Not configured</Badge>}</p>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">This is configured as direct personal outreach. The app does not add unsubscribe links or List-Unsubscribe headers.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Sending" icon={<Send />} description="Pacing protects your sender reputation." />
        <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Daily limit" htmlFor="s-daily" error={errors.dailyLimit} hint={`Maximum ${ceiling} from DAILY_SEND_LIMIT.`}><Input id="s-daily" type="number" min={1} max={ceiling} value={form.dailyLimit} onChange={(e) => set("dailyLimit", e.target.value)} /></Field>
          <Field label="Delay between emails (seconds)" htmlFor="s-delay" error={errors.sendDelaySeconds}><Input id="s-delay" type="number" min={0} value={form.sendDelaySeconds} onChange={(e) => set("sendDelaySeconds", e.target.value)} /></Field>
          <Field label="Max retries" htmlFor="s-retries" error={errors.maxRetries}><Input id="s-retries" type="number" min={0} max={10} value={form.maxRetries} onChange={(e) => set("maxRetries", e.target.value)} /></Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Personalization" icon={<Sparkles />} />
        <CardBody className="space-y-6">
          <fieldset>
            <legend className="text-sm font-medium text-slate-700">Missing variable behavior</legend>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
              {MISSING_VARIABLE_BEHAVIORS.map((b) => (
                <label key={b} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3 text-sm", form.missingVariableBehavior === b ? "border-indigo-300 bg-indigo-50" : "border-slate-200")}>
                  <input type="radio" name="missing-behavior" value={b} checked={form.missingVariableBehavior === b} onChange={() => set("missingVariableBehavior", b)} />
                  <span><span className="block font-medium text-slate-900">{b}</span><span className="text-xs text-slate-600">{BEHAVIOR_TEXT[b]}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <h3 className="text-sm font-medium text-slate-700">Default fallback values</h3>
            <ul className="mt-3 space-y-2">
              {form.fallbacks.map((row) => (
                <li key={row.id} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[14rem_1fr_auto]">
                  <Input value={row.key} placeholder="first_name" onChange={(e) => set("fallbacks", form.fallbacks.map((r) => r.id === row.id ? { ...r, key: e.target.value } : r))} />
                  <Input value={row.value} placeholder="there" onChange={(e) => set("fallbacks", form.fallbacks.map((r) => r.id === row.id ? { ...r, value: e.target.value } : r))} />
                  <Button variant="ghost" size="icon" type="button" onClick={() => set("fallbacks", form.fallbacks.filter((r) => r.id !== row.id))}><Trash /></Button>
                </li>
              ))}
            </ul>
            <Button variant="secondary" size="sm" type="button" className="mt-2" onClick={() => { set("fallbacks", [...form.fallbacks, { id: nextId, key: "", value: "" }]); setNextId((n) => n + 1); }}><Plus /> Add fallback</Button>
          </div>
          <Field label="Timezone" htmlFor="s-tz"><Select id="s-tz" value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>{!zones.includes(form.timezone) && <option value={form.timezone}>{form.timezone}</option>}{zones.map((z) => <option key={z} value={z}>{z}</option>)}</Select></Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Gmail" icon={<KeyRound />} description="Gmail API OAuth is server-only." />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm"><span className="text-slate-600">API connection:</span>{settings.gmail.configured ? <Badge tone="green" dot>Configured</Badge> : <Badge tone="red" dot>Not configured</Badge>}{settings.gmail.keyHint && <code className="rounded bg-slate-100 px-2 py-0.5 text-xs">{settings.gmail.keyHint}</code>}</div>
          <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" type="button" onClick={testGmail} loading={testing}>Test Gmail Connection</Button>{testResult && <p className={cn("flex items-center gap-1.5 text-sm font-medium", testResult.ok ? "text-emerald-700" : "text-red-700")}>{testResult.ok ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}{testResult.message}</p>}</div>
          {!settings.gmail.configured && <Alert tone="warning" title="Gmail is not configured">Set <code>GOOGLE_REFRESH_TOKEN</code> in the server environment and restart.</Alert>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Cron" icon={<Clock />} description="A scheduler calls the queue worker in the background." />
        <CardBody className="space-y-3 text-sm"><p className="text-slate-600">Batch size per run: <strong>{settings.cron.batchSize}</strong></p><code className="block overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-100">GET or POST {CRON_PATH}{"\n"}Authorization: Bearer $CRON_SECRET</code></CardBody>
      </Card>

      <div className={cn("fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:left-60", dirty ? "visible" : "invisible") }>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3"><p className="text-sm font-medium text-amber-700">{dirty ? "Unsaved changes" : ""}</p><div className="flex gap-2"><Button variant="secondary" type="button" onClick={() => setForm(toForm(settings))}>Discard</Button><Button type="submit" loading={saving} disabled={hasErrors}><Save /> Save settings</Button></div></div>
      </div>
    </form>
  );
}
