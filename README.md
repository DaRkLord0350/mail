# MAIL — Cold Email Outreach System

MAIL is a self-contained internal web app for running personalized cold-email campaigns through the **Gmail API** from your authorized Gmail account (currently intended for `ventorynex@gmail.com`).

You can import a CSV of leads, write a template with `{{variables}}` taken from the CSV's columns, and preview exactly what each person will receive. You can send yourself a test, then launch (or schedule) a campaign. After that, a persistent server-side queue does the sending. It is paced, respects the application quota, retries safely, never sends duplicates within the queue, and records every attempt.

> Gmail's own per-user sending limits still apply. The MAIL quota is an additional application-level safety ceiling; it cannot increase Google's limit.

## 1. What MAIL does

| Area | Features |
|---|---|
| **Leads** | CSV upload, column detection with suggested mappings you can correct by hand, validation (format, required email, valid email, duplicates, blank or malformed rows, missing names and companies) with a full import report where no row is silently dropped. Every original column is kept in `metadata` JSON. Lead table with search, filters, sorting and server-side pagination. |
| **Templates** | Editable subject and body. A variable picker built from your CSV columns. Live preview for any real lead. Test email to any address. |
| **Personalization** | `{{first_name}}` and `{{first_name\|there}}` syntax. You choose what happens when a variable is missing: *skip the lead*, *remove the variable*, or *use a fallback*. A literal `{{first_name}}` is never sent. |
| **Campaigns** | Draft → Ready → Running / Scheduled → Paused ⇄ Running → Completed, or Stopped. You pick recipients, run a dry-run preview, confirm, then start now or at a scheduled date, time and timezone. Pause, resume, stop, and retry failed sends. |
| **Queue** | A persistent `EmailDelivery` queue in Postgres. Workers are triggered by cron, by `npm run worker`, or by the "Process now" button. Sends are paced (default 30 s apart). Retries are capped with backoff. Stuck deliveries are recovered after a crash. |
| **Safety** | An atomic daily quota that concurrent workers cannot bypass. Unique `(campaign, lead)` and `(campaign, email)` constraints. database-backed queue/idempotency safeguards. A suppression list. Emails go out as plain personal 1:1 messages (no unsubscribe footer or bulk-mail headers by default). |
| **Tracking** | Dashboard, today's usage (`37 / 100`), campaign progress, an email queue page, and send history with full rendered content and the Gmail message ID. |

Only real data is shown. An email is marked **SENT** only after Resend accepts
it and returns a message ID. MAIL does not invent delivered, opened or clicked
statistics.

---

## 2. Architecture

```
Browser (Next.js pages, React client components)
   │  fetch /api/*  (session cookie + X-Requested-With header)
   ▼
src/proxy.ts            auth · CSRF · rate limiting
   ▼
API routes (src/app/api/**)   zod-validated, thin
   ▼
Services (src/lib/server/*)
   ├─ leads.ts        CSV import, lead queries, template variables
   ├─ campaigns.ts    lifecycle, recipients, dry run, start/pause/resume/stop
   ├─ worker.ts       persistent send queue  ◄── cron / npm run worker / "Process now"
   ├─ quota.ts        atomic DailyUsage reservation
   ├─ compose.ts      render + unsubscribe footer + outgoing message
   └─ test-email.ts   test sends (no quota)
   ▼
src/lib/email/resend.ts   the Gmail API transport (legacy filename retained for compatibility)
   ▼
Gmail API
```

Pure, unit-tested modules: `src/lib/csv/parse.ts` (CSV parsing, mapping and
validation), `src/lib/template/render.ts` (personalization engine) and
`src/lib/email/errors.ts` (classifying Resend errors).

### Data model (Prisma, `prisma/schema.prisma`)

`Lead` · `ImportBatch` · `Template` · `Campaign` · `CampaignLead` (the recipients
chosen while a campaign is a draft) · `EmailDelivery` (the queue and the audit
log, unique per campaign and lead) · `Suppression` · `DailyUsage` (per day and
scope) · `Settings` (singleton) · `WorkerState` (pacing gate and halt flag) ·
`TestEmail`.

### How one email gets sent

On **Start**, every recipient is rendered once. The rendered subject and body,
plus the raw templates, are frozen onto an `EmailDelivery` row with status
`PENDING`. A recipient who can't be sent to becomes `SKIPPED` with the reason:
suppressed, invalid address, or missing personalization. Later edits to the
template never change what was recorded.

