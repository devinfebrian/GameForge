import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

function isAdminPath(pathname: string): boolean {
  return (
    pathname.startsWith("/admin") || pathname.startsWith("/api/admin")
  );
}

export async function proxy(request: NextRequest) {
  const { response, identity } = await updateSession(request);

  if (!isAdminPath(request.nextUrl.pathname)) {
    return response;
  }

  if (identity !== null) {
    return response;
  }

  // Optimistic only. Authorization is enforced in lib/dal.ts.
  for (const cookie of response.cookies.getAll()) {
    request.cookies.set(cookie);
  }

  if (request.nextUrl.pathname.startsWith("/api/admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);

  const redirectResponse = NextResponse.redirect(loginUrl);

  for (const cookie of response.cookies.getAll()) {
    redirectResponse.cookies.set(cookie);
  }

  return redirectResponse;
}

export const config = {
  matcher: [
    /*
     * Session refresh must run on every route so expired tokens are renewed
     * (Server Components cannot write cookies). Static assets and images are
     * excluded. No database access happens here.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
