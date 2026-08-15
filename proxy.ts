import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Next.js 16 Proxy (formerly middleware).
 * Cron routes authenticate with CRON_SECRET — never require a user session.
 *
 * Hub auth lives in localStorage (`lib/auth-session.ts`), so this proxy cannot
 * send signed-in users to /dashboard. Authenticated landing is owned by
 * `app/page.tsx` (replace to /dashboard unless `?section=` is a specialty scan).
 */
export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Vercel Cron + manual cron probes must reach the route handler as JSON.
  if (pathname.startsWith("/api/cron")) {
    return NextResponse.next();
  }

  // Preserve specialty scan deep links (`/?section=audit`). Do not rewrite `/`
  // here — unauthenticated visitors need the AuthWall on the hub page.
  if (pathname === "/" && searchParams.get("section")) {
    return NextResponse.next();
  }

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
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest\\.json|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