Each worker pass then runs these steps:

1. **Recover** rows stuck in `PROCESSING` for more than 10 minutes and put them
   back to `PENDING`. They keep the same idempotency key, so Resend deduplicates
   them. If the last attempt was more than 23 hours ago, the key has expired, so
   the row becomes `FAILED / unknown outcome` for you to review instead.
2. **Promote** scheduled campaigns whose start time has passed to `RUNNING`.
3. **Skip** pending deliveries to addresses that were suppressed after the
   campaign started.
4. Repeat until the batch size or the time budget is used up. One DB
   transaction does all of this:
   - **Pacing gate.** `WorkerState.nextSendAt` must be in the past; it is moved
     forward by the delay. This enforces the gap between emails across every
     worker on every instance.
   - **Claim** the next due `PENDING` row of a `RUNNING` campaign with
     `FOR UPDATE SKIP LOCKED`.
   - **Reserve quota** with a single `INSERT … ON CONFLICT DO UPDATE … WHERE
     emailsSent < limit`, first globally and then per campaign.
   - Mark the row `PROCESSING` and give it a fencing `lockToken`.

   If any step fails, the whole transaction rolls back. The worker then:
   - sends through Resend, with the idempotency key and a 20 s timeout;
   - records the result with a write that must match the `lockToken`, so a
     worker whose lock expired can't overwrite anything;
   - on success, sets `SENT` and stores the message ID;
   - on a temporary failure, sets `PENDING` again with backoff (1 min, 5 min,
     25 min…) up to *Max retries*;
   - on a permanent failure, sets `FAILED`;
   - on a problem with the API key, sender domain or Resend account quota,
     halts all sending and pauses running campaigns until you fix it.
5. **Complete** campaigns that have nothing left pending.

---

## 3. Installation

Requirements: Node.js 20+ (22 recommended) and a PostgreSQL database (local,
Supabase, Neon, RDS…).

```bash
cd MAIL
npm install                 # also runs `prisma generate`
cp .env.example .env        # then fill it in (see below)
npx prisma migrate deploy   # create tables in the configured schema
npm run dev                 # http://localhost:3000
```

In a second terminal, start the queue worker so campaigns actually send
locally:

```bash
npm run worker
```

Other commands:

| Command | Purpose |
|---|---|
| `npm run build` / `npm run start` | Production build and server |
| `npm run worker` | Long-running queue worker |
| `npm test` | Unit tests (no DB needed) |
| `npm run test:integration` | Queue, quota and concurrency tests against `TEST_DATABASE_URL` |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npx prisma migrate dev` | Create a migration after changing `schema.prisma` |
| `npm run db:studio` | Browse the database |

Log in with `ADMIN_PASSWORD`.

---

## 4. Environment variables

All variables are **server-only**. No `NEXT_PUBLIC_` variables exist.

| Variable | Required | Default | Description |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | yes | – | OAuth 2.0 client ID from Google Cloud. |
| `GOOGLE_CLIENT_SECRET` | yes | – | OAuth 2.0 client secret. |
| `GOOGLE_REDIRECT_URI` | yes | local callback example | Must exactly match an Authorized redirect URI in Google Cloud. |
| `GOOGLE_REFRESH_TOKEN` | yes (to send) | – | Offline OAuth refresh token for the Gmail account that authorized the app. |
| `FROM_EMAIL` | yes | `ventorynex@gmail.com` | Sender identity. Use the same Gmail account that authorized OAuth. |
| `FROM_NAME` | recommended | `NexVentory` | Display name. |
| `DATABASE_URL` | yes | – | Postgres URL. Keep `?schema=mail`. |
| `DIRECT_URL` | yes | – | Direct/session-pooler URL for migrations. |
| `TEST_DATABASE_URL` | tests only | – | Separate test schema. |
| `DAILY_SEND_LIMIT` | – | `100` | MAIL's hard application ceiling. Google may impose a lower limit. |
| `DEFAULT_SEND_DELAY_SECONDS` | – | `60` | Minimum gap between campaign emails. |
| `CRON_BATCH_SIZE` | – | `5` | Maximum emails per worker pass. |
| `CRON_MAX_RUNTIME_SECONDS` | – | `50` | Worker time budget. |
| `APP_TIMEZONE` | – | `Asia/Kolkata` | Quota/schedule timezone. |
| `CRON_SECRET` | yes for cron | – | Bearer token for the queue endpoint. |
| `ADMIN_PASSWORD` | yes | – | Dashboard login password. |
| `SESSION_SECRET` | yes | – | Session signing secret. |
| `UNSUBSCRIBE_SECRET` | recommended | = `SESSION_SECRET` | Separate unsubscribe signing key. |
| `APP_URL` | yes | `http://localhost:3000` | Public app URL. |
| `ENABLE_INTERNAL_WORKER` | – | `false` | Run worker inside a single long-running server. |

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Google OAuth setup

