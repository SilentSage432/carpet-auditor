import { NextResponse } from "next/server";
import {
  HUB_GATE_COOKIE,
  hubGateCookieOptions,
  mintHubGateToken,
} from "@/lib/auth-gate";
import { getRequestAuthUser } from "@/lib/supabase/server";
import { readableError } from "@/lib/store-ops/errors";

/**
 * POST /api/auth/gate — mint HTTP-only hub session cookie after a live Auth JWT.
 * DELETE /api/auth/gate — clear the cookie on logout.
 */
export async function POST(request: Request) {
  try {
    const auth = await getRequestAuthUser(request);
    if (!auth?.user) {
      return NextResponse.json(
        { error: "Sign in required to open a hub session" },
        { status: 401 }
      );
    }

    const specialistId =
      String(auth.user.app_metadata?.specialist_id ?? "").trim() ||
      String(auth.user.user_metadata?.specialist_id ?? "").trim() ||
      String(auth.user.id);

    const token = await mintHubGateToken(specialistId);
    if (!token) {
      return NextResponse.json(
        { error: "Hub gate secret is not configured" },
        { status: 503 }
      );
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(HUB_GATE_COOKIE, token, hubGateCookieOptions());
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: readableError(err, "Could not establish hub session") },
      { status: 400 }
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(HUB_GATE_COOKIE, "", {
    ...hubGateCookieOptions(),
    maxAge: 0,
  });
  return response;
}
