import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "@/lib/env/public";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/validation/redirect";

export async function GET(request: NextRequest) {
  const { appOrigin } = getPublicEnv();
  const code = request.nextUrl.searchParams.get("code");
  const next = safeRedirectPath(request.nextUrl.searchParams.get("next"));

  if (code === null) {
    return NextResponse.redirect(new URL("/login?error=missing_code", appOrigin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error !== null) {
    return NextResponse.redirect(new URL("/login?error=auth_failed", appOrigin));
  }

  return NextResponse.redirect(new URL(next, appOrigin));
}