1. In Google Cloud Console, enable **Gmail API**.
2. Configure **OAuth consent / Google Auth Platform** for the application.
3. Create a **Web application** OAuth client.
4. Add the exact redirect URI used by MAIL, for example:
   `http://localhost:3000/api/auth/google/callback`.
5. Run MAIL's OAuth flow and authorize **`ventorynex@gmail.com`**.
6. Store the resulting offline refresh token as `GOOGLE_REFRESH_TOKEN` on the server.

Never commit client secrets or refresh tokens.

## 5. Database setup

MAIL uses **PostgreSQL + Prisma**. Everything is created inside the schema named
in `DATABASE_URL` (`?schema=mail`). That keeps it separate from anything else in
the same database.

```bash
npx prisma migrate deploy     # production / first run
npx prisma migrate dev        # development: apply and create migrations
```

The initial migration also inserts the singleton `Settings` and `WorkerState`
rows and adds CHECK constraints.

**Supabase.** Use the **session pooler** (`…pooler.supabase.com:5432`) or the
direct connection for both `DATABASE_URL` and `DIRECT_URL`. If you use the
transaction pooler (port `6543`):
- add `&pgbouncer=true&connection_limit=1` to `DATABASE_URL`;
- point `DIRECT_URL` at the session pooler.

All raw SQL is schema-qualified, so it works in both modes.

**Connection limit:** the Supabase session pooler allows only ~15 clients, so keep `&connection_limit=5` (the default in `.env.example`). **Serverless tip:** use `&connection_limit=1&pool_timeout=20` to
`DATABASE_URL`. The worker runs sequentially, so one connection per instance is
enough.

---

## 6. Gmail setup

MAIL now sends through the Gmail API. Resend is no longer required.

After the Google OAuth flow has produced `GOOGLE_REFRESH_TOKEN`, set the Gmail environment variables, restart the server, and use **Settings → Test Gmail Connection**. A successful connection confirms that the server can access the authorized Gmail account without sending an email.

## 7. CSV import

**Leads → Import CSV**

1. **Upload** a `.csv` file (UTF-8, up to 10 MB; comma, semicolon, tab or `|`
   delimiters). Quoted fields containing commas are handled.
2. **Map columns.** MAIL suggests a mapping for Email, First Name, Last Name,
   Company, Display Name, Website, Custom Domain and Phone. It recognizes
   common synonyms such as `E-mail`, `Company Name`, `Mobile` and
   `custom_domain`. Correct anything by hand; only **Email** is required.
   Columns you don't map are **still kept** and usable as variables.
3. **Import.** The summary shows:
   - total rows, valid leads, invalid emails, duplicate emails;
   - missing names, missing companies, already contacted, ready to send;
   - created and updated leads, blank and malformed rows;
   - a row-by-row issue list.

   No row is silently dropped.

Rules:

- Emails are trimmed and lowercased, and must be unique.
- Within one file, the first row wins; later duplicates are reported.
- Re-importing an existing email updates its fields and merges its metadata. It
  never resets status or send history.
- A row with more fields than the header is skipped as malformed, since the
  columns would be misaligned. A row with fewer fields is imported with empty
  values and reported.
- Suppressed addresses are imported but flagged. They are never emailed.

---

## 8. Template variables

The variables come from your data. The canonical fields are
`{{first_name}} {{last_name}} {{full_name}} {{company_name}} {{display_name}}
{{website}} {{custom_domain}} {{email}} {{phone}}`. **Every CSV column** also
becomes a variable: its header is converted to snake_case, so `Instagram
Handle` becomes `{{instagram_handle}}` and `city` becomes `{{city}}`. The
system variable `{{unsubscribe_url}}` is always available.

