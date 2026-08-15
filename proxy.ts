import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  HUB_GATE_COOKIE,
  HUB_GATE_HEADER,
  isAuthGatePublicPath,
  isAuthGateStaticPath,
  safeInternalNext,
  verifyHubGateToken,
} from "@/lib/auth-gate";

/**
 * Next.js 16 Proxy — this is the auth middleware (middleware.ts is forbidden
 * in 16.2 when proxy.ts exists: https://nextjs.org/docs/messages/middleware-to-proxy).
 * Stealth + auth gate: unauthenticated HTML never reaches dashboard RSC.
 * Cron stays on CRON_SECRET. Hub JWT APIs may pass with Bearer.
 */

function withStealthHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Robots-Tag", HUB_GATE_HEADER);
  return response;
}

function loginRedirect(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  const next = safeInternalNext(`${url.pathname}${url.search}`);
  url.pathname = "/login";
  url.search = next ? `?next=${encodeURIComponent(next)}` : "";
  return withStealthHeaders(NextResponse.redirect(url));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isAuthGateStaticPath(pathname) || pathname.startsWith("/api/cron")) {
    return withStealthHeaders(NextResponse.next());
  }

  const gate = await verifyHubGateToken(
    request.cookies.get(HUB_GATE_COOKIE)?.value
  );
  const authed = Boolean(gate);
  const bearer = request.headers.get("authorization")?.startsWith("Bearer ");

  if (pathname.startsWith("/api/")) {
    if (isAuthGatePublicPath(pathname) || authed || bearer) {
      return withStealthHeaders(NextResponse.next());
    }
    return withStealthHeaders(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  if (isAuthGatePublicPath(pathname)) {
    return withStealthHeaders(NextResponse.next());
  }

  if (!authed) {
    return loginRedirect(request);
  }

  return withStealthHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    "/api/cron/:path*",
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest\\.json|manifest\\.webmanifest|robots\\.txt|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2)$).*)",
  ],
};
