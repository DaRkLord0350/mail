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

    // The refresh token is NOT written to source code or the database.
    // For this single-account deployment, copy it into GOOGLE_REFRESH_TOKEN in the host environment.
    return NextResponse.json({
      ok: true,
      message: "OAuth completed. Copy this one-time refresh token into GOOGLE_REFRESH_TOKEN on the server, then remove this callback route or protect it before public deployment.",
      refreshToken: tokens.refresh_token,
      emailHint: env.fromEmail,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