| Syntax | Result |
|---|---|
| `{{company_name}}` | The lead's value |
| `{{first_name\|there}}` | The value, or `there` if it's empty |

**Missing-variable behavior** (Settings → Personalization):

| Mode | When a variable is empty |
|---|---|
| **Skip** (default) | The lead is not emailed. Its delivery is recorded as `SKIPPED` with the reason. |
| **Remove** | The variable becomes an empty string, and stray spaces are tidied (`Hi {{first_name}},` → `Hi,`). |
| **Fallback** | The per-variable fallback from Settings is used (e.g. `first_name → there`). With no fallback configured, the lead is skipped. |

An inline `{{var|fallback}}` always takes priority. Unknown variables and
malformed placeholders (e.g. `{{first name}}`) are flagged in the editor, and
they block the campaign from starting. Values are inserted literally and never
re-rendered.

**Personal-mail mode (default).** Emails are sent like a normal 1:1 message
from your own address: plain text plus a bare `<div dir="ltr">` HTML part,
**no unsubscribe footer and no `List-Unsubscribe` headers**. Those headers mark
mail as bulk, which pushes it toward Gmail's Promotions tab. If you ever need
them, turn on **Include unsubscribe link** in Settings: MAIL then adds a short
footer (unless your body already uses `{{unsubscribe_url}}`) and the RFC 8058
one-click headers.

---

## 9. Creating a campaign

1. **Campaigns → New campaign.** Give it a name, optionally start from a saved
   template, and set a per-campaign daily limit (at most the global limit).
2. **Template.** Edit the subject and body, click variables to insert them, and
   watch the live preview for any lead.
3. **Recipients.** Add leads individually, or use **Add all Ready leads (not
   contacted)**.
4. **Preview & Validate (dry run).** See will-send and will-skip counts,
   suppressed and missing-variable counts, and sample rendered emails. Nothing
   is sent. Send a test email from here too.
5. **Start.** The confirmation dialog shows recipients, daily limit, remaining
   sends today and the estimated number of days. Choose **Start now** or
   **Schedule** (date, time and timezone, e.g. `Asia/Kolkata`).
6. **Watch progress** on the campaign page or the dashboard. **Pause**,
   **Resume**, **Stop** (remaining sends are skipped), **Retry failed**
   (temporary failures only).

Once started, a campaign's template and recipients are frozen.

A lead is never queued in two campaigns at once. If a recipient is still
pending in another campaign that can send, it is skipped with the reason
*Already queued in campaign "…"*. The preview and the Start dialog show how
many recipients this affects. **Retry failed** also leaves such leads alone.

---

## 10. The daily sending limit

- Effective limit = `min(Settings daily limit, DAILY_SEND_LIMIT)`. The default
  is **100**. Each campaign can also have a smaller cap.
- Counted in `DailyUsage` for each **day in the configured timezone**, so it
  resets at local midnight.
- **Every attempt that reaches Resend counts**, including failures, because
  some failures may still have been delivered. That errs on the side of never
  exceeding the limit. Test emails don't count.
- The reservation is one atomic SQL statement inside the claim transaction.
  Any number of concurrent workers (cron, manual, `npm run worker`, several
  serverless instances) can never push the count past the limit. There is an
  integration test for exactly this.
- When the limit is reached, the worker stops and remaining emails stay
  `PENDING`. They go out the next day, continuing from where the queue stopped.

Today's usage is shown in the top bar and on the dashboard (`37 / 100 · 63
remaining`).

---

## 11. Cron / worker setup

Sending never depends on a browser tab. Pick one or more triggers; running
several at once is safe.

**A. External cron hitting the endpoint (serverless hosts).** Recommended: every minute.

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-app.example.com/api/cron/process-email-queue
```

Each call sends up to `CRON_BATCH_SIZE` emails within
`CRON_MAX_RUNTIME_SECONDS`, respecting the delay. With a 30 s delay, that's
about 2 emails per minute, so 100 emails take roughly an hour. Suitable
schedulers include cron-job.org, GitHub Actions (5-minute minimum), a server
crontab, and Vercel Cron.

