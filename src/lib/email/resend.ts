// The only module that talks to Resend. Server-side only — never import from
// client components.
import { Resend, type CreateEmailRequestOptions } from "resend";
import { env } from "@/lib/server/env";
import type { SendErrorInfo } from "./errors";

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
  /** Sent as the Idempotency-Key header; Resend dedupes the same key for 24h. */
  idempotencyKey?: string;
}

export type SendResult = { ok: true; id: string } | { ok: false; error: SendErrorInfo };

/** Pluggable transport so tests can run the real queue without Resend. */
export interface EmailTransport {
  send(email: OutgoingEmail): Promise<SendResult>;
  /** `fromEmail`: the effective sender, checked against verified domains. */
  testConnection(fromEmail?: string): Promise<{ ok: boolean; message: string }>;
}

const SEND_TIMEOUT_MS = 20_000;

let client: Resend | null = null;
let clientKey = "";
function getClient(): Resend {
  const key = env.resendApiKey;
  if (!key) throw new Error("RESEND_API_KEY is not configured.");
  if (!client || clientKey !== key) {
    client = new Resend(key);
    clientKey = key;
  }
  return client;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export const resendTransport: EmailTransport = {
  async send(email) {
    if (!env.resendApiKey) {
      return { ok: false, error: { code: "missing_api_key", message: "RESEND_API_KEY is not configured.", statusCode: null } };
    }
    try {
      const res = await withTimeout(
        getClient().emails.send(
          {
            from: email.from,
            to: email.to,
            subject: email.subject,
            text: email.text,
            html: email.html,
            ...(email.replyTo ? { replyTo: email.replyTo } : {}),
            ...(email.headers ? { headers: email.headers } : {}),
            ...(email.tags ? { tags: email.tags } : {}),
          },
          // The SDK spreads request options into fetch(), so the signal really
          // aborts the HTTP request (a timed-out request can't linger and later
          // collide with the retry's idempotency key).
          {
            ...(email.idempotencyKey ? { idempotencyKey: email.idempotencyKey } : {}),
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
          } as CreateEmailRequestOptions,
        ),
        SEND_TIMEOUT_MS + 2_000,
      );
      if (res === "timeout") {
        return { ok: false, error: { code: "timeout", message: `Resend did not respond within ${SEND_TIMEOUT_MS / 1000}s.`, statusCode: null } };
      }
      if (res.error) {
        return {
          ok: false,
          error: { code: res.error.name ?? "application_error", message: res.error.message ?? "Unknown Resend error", statusCode: res.error.statusCode ?? null },
        };
      }
      if (!res.data?.id) {
        return { ok: false, error: { code: "application_error", message: "Resend returned no message id.", statusCode: null } };
      }
      return { ok: true, id: res.data.id };
    } catch (e) {
      return { ok: false, error: { code: "network_error", message: e instanceof Error ? e.message : String(e), statusCode: null } };
    }
  },

  /** Authenticates without sending anything (lists domains). */
  async testConnection(fromEmail?: string) {
    if (!env.resendApiKey) return { ok: false, message: "RESEND_API_KEY is not set on the server." };
    try {
      const res = await withTimeout(getClient().domains.list(), 15_000);
      if (res === "timeout") return { ok: false, message: "Resend did not respond (timeout)." };
      if (!res.error) {
        const domains = (res.data?.data ?? []) as { name: string; status: string }[];
        const verified = domains.filter((d) => d.status === "verified").map((d) => d.name);
        const from = (fromEmail || env.fromEmail).split("@")[1]?.toLowerCase();
        let msg = `Connected ✓ — ${domains.length} domain(s)${verified.length ? `, verified: ${verified.join(", ")}` : ", none verified yet"}.`;
        if (from && domains.length && !verified.includes(from)) msg += ` Warning: FROM_EMAIL domain "${from}" is not a verified domain.`;
        return { ok: true, message: msg };
      }
      // A send-only key cannot list domains but IS authenticated.
      if (res.error.name === "restricted_api_key") {
        return { ok: true, message: "Connected ✓ — API key is valid (sending-only key; domain list not available)." };
      }
      return { ok: false, message: `Connection failed: ${res.error.message} (${res.error.name})` };
    } catch (e) {
      return { ok: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

let transport: EmailTransport = resendTransport;
export function getTransport(): EmailTransport {
  return transport;
}
/** Test hook. */
export function setTransport(t: EmailTransport | null) {
  transport = t ?? resendTransport;
}

/** Convenience used by services: sendEmail() through the active transport. */
export function sendEmail(email: OutgoingEmail): Promise<SendResult> {
  return transport.send(email);
}
