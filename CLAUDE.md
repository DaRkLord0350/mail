@AGENTS.md

# MAIL — project notes

Standalone cold-email outreach app (Next.js 16 App Router, Prisma 6, Postgres, Resend). See README.md.

- `src/proxy.ts` is Next 16's renamed middleware (auth, CSRF header check, rate limits).
- Server code lives in `src/lib/server/**` + `src/lib/email/**`; client code must only import `src/lib/types.ts`, `src/lib/client/**`, and pure modules (`src/lib/template/render.ts`, `src/lib/csv/parse.ts`, `src/lib/email-address.ts`).
- The send path is `src/lib/server/worker.ts`: pacing gate + claim (FOR UPDATE SKIP LOCKED) + quota reservation happen in ONE transaction; finalize writes are fenced by `lockToken`; Resend idempotency keys survive crash recovery. Don't split these apart.
- Raw SQL must use `t("Table")` from `src/lib/server/sql.ts` (schema-qualified; schema comes from `?schema=` in DATABASE_URL).
- API contract: `docs/API.md`; DTOs: `src/lib/types.ts`.
- Tests: `npm test` (unit), `npm run test:integration` (uses TEST_DATABASE_URL, schema `mail_test` — never the real `mail` schema).
