# MAIL — HTTP API contract

All DTO types referenced here are defined in `src/lib/types.ts`.

Conventions

- JSON in / JSON out. Errors: HTTP 4xx/5xx with body `{ "error": string, "details"?: any }`.
  `details` for validation errors (400) is a zod `flatten()` result.
- Dates are ISO-8601 strings (UTC).
- Every route except `/api/auth/login`, `/api/unsubscribe` and `/api/cron/*` requires the
  admin session cookie (401 otherwise).
- Mutating requests (POST/PUT/PATCH/DELETE) must send `X-Requested-With: mail`
  (the browser helper `src/lib/client/api.ts` does this) — 403 otherwise.
- Rate limited per IP (429 with `Retry-After`).
- Pagination query: `page` (1-based, default 1), `pageSize` (default 25, max 100).
  Paginated responses: `Paginated<T>` = `{ items, total, page, pageSize }`.

## Auth

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/auth/login` | `{ password }` | `{ ok: true }` + session cookie |
| POST | `/api/auth/logout` | – | `{ ok: true }` |

## Dashboard / usage

| GET | `/api/dashboard` | → `DashboardDTO` |
|---|---|---|
| GET | `/api/usage` | → `UsageDTO` (used by the top bar; poll every ~30 s) |

## Leads & CSV import

| Method | Path | Body / query | Response |
|---|---|---|---|
| POST | `/api/leads/import/preview` | multipart `file` (CSV, ≤ 10 MB) | `ImportPreviewDTO` (columns, auto-suggested mapping, first 5 rows) |
| POST | `/api/leads/import` | multipart `file` + `mapping` (JSON string of `ColumnMapping`, `email` required) | `ImportSummaryDTO` |
| GET | `/api/leads/imports` | – | `{ items: ImportSummaryDTO[] }` (last 20, `issues` truncated to 200) |
| GET | `/api/leads` | `search`, `status` (`READY|PENDING|SENT|FAILED|SKIPPED`), `sort` (`name|company|status|lastSent|createdAt|email`), `order` (`asc|desc`), `page`, `pageSize` | `Paginated<LeadDTO> & { statusCounts: StatusCounts<LeadStatus> }` |
| GET | `/api/leads/[id]` | – | `LeadDTO` |
| DELETE | `/api/leads/[id]` | – | `{ ok: true }` |
| GET | `/api/leads/variables` | – | `{ variables: TemplateVariableDTO[] }` — every canonical field + every CSV column seen + system vars (`unsubscribe_url`) |
| GET | `/api/leads/options` | `search` | `{ items: { id, email, name, companyName }[] }` (max 50; for the "select lead" dropdowns) |

## Templates

Template syntax: `{{variable}}`, `{{variable|fallback text}}`. Variable keys are
snake_case CSV headers (e.g. header `Company Name` → `{{company_name}}`).
System variable: `{{unsubscribe_url}}`.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/templates` | – | `{ items: TemplateDTO[] }` |
| POST | `/api/templates` | `{ name, subject, body }` | `TemplateDTO` |
| GET | `/api/templates/[id]` | – | `TemplateDTO` |
| PUT | `/api/templates/[id]` | `{ name?, subject?, body? }` | `TemplateDTO` |
| DELETE | `/api/templates/[id]` | – | `{ ok: true }` |
| POST | `/api/templates/preview` | `{ subject, body, leadId }` | `RenderPreviewDTO` (never sends) |
| POST | `/api/templates/send-test` | `{ subject, body, leadId, to }` | `{ ok: true, providerMessageId }` — subject prefixed `[TEST]`, does NOT count toward quota |

## Campaigns

