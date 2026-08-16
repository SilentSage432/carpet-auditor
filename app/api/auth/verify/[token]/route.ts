import { NextResponse } from "next/server";
import {
  AUTH_VERIFY_COOKIE,
  authVerifyCookieOptions,
  isInviteHarnessMode,
} from "@/lib/auth-token";
import {
  authTokenRowExpired,
  loadAuthTokenBySecret,
} from "@/lib/onboarding/load-invite";
import { consumeAuthToken, publicVerifyPreview } from "@/lib/onboarding/redeem-token";
import { readableError } from "@/lib/store-ops/errors";

type Ctx = { params: Promise<{ token: string }> };

/**
 * GET /api/auth/verify/[token]
 * Validates the one-time token, consumes it immediately, and sets a short-lived
 * HttpOnly cookie so PIN setup cannot replay the URL.
 */
export async function GET(request: Request, ctx: Ctx) {
  const { token: raw } = await ctx.params;
  const token = decodeURIComponent(raw || "").trim();
  const loaded = await loadAuthTokenBySecret(token);
  if (!loaded.ok) return loaded.response;

  if (authTokenRowExpired(loaded.loaded.row)) {
    return NextResponse.json(
      { error: "This link has expired. Ask Master Admin to resend." },
      { status: 410 }
    );
  }

  const testFlag = new URL(request.url).searchParams.get("test");
  const harness = isInviteHarnessMode(testFlag);

  if (harness) {
    return NextResponse.json({
      ok: true,
      invite: publicVerifyPreview(loaded.loaded.row),
      test_mode: true,
    });
  }

  try {
    const { preview, cookie } = await consumeAuthToken(
      loaded.loaded.supabase,
      loaded.loaded.row
    );
    const response = NextResponse.json({
      ok: true,
      invite: preview,
      test_mode: false,
    });
    response.cookies.set(AUTH_VERIFY_COOKIE, cookie, authVerifyCookieOptions());
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: readableError(err, "Could not start PIN setup") },
      { status: 500 }
    );
  }
}