**Vercel Cron.** Add a `vercel.json`. Vercel sends
`Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set.
Note that Hobby plans only allow daily crons, so use Pro or an external
scheduler.

```json
{ "crons": [{ "path": "/api/cron/process-email-queue", "schedule": "* * * * *" }] }
```

**B. Long-running worker (VM, container, local dev)**

```bash
npm run worker      # loops forever, same logic, no serverless limits
```

**C. In-process (single `npm start` server).** Set `ENABLE_INTERNAL_WORKER=true`.

**D. Manual.** Click **Process queue now** on the dashboard, queue or campaign
page.

---

## 12. Production deployment

1. Provision Postgres and set all env vars on the host. Use a strong
   `ADMIN_PASSWORD` and `SESSION_SECRET`, and `APP_URL=https://…`.
2. Run `npx prisma migrate deploy` (in CI or as a release step).
3. Run `npm run build`, then `npm run start`, or deploy to Vercel. The build
   runs `prisma generate`.
4. Configure a trigger from section 11.
5. Verify: log in, go to Settings, click **Test Resend Connection**, then send
   a test email.

Serve over HTTPS; session cookies are marked `Secure` when `APP_URL` is https.
Route timeouts: the cron route declares `maxDuration = 60`, and campaign start
and CSV import declare `300`.

---

## 13. Troubleshooting

| Symptom | Fix |
|---|---|
| Emails stay **PENDING** | No worker is running. Start `npm run worker`, configure cron, or click **Process queue now**. Also check whether the campaign is paused or scheduled, and whether the daily limit has been reached. |
| "Sending halted: …" / campaigns auto-paused | Resend rejected the API key, the sender domain, or your Resend quota. Fix it, click **Test Resend Connection** (which clears the halt), then **Resume**. |
| 403 "You can only send testing emails to your own email address" | Verify your domain in Resend and set `FROM_EMAIL` on it. |
| "Missing personalization: {{first_name}}" skips | Add `{{first_name\|there}}`, or change the missing-variable behavior to Fallback or Remove. |
| "Unknown variable(s)" when starting | The template uses a variable that isn't in any imported column. Check the spelling in the variable picker. |
| `FAILED` with `unknown_outcome` | A send was interrupted and could not be safely retried. Check the Resend dashboard before retrying manually. |
| Cron returns 401 / 503 | Wrong or missing `CRON_SECRET`. |
| Login says "not configured" | Set `ADMIN_PASSWORD` and `SESSION_SECRET` (16+ characters). |
| `relation does not exist` | Run `npx prisma migrate deploy` with the same `DATABASE_URL`, including `?schema=`. |
| Import says malformed rows | A field contains an unquoted comma. Quote it or re-export the CSV. |

---

## 14. Security notes

- All Resend calls are server-side, in `src/lib/email/resend.ts` only. Secrets
  are read only in `src/lib/server/env.ts` and never sent to the client. The
  Settings page shows a masked key hint (`re_…abcd`).
- `.env` is git-ignored (so is lead CSV data in the project root). Only
  `.env.example` with placeholders is committed.
- **Auth:** a single admin password gives an HMAC-signed, `HttpOnly`,
  `SameSite=Lax` session cookie that lasts 7 days. `src/proxy.ts` protects
  every page and API route except login, unsubscribe and cron. Cron uses a
  bearer secret; unsubscribe uses an HMAC token per email.
- **CSRF:** mutating API calls require `X-Requested-With: mail` and a same-site
  `Origin`.
- **Validation:** zod on every API input, Prisma for queries, and raw SQL only
  via tagged templates with a validated schema name. CSV uploads are capped at
  10 MB.
- **Rate limits:** API 600/min per IP, login 10/min, unsubscribe 30/min, test
  emails 30/hour. These are in-memory per instance; add a platform WAF for
  public deployments.
- **Quota and duplicates:** atomic DB quota, unique `(campaign, lead)` and
  `(campaign, email)`, fencing tokens, idempotency keys. Leads with send
  history can't be deleted (suppress them instead), so the audit trail and
  duplicate protection stay intact.
- **Headers:** `X-Frame-Options: DENY`, `nosniff`, a strict `Referrer-Policy`,
  and `Permissions-Policy`.

---

## 15. Testing

```bash
npm test                  # unit: CSV, personalization, error classification, tokens…
npm run test:integration  # real Postgres (TEST_DATABASE_URL, separate schema):
                          # quota 0/99/100/101, concurrent workers, duplicates,
                          # retries, pause/resume/stop, recovery, suppression…
```
