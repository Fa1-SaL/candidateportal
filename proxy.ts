import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { fixturePreviewEnabled } from "@/lib/portal/preview";
import { containsAuthParameters, getAppOrigin, getSafeRedirectPath } from "@/lib/auth/redirects";
import { privateAuthRedirect } from "@/lib/auth/response";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/preview") {
    if (fixturePreviewEnabled()) return NextResponse.next();
    // Deny before the root loading boundary can commit a streamed HTTP 200.
    return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
  if (request.nextUrl.pathname === "/" && containsAuthParameters([...request.nextUrl.searchParams.keys()])) {
    return privateAuthRedirect(new URL(getSafeRedirectPath("/" + request.nextUrl.search), getAppOrigin(request.nextUrl)));
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
