import { NextResponse } from "next/server";
import { google } from "googleapis";
import { env } from "@/lib/server/env";

function client() {
  if (!env.googleClientId || !env.googleClientSecret || !env.googleRedirectUri) {
    throw new Error("Google OAuth is not configured.");
  }
  return new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, env.googleRedirectUri);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (error) return NextResponse.json({ ok: false, error }, { status: 400 });
  if (!code) return NextResponse.json({ ok: false, error: "Missing OAuth code" }, { status: 400 });

  try {
    const oauth = client();
    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token) {
      return NextResponse.json(
        { ok: false, error: "Google did not return a refresh token. Revoke the app access and authorize again." },
        { status: 400 },
      );
    }

    // For this single-account setup, the callback returns a one-time bootstrap
    // value only after the user explicitly authorizes the Gmail account.
    // Do not log or commit this value. Put it in the server environment as
    // GOOGLE_REFRESH_TOKEN and then remove/disable this bootstrap route.
    return NextResponse.json({
      ok: true,
      message: "OAuth complete. Copy refreshToken into GOOGLE_REFRESH_TOKEN on the server, then disable this bootstrap route before public use.",
      refreshToken: tokens.refresh_token,
      account: env.fromEmail,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
