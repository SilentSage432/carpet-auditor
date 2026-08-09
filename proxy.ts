import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Next.js 16 Proxy (formerly middleware).
 * Cron routes authenticate with CRON_SECRET — never require a user session.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Vercel Cron + manual cron probes must reach the route handler as JSON.
  if (pathname.startsWith("/api/cron")) {
    return NextResponse.next();
  }

  // All other matched paths pass through (no session gate here).
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match app paths, but skip static assets.
     * Explicitly include /api/cron so the bypass above always runs if matched,
     * and exclude other /api/* from unnecessary proxy work where possible.
     */
    "/api/cron/:path*",
    "/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
