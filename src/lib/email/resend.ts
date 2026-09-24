// Gmail API transport. Server-side only — never import from client components.
import { google } from "googleapis";
import type { SendErrorInfo } from "./errors";
import { env } from "@/lib/server/env";

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
  idempotencyKey?: string;
}

export type SendResult = { ok: true; id: string } | { ok: false; error: SendErrorInfo };
export interface EmailTransport {
  send(email: OutgoingEmail): Promise<SendResult>;
  testConnection(fromEmail?: string): Promise<{ ok: boolean; message: string }>;
}

const SEND_TIMEOUT_MS = 20_000;

function oauthClient() {
  if (!env.googleClientId || !env.googleClientSecret || !env.googleRedirectUri) {
    throw new Error("Google Gmail OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.");
  }
  return new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, env.googleRedirectUri);
}

function toBase64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeHeader(value: string): string {
  return /^[\x00-\x7F]*$/.test(value) ? value : "=?UTF-8?B?" + Buffer.from(value, "utf8").toString("base64") + "?=";
}

function buildRaw(email: OutgoingEmail): string {
  const headers = [
    "From: " + email.from,
    "To: " + email.to,
    "Subject: " + encodeHeader(email.subject),
    email.replyTo ? "Reply-To: " + email.replyTo : "",
    email.headers?.["List-Unsubscribe"] ? "List-Unsubscribe: " + email.headers["List-Unsubscribe"] : "",
    email.headers?.["List-Unsubscribe-Post"] ? "List-Unsubscribe-Post: " + email.headers["List-Unsubscribe-Post"] : "",
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
  ].filter(Boolean).join("\r\n");
  const html = email.html || email.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  return toBase64Url(Buffer.from(headers + "\r\n\r\n" + html, "utf8"));
}

function getAuthorizedClient() {
  if (!env.googleRefreshToken) {
    throw new Error("GOOGLE_REFRESH_TOKEN is not configured. Complete the OAuth flow and store the refresh token in the server environment.");
  }
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: env.googleRefreshToken });
  return auth;
}

export const gmailTransport: EmailTransport = {
  async send(email) {
    try {
      const auth = getAuthorizedClient();
      const gmail = google.gmail({ version: "v1", auth });
      const result = await Promise.race([
        gmail.users.messages.send({ userId: "me", requestBody: { raw: buildRaw(email) } }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Gmail API timeout")), SEND_TIMEOUT_MS)),
      ]);
      const id = result.data.id;
      if (!id) {
        return { ok: false, error: { code: "application_error", message: "Gmail API returned no message id.", statusCode: null } };
      }
      return { ok: true, id };
    } catch (e) {
      const anyError = e as { code?: number; message?: string };
      const status = typeof anyError.code === "number" ? anyError.code : null;
      const message = e instanceof Error ? e.message : String(e);
      const code =
        status === 401 ? "invalid_access" :
        status === 403 ? "permission_denied" :
        status === 429 ? "rate_limit_exceeded" :
        message.includes("timeout") ? "timeout" : "network_error";
      return { ok: false, error: { code, message, statusCode: status } };
    }
  },
  async testConnection(fromEmail) {
    try {
      const auth = getAuthorizedClient();
      const gmail = google.gmail({ version: "v1", auth });
      const profile = await gmail.users.getProfile({ userId: "me" });
      const account = profile.data.emailAddress || fromEmail || env.fromEmail || "Gmail account";
      return { ok: true, message: "Connected ✓ — " + account + "." };
    } catch (e) {
      return { ok: false, message: "Gmail connection failed: " + (e instanceof Error ? e.message : String(e)) };
    }
  },
};

let transport: EmailTransport = gmailTransport;
export function getTransport(): EmailTransport { return transport; }
export function setTransport(t: EmailTransport | null) { transport = t ?? gmailTransport; }
export function sendEmail(email: OutgoingEmail): Promise<SendResult> { return transport.send(email); }
