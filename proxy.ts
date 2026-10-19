import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  HUB_GATE_COOKIE,
  HUB_GATE_HEADER,
  edgeAllowsRequest,
  isAuthGatePublicPath,
  isAuthGateStaticPath,
  isCronApiPath,
  safeInternalNext,
  verifyHubGateToken,
} from "@/lib/auth-gate";
import {
  PREVIEW_MUTATION_BLOCKED_MESSAGE,
  shouldBlockPreviewMutation,
} from "@/lib/preview-safety";

/**
 * Next.js 16 Proxy — auth middleware (middleware.ts is forbidden when proxy.ts exists).
 *
 * ALIGN-SEC-001 edge classification:
 * - Static / public HTML + `/api/auth/*` + `/api/invite/*` → allow
 * - `/api/cron/*` → allow at edge; handler requires CRON_SECRET
 * - All other HTML + `/api/*` → verified hub gate cookie only
 *
 * An arbitrary Authorization: Bearer header MUST NOT bypass the edge gate.
 * Passing the proxy does NOT authorize service-role handlers — each route
 * retains its own actor / JWT / secret checks.
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

  // Preview deployments share production Supabase — block writes/cron first.
  if (
    shouldBlockPreviewMutation({
      method: request.method,
      pathname,
    })
  ) {
    return withStealthHeaders(
      NextResponse.json(
        {
          error: PREVIEW_MUTATION_BLOCKED_MESSAGE,
          code: "preview_read_only",
        },
        { status: 403 }
      )
    );
  }

  if (isAuthGateStaticPath(pathname) || isCronApiPath(pathname)) {
    return withStealthHeaders(NextResponse.next());
  }

  const gateCookie = request.cookies.get(HUB_GATE_COOKIE)?.value;
  const allowed = await edgeAllowsRequest({ pathname, gateCookie });

  if (pathname.startsWith("/api/")) {
    if (allowed) {
      return withStealthHeaders(NextResponse.next());
    }
    return withStealthHeaders(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  if (isAuthGatePublicPath(pathname)) {
    return withStealthHeaders(NextResponse.next());
  }

  const gate = await verifyHubGateToken(gateCookie);
  if (!gate) {
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
