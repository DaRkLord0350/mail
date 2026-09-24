import { NextResponse } from "next/server";
import { google } from "googleapis";
import { env } from "@/lib/server/env";

/**
 * Compatibility callback for projects that already configured
 * GOOGLE_REDIRECT_URI as /api/auth/google/callback.
 * The canonical Gmail OAuth route lives under /api/oauth/google.
 */
function client() {
  if (!env.googleClientId || !env.googleClientSecret || !env.googleRedirectUri) {
    throw new Error("Google OAuth is not configured.");
  }
  return new google.auth.OAuth2(
    env.googleClientId,
    env.googleClientSecret,
    env.googleRedirectUri,
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json(
      { ok: false, error: "Missing OAuth code" },
      { status: 400 },
    );
  }

  try {
    const oauth = client();
    const { tokens } = await oauth.getToken(code);

    if (!tokens.refresh_token) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Google did not return a refresh token. Revoke the app's access and authorize again with offline access.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      message:
        "OAuth complete. Copy refreshToken into GOOGLE_REFRESH_TOKEN in .env, restart the server, then test Gmail API connection.",
      refreshToken: tokens.refresh_token,
      account: env.fromEmail,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
