import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  AUTH_VERIFICATION_ERROR_CODE,
  getAppOrigin,
  getSafeRedirectPath,
} from "@/lib/auth/redirects";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const appOrigin = getAppOrigin(requestUrl);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type") as EmailOtpType | null;
  const next = requestUrl.searchParams.get("next") ?? "/";
  const redirectTo = new URL(getSafeRedirectPath(next), appOrigin);
  const loginUrl = new URL("/login", appOrigin);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(redirectTo);
    }
  }

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });

    if (!error) {
      return NextResponse.redirect(redirectTo);
    }
  }

  loginUrl.searchParams.set("auth_error", AUTH_VERIFICATION_ERROR_CODE);
  return NextResponse.redirect(loginUrl);
}