Lifecycle: `DRAFT → READY (has recipients + valid template) → RUNNING | SCHEDULED → PAUSED ⇄ RUNNING → COMPLETED`; `STOPPED` is terminal (remaining pending deliveries become SKIPPED).
Editing (PATCH, recipients) is allowed only in `DRAFT` / `READY`.
A lead that is already queued (PENDING/PROCESSING) in another campaign that can still send is
skipped at start (`errorCode: "queued_elsewhere"`, counted in `CampaignPreviewDTO.summary.queuedElsewhere`),
and `retry-failed` never requeues such a lead. `CampaignDTO.sendingHaltedReason` /
`DashboardDTO.worker.haltedReason` are non-null while ALL sending is halted (Resend auth/sender
error or the permanent-failure circuit breaker); a successful `POST /api/resend/test` or a
resume clears it.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/campaigns` | – | `{ items: CampaignDTO[] }` |
| POST | `/api/campaigns` | `{ name, templateId?, subjectTemplate?, bodyTemplate?, dailyLimit? }` (template content copied if `templateId` given) | `CampaignDTO` |
| GET | `/api/campaigns/[id]` | – | `CampaignDTO` |
| PATCH | `/api/campaigns/[id]` | `{ name?, templateId?, subjectTemplate?, bodyTemplate?, dailyLimit? }` | `CampaignDTO` |
| DELETE | `/api/campaigns/[id]` | – (not allowed while RUNNING/SCHEDULED) | `{ ok: true }` |
| GET | `/api/campaigns/[id]/recipients` | `search`, `page`, `pageSize` | `Paginated<{ lead: LeadDTO; deliveryStatus: DeliveryStatus \| null }>` |
| POST | `/api/campaigns/[id]/recipients` | `{ mode: "add" \| "remove" \| "set" \| "clear", leadIds?: string[], filter?: { status?: LeadStatus, search?: string, notContacted?: boolean } }` — `filter` selects all matching leads server-side | `{ recipientCount }` |
| POST | `/api/campaigns/[id]/preview` | `{ leadIds?: string[], limit?: number (default 10, max 50) }` | `CampaignPreviewDTO` (dry run, nothing sent; summary covers ALL recipients) |
| POST | `/api/campaigns/[id]/send-test` | `{ to, leadId }` | `{ ok: true, providerMessageId }` (TEST, no quota) |
| POST | `/api/campaigns/[id]/start` | `{ schedule?: { date: "YYYY-MM-DD", time: "HH:mm", timezone: "Asia/Kolkata" } }` | `CampaignDTO & { enqueued: number, skipped: number }` → status `RUNNING` (or `SCHEDULED`) |
| POST | `/api/campaigns/[id]/pause` | – | `CampaignDTO` |
| POST | `/api/campaigns/[id]/resume` | – | `CampaignDTO` |
| POST | `/api/campaigns/[id]/stop` | – | `CampaignDTO` |
| POST | `/api/campaigns/[id]/retry-failed` | – | `CampaignDTO & { requeued: number }` (requeues FAILED deliveries whose error was not permanent) |

## Queue / history

| Method | Path | Query / body | Response |
|---|---|---|---|
| GET | `/api/deliveries` | `status`, `campaignId`, `search`, `page`, `pageSize` (sorted newest activity first) | `Paginated<DeliveryDTO>` |
| GET | `/api/deliveries/[id]` | – | `DeliveryDetailDTO` |
| POST | `/api/queue/process` | – | `WorkerResultDTO` (runs one worker pass now — same code path as cron; safe to call anytime) |

"Email Queue" page = deliveries with `status=PENDING` / `PROCESSING` (+ FAILED awaiting retry).
"Send History" page = deliveries with status SENT/FAILED/SKIPPED (or all).

## Suppression list

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/suppressions` | `search`, `page`, `pageSize` | `Paginated<SuppressionDTO>` |
| POST | `/api/suppressions` | `{ email, reason? }` | `SuppressionDTO` |
| DELETE | `/api/suppressions/[id]` | – | `{ ok: true }` |

## Settings / Resend

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/settings` | – | `SettingsDTO` |
| PUT | `/api/settings` | partial `{ fromName, fromEmail, replyTo, dailyLimit, sendDelaySeconds, maxRetries, missingVariableBehavior, fallbackValues, timezone, includeUnsubscribe }` | `SettingsDTO` |
| POST | `/api/resend/test` | – | `{ ok: boolean, message: string }` (authenticates with Resend, sends nothing) |

## Worker / public

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET/POST | `/api/cron/process-email-queue` | `Authorization: Bearer $CRON_SECRET` | One worker pass → `WorkerResultDTO` |
| POST | `/api/unsubscribe?e=<email>&t=<token>` | signed token | RFC 8058 one-click + the `/unsubscribe` page form |

Public page: `/unsubscribe?e=…&t=…` (confirmation button → POST above). Login page: `/login`.
