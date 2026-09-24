"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { CircleCheck, CircleX, Clock, KeyRound, Mail, Plus, Save, Send, Sparkles, Trash } from "lucide-react";
import { toast } from "sonner";
import { MISSING_VARIABLE_BEHAVIORS, type MissingVariableBehavior, type SettingsDTO } from "@/lib/types";
import { api } from "@/lib/client/api";
import { listTimezones, notifyUsageChanged, useApiQuery, useBeforeUnload } from "@/lib/client/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Alert, ErrorState, PageHeader, Skeleton } from "@/components/ui/feedback";
import { cn, errorMessage, toVariableKey } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CRON_PATH = "/api/cron/process-email-queue";

interface FormState {
  fromName: string;
  fromEmail: string;
  replyTo: string;
  dailyLimit: string;
  sendDelaySeconds: string;
  maxRetries: string;
  missingVariableBehavior: MissingVariableBehavior;
  fallbacks: { id: number; key: string; value: string }[];
  timezone: string;
  includeUnsubscribe: boolean;
}

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
    includeUnsubscribe: s.includeUnsubscribe,
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
    includeUnsubscribe: f.includeUnsubscribe,
  };
}

const BEHAVIOR_TEXT: Record<MissingVariableBehavior, { title: string; text: ReactNode }> = {
  FALLBACK: {
    title: "Use fallback",
    text: (
      <>
        Replace a missing value with the inline fallback (<code className="font-mono">{"{{first_name|there}}"}</code>) or the default below. If
        neither exists the variable becomes empty.
      </>
    ),
  },
  REMOVE: { title: "Remove", text: "Silently drop the variable (renders as an empty string). Inline fallbacks still apply." },
  SKIP: { title: "Skip the lead", text: "Don't email a lead that is missing any variable without a fallback. Safest for personalised copy." },
};

