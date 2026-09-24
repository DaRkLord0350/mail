// Personalization engine. Pure: no DB, safe for client and server.
//
// Syntax:  {{variable}}            -> lead value
//          {{variable|fallback}}   -> lead value, or "fallback" when empty
// Variables are snake_case keys (canonical fields + normalized CSV headers).
// Rendering is single-pass: values that themselves contain "{{...}}" are
// inserted literally and never re-rendered.
import type { MissingVariableBehavior } from "@/lib/types";

export const VARIABLE_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*(?:\|([^}]*))?\}\}/g;

/** Built-in variables that are always available. */
export const SYSTEM_VARIABLES = ["unsubscribe_url"] as const;

export interface TemplateVariableRef {
  key: string;
  fallback: string | null;
}

export function extractVariables(template: string): TemplateVariableRef[] {
  const out: TemplateVariableRef[] = [];
  for (const m of template.matchAll(VARIABLE_RE)) {
    out.push({ key: m[1].toLowerCase(), fallback: m[2] !== undefined ? m[2].trim() : null });
  }
  return out;
}

export function uniqueVariableKeys(...templates: string[]): string[] {
  return [...new Set(templates.flatMap((t) => extractVariables(t).map((v) => v.key)))];
}

/** Braces that don't form a valid variable, e.g. "{{first name}}" or "{{first_name". */
export function findMalformedPlaceholders(template: string): string[] {
  const stripped = template.replace(VARIABLE_RE, "");
  const bad = stripped.match(/\{\{[^}]*\}?\}?|\{[^{}]*\}\}/g) ?? [];
  return [...new Set(bad.map((b) => b.slice(0, 60)))];
}

export interface RenderOptions {
  behavior: MissingVariableBehavior;
  /** Per-variable fallbacks from Settings, e.g. { first_name: "there" }. */
  fallbacks?: Record<string, string>;
}

export interface RenderResult {
  text: string;
  /** Variables that had no value and no fallback, and block sending (SKIP / FALLBACK w/o value). */
  missing: string[];
  /** Variables removed (REMOVE behavior). */
  removed: string[];
  /** Variables that used a fallback. */
  fellBack: string[];
}

const REMOVED = "\u0000";

/**
 * Clean up only around removed variables (marked with a sentinel):
 * "Hi {{first_name}}," -> "Hi,", "at {{company}} today" -> "at today".
 * Intentional formatting elsewhere in the text is left untouched.
 */
function tidy(text: string): string {
  return text
    .replace(/[ \t]*\u0000+[ \t]*(?=[,.!?;:])/g, "")
    .replace(/[ \t]+\u0000+[ \t]+/g, " ")
    .replace(/\u0000/g, "");
}

/** Values that themselves look like placeholders are treated as missing. */
const LOOKS_LIKE_PLACEHOLDER = /\{\{|\}\}/;

export function renderTemplate(template: string, context: Record<string, string | null | undefined>, opts: RenderOptions): RenderResult {
  const missing = new Set<string>();
  const removed = new Set<string>();
  const fellBack = new Set<string>();
  const ctx: Record<string, string> = {};
  for (const [k, v] of Object.entries(context)) ctx[k.toLowerCase()] = v == null ? "" : String(v);

  const text = template.replace(VARIABLE_RE, (match, rawKey: string, inlineFallback: string | undefined) => {
    const key = rawKey.toLowerCase();
    const raw = (ctx[key] ?? "").trim();
    const value = LOOKS_LIKE_PLACEHOLDER.test(raw) ? "" : raw;
    if (value) return value;

    if (inlineFallback !== undefined && inlineFallback.trim() !== "") {
      fellBack.add(key);
      return inlineFallback.trim();
    }
    switch (opts.behavior) {
      case "FALLBACK": {
        const fb = opts.fallbacks?.[key];
        if (fb !== undefined && fb.trim() !== "") {
          fellBack.add(key);
          return fb.trim();
        }
        missing.add(key);
        return match;
      }
      case "REMOVE":
        removed.add(key);
        return REMOVED;
      case "SKIP":
      default:
        missing.add(key);
        return match;
    }
  });

  return {
    text: removed.size ? tidy(text) : text,
    missing: [...missing],
    removed: [...removed],
    fellBack: [...fellBack],
  };
}

export interface RenderedEmail {
  subject: string;
  body: string;
  missing: string[];
  removed: string[];
  fellBack: string[];
  /** true when the email must not be sent (unresolved variables remain). */
  blocked: boolean;
}

export function renderEmail(
  subjectTemplate: string,
  bodyTemplate: string,
  context: Record<string, string | null | undefined>,
  opts: RenderOptions,
): RenderedEmail {
  const s = renderTemplate(subjectTemplate, context, opts);
  const b = renderTemplate(bodyTemplate, context, opts);
  const missing = [...new Set([...s.missing, ...b.missing])];
  return {
    subject: s.text.replace(/[\r\n]+/g, " ").trim(),
    body: b.text,
    missing,
    removed: [...new Set([...s.removed, ...b.removed])],
    fellBack: [...new Set([...s.fellBack, ...b.fellBack])],
    blocked: missing.length > 0,
  };
}

/** Lead record -> variable context. CSV metadata first, canonical fields override. */
export interface LeadLike {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  displayName?: string | null;
  website?: string | null;
  customDomain?: string | null;
  phone?: string | null;
  metadata?: unknown;
}

export function leadContext(lead: LeadLike, extra: Record<string, string> = {}): Record<string, string> {
  const ctx: Record<string, string> = {};
  if (lead.metadata && typeof lead.metadata === "object" && !Array.isArray(lead.metadata)) {
    for (const [k, v] of Object.entries(lead.metadata as Record<string, unknown>)) {
      if (v !== null && v !== undefined) ctx[k.toLowerCase()] = String(v);
    }
  }
  const set = (k: string, v: string | null | undefined) => {
    if (v != null && String(v).trim() !== "") ctx[k] = String(v).trim();
  };
  set("email", lead.email);
  set("first_name", lead.firstName);
  set("last_name", lead.lastName);
  set("company_name", lead.companyName);
  set("display_name", lead.displayName);
  set("website", lead.website);
  set("custom_domain", lead.customDomain);
  set("phone", lead.phone);
  const full = [lead.firstName, lead.lastName].filter((x) => x && x.trim()).join(" ");
  if (full && !ctx.full_name) ctx.full_name = full;
  return { ...ctx, ...extra };
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain-text body -> minimal, safe HTML (escaped, linkified, line breaks kept). */
export function textToHtml(text: string): string {
  const parts: string[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    parts.push(escapeHtml(text.slice(last, i)));
    const url = escapeHtml(m[0]);
    parts.push(`<a href="${url}">${url}</a>`);
    last = i + m[0].length;
  }
  parts.push(escapeHtml(text.slice(last)));
  const html = parts.join("").replace(/\r?\n/g, "<br>\n");
  // Same bare structure Gmail uses for a personal message: no styling, no
  // template markup — so it reads (and classifies) as a normal 1:1 email.
  return `<div dir="ltr">${html}</div>`;
}
