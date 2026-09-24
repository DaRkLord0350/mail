import { NextResponse } from "next/server";
import { google } from "googleapis";
import { env } from "@/lib/server/env";
import { handler } from "@/lib/server/http";

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

function client() {
  if (!env.googleClientId || !env.googleClientSecret || !env.googleRedirectUri) {
    throw new Error("Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI first.");
  }
  return new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, env.googleRedirectUri);
}

export const GET = handler(async () => {
  const oauth = client();
  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GMAIL_SEND_SCOPE],
    include_granted_scopes: true,
  });
  return NextResponse.redirect(url);
});