export function SettingsView() {
  const { data, error, reload } = useApiQuery<SettingsDTO>("/api/settings");
  return (
    <>
      <PageHeader title="Settings" description="Sender identity, sending limits and personalisation rules." />
      {error && !data ? (
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : !data ? (
        <div className="space-y-4" role="status" aria-label="Loading settings">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : (
        <SettingsForm initial={data} />
      )}
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
  const zones = useMemo(() => listTimezones(), []);
  const [nextId, setNextId] = useState(1000);

  const payload = toPayload(form);
  const dirty = JSON.stringify(payload) !== baseline;
  useBeforeUnload(dirty);

  const ceiling = settings.dailyLimitCeiling;
  const errors: Partial<Record<"fromEmail" | "replyTo" | "dailyLimit" | "sendDelaySeconds" | "maxRetries", string>> = {};
  if (payload.fromEmail && !EMAIL_RE.test(payload.fromEmail)) errors.fromEmail = "Not a valid email address";
  if (payload.replyTo && !EMAIL_RE.test(payload.replyTo)) errors.replyTo = "Not a valid email address";
  if (!Number.isInteger(payload.dailyLimit) || payload.dailyLimit < 1) errors.dailyLimit = "Enter a whole number ≥ 1";
  else if (payload.dailyLimit > ceiling) errors.dailyLimit = `Can't exceed ${ceiling} (DAILY_SEND_LIMIT)`;
  if (!Number.isFinite(payload.sendDelaySeconds) || payload.sendDelaySeconds < 0) errors.sendDelaySeconds = "Enter 0 or more seconds";
  if (!Number.isInteger(payload.maxRetries) || payload.maxRetries < 0 || payload.maxRetries > 10) errors.maxRetries = "Enter 0–10";
  const hasErrors = Object.keys(errors).length > 0;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (hasErrors) {
      toast.error("Fix the highlighted fields first");
      return;
    }
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
      const r = await api.post<{ ok: boolean; message: string }>("/api/gmail/test");
      setTestResult(r);
    } catch (err) {
      setTestResult({ ok: false, message: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 pb-20" noValidate>
      {/* Email */}
      <Card>
        <CardHeader title="Email" icon={<Mail />} description="Who your emails come from. Leave blank to use the server's environment defaults." />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="From name" htmlFor="s-from-name">
              <Input id="s-from-name" value={form.fromName} onChange={(e) => set("fromName", e.target.value)} placeholder="Rahul from Acme" />
            </Field>
            <Field label="From email" htmlFor="s-from-email" error={errors.fromEmail} hint="Must match the Gmail account authorized with OAuth.">
              <Input
                id="s-from-email"
                type="email"
                value={form.fromEmail}
                onChange={(e) => set("fromEmail", e.target.value)}
                placeholder="rahul@yourdomain.com"
                aria-invalid={errors.fromEmail ? true : undefined}
              />
            </Field>
            <Field label="Reply-To" htmlFor="s-reply-to" error={errors.replyTo} hint="Optional — where replies go.">
              <Input
                id="s-reply-to"
                type="email"
                value={form.replyTo}
                onChange={(e) => set("replyTo", e.target.value)}
                placeholder="rahul@yourdomain.com"
                aria-invalid={errors.replyTo ? true : undefined}
              />
            </Field>
          </div>
          <p className="text-sm text-slate-600">
            Currently sending as:{" "}
            {settings.sender.configured && settings.sender.formatted ? (
              <span className="font-medium break-all text-slate-900">{settings.sender.formatted}</span>
            ) : (
              <Badge tone="red">Not configured</Badge>
            )}
          </p>
        </CardBody>
      </Card>

      {/* Sending */}
      <Card>
        <CardHeader title="Sending" icon={<Send />} description="Pacing protects your sender reputation." />
        <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field
            label="Daily limit"
            htmlFor="s-daily"
            error={errors.dailyLimit}
            hint={`Emails per day across all campaigns. Max ${ceiling} (set by DAILY_SEND_LIMIT on the server).`}
          >
            <Input
              id="s-daily"
              type="number"
              inputMode="numeric"
              min={1}
              max={ceiling}
              value={form.dailyLimit}
              onChange={(e) => set("dailyLimit", e.target.value)}
              aria-invalid={errors.dailyLimit ? true : undefined}
            />
          </Field>
          <Field label="Delay between emails (seconds)" htmlFor="s-delay" error={errors.sendDelaySeconds} hint="Minimum gap between two sends.">
            <Input
              id="s-delay"
              type="number"
              inputMode="numeric"
              min={0}
              value={form.sendDelaySeconds}
              onChange={(e) => set("sendDelaySeconds", e.target.value)}
              aria-invalid={errors.sendDelaySeconds ? true : undefined}
            />
          </Field>
          <Field label="Max retries" htmlFor="s-retries" error={errors.maxRetries} hint="For temporary failures (rate limits, timeouts).">
            <Input
              id="s-retries"
              type="number"
              inputMode="numeric"
              min={0}
              max={10}
              value={form.maxRetries}
              onChange={(e) => set("maxRetries", e.target.value)}
              aria-invalid={errors.maxRetries ? true : undefined}
            />
          </Field>
        </CardBody>
      </Card>

      {/* Personalization */}
      <Card>
        <CardHeader title="Personalization" icon={<Sparkles />} />
        <CardBody className="space-y-6">
          <fieldset>
            <legend className="text-sm font-medium text-slate-700">Missing variable behavior</legend>
            <p className="mt-0.5 text-xs text-slate-500">What happens when a lead has no value for a variable used in the template.</p>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
              {MISSING_VARIABLE_BEHAVIORS.map((b) => (
                <label
                  key={b}
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-indigo-500",
                    form.missingVariableBehavior === b ? "border-indigo-300 bg-indigo-50" : "border-slate-200 hover:bg-slate-50",
                  )}
                >
                  <input
                    type="radio"
                    name="missing-behavior"
                    value={b}
                    checked={form.missingVariableBehavior === b}
                    onChange={() => set("missingVariableBehavior", b)}
                    className="mt-0.5 size-4 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>
                    <span className="block font-medium text-slate-900">
                      {BEHAVIOR_TEXT[b].title} <code className="ml-1 font-mono text-[10px] text-slate-400">{b}</code>
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-600">{BEHAVIOR_TEXT[b].text}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <h3 className="text-sm font-medium text-slate-700">Default fallback values</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Used when a lead is missing a value and the template has no inline fallback, e.g. <code className="font-mono">first_name → there</code>.
            </p>
            <ul className="mt-3 space-y-2">
              {form.fallbacks.map((row) => (
                <li key={row.id} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[14rem_1fr_auto]">
                  <div className="col-span-2 sm:col-span-1">
                    <label htmlFor={`fb-key-${row.id}`} className="sr-only">
                      Variable
                    </label>
                    <Input
                      id={`fb-key-${row.id}`}
                      value={row.key}
                      placeholder="first_name"
                      className="font-mono text-xs"
                      onChange={(e) => set("fallbacks", form.fallbacks.map((r) => (r.id === row.id ? { ...r, key: e.target.value } : r)))}
                    />
                  </div>
                  <div>
                    <label htmlFor={`fb-val-${row.id}`} className="sr-only">
                      Fallback value for {row.key || "variable"}
                    </label>
                    <Input
                      id={`fb-val-${row.id}`}
                      value={row.value}
                      placeholder="there"
                      onChange={(e) => set("fallbacks", form.fallbacks.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)))}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove fallback for ${row.key || "variable"}`}
                    onClick={() => set("fallbacks", form.fallbacks.filter((r) => r.id !== row.id))}
                  >
                    <Trash />
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() => {
                set("fallbacks", [...form.fallbacks, { id: nextId, key: "", value: "" }]);
                setNextId((n) => n + 1);
              }}
            >
              <Plus /> Add fallback
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Field label="Timezone" htmlFor="s-tz" hint="Used for the daily limit reset and schedules.">
              <Select id="s-tz" value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
                {!zones.includes(form.timezone) && <option value={form.timezone}>{form.timezone}</option>}
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="pt-1">
              <Switch
                id="s-unsub"
                checked={form.includeUnsubscribe}
                onChange={(v) => set("includeUnsubscribe", v)}
                label="Include unsubscribe link"
                description="Adds a one-click unsubscribe link and List-Unsubscribe headers. Strongly recommended for deliverability and compliance."
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Gmail */}
      <Card>
        <CardHeader title="Gmail" icon={<KeyRound />} description="The API key lives only on the server (GOOGLE_REFRESH_TOKEN) and is never sent to the browser." />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-slate-600">API connection:</span>
            {settings.gmail.configured ? <Badge tone="green" dot>Configured</Badge> : <Badge tone="red" dot>Not configured</Badge>}
            {settings.gmail.keyHint && <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">{settings.gmail.keyHint}</code>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={testGmail} loading={testing}>
              Test Gmail Connection
            </Button>
            {testResult && (
              <p className={cn("flex items-center gap-1.5 text-sm font-medium", testResult.ok ? "text-emerald-700" : "text-red-700")} role="status">
                {testResult.ok ? <CircleCheck className="size-4" aria-hidden="true" /> : <CircleX className="size-4" aria-hidden="true" />}
                {testResult.ok ? `Connected ✓${testResult.message ? ` — ${testResult.message}` : ""}` : `Connection failed: ${testResult.message}`}
              </p>
            )}
          </div>
          {!settings.gmail.configured && (
            <Alert tone="warning" title="Gmail is not configured">
              Set <code className="font-mono">GOOGLE_REFRESH_TOKEN</code> in the server environment and restart. Campaigns can&apos;t send until it is.
            </Alert>
          )}
        </CardBody>
      </Card>

      {/* Cron */}
      <Card>
        <CardHeader title="Cron" icon={<Clock />} description="A scheduler calls the worker endpoint to send queued emails in the background." />
        <CardBody className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-slate-600">Cron secret:</span>
            {settings.cron.configured ? <Badge tone="green" dot>Configured</Badge> : <Badge tone="red" dot>Not configured</Badge>}
            <span className="text-slate-600">Batch size per run:</span>
            <span className="font-medium tabular-nums">{settings.cron.batchSize}</span>
          </div>
          <div>
            <p className="mb-1 text-slate-600">Endpoint</p>
            <code className="block overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 font-mono text-xs whitespace-pre text-slate-100">
              {`GET or POST  ${CRON_PATH}\nAuthorization: Bearer $CRON_SECRET`}
            </code>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-slate-600">
            <li>Call it every minute (e.g. Vercel Cron, GitHub Actions, or any external cron service).</li>
            <li>Each call sends at most {settings.cron.batchSize} emails, honouring the delay and daily limit, so frequent calls are safe.</li>
            <li>
              Example: <code className="font-mono text-xs break-all">curl -H &quot;Authorization: Bearer $CRON_SECRET&quot; https://your-domain{CRON_PATH}</code>
            </li>
            <li>No cron yet? Use &ldquo;Process queue now&rdquo; on the Dashboard or Email Queue page.</li>
          </ul>
        </CardBody>
      </Card>

      {/* Sticky save bar */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur transition-[transform,visibility] lg:left-60",
          dirty ? "visible translate-y-0" : "invisible translate-y-full",
        )}
        aria-hidden={!dirty}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 sm:px-2 lg:px-4">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-700">
            <span className="size-2 rounded-full bg-amber-500" aria-hidden="true" /> Unsaved changes
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              tabIndex={dirty ? 0 : -1}
              onClick={() => {
                const f = toForm(settings);
                setForm(f);
              }}
            >
              Discard
            </Button>
            <Button type="submit" loading={saving} disabled={hasErrors} tabIndex={dirty ? 0 : -1}>
              {!saving && <Save />} Save settings
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
