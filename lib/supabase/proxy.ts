import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "@/lib/env/public";

export interface SessionIdentity {
  readonly userId: string;
}

export interface SessionRefresh {
  readonly response: NextResponse;
  readonly identity: SessionIdentity | null;
}

export async function updateSession(
  request: NextRequest,
): Promise<SessionRefresh> {
  let response = NextResponse.next({ request });
  const { supabaseUrl, supabasePublishableKey } = getPublicEnv();

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();

  if (error !== null || data === null) {
    return { response, identity: null };
  }

  const subject = data.claims?.sub;

  if (typeof subject !== "string") {
    return { response, identity: null };
  }

  return { response, identity: { userId: subject } };
}
