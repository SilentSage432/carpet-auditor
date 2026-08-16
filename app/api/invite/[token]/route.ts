import { NextResponse } from "next/server";
import { isInviteHarnessMode } from "@/lib/auth-token";
import {
  authTokenRowExpired,
  loadAuthTokenBySecret,
} from "@/lib/onboarding/load-invite";
import { publicVerifyPreview } from "@/lib/onboarding/redeem-token";

type Ctx = { params: Promise<{ token: string }> };

/** GET /api/invite/[token] — legacy preview; activation is /auth/verify/[token]. */
export async function GET(request: Request, ctx: Ctx) {
  const { token: raw } = await ctx.params;
  const token = decodeURIComponent(raw || "").trim();
  const loaded = await loadAuthTokenBySecret(token);
  if (!loaded.ok) return loaded.response;

  const testFlag = new URL(request.url).searchParams.get("test");
  return NextResponse.json({
    invite: {
      ...publicVerifyPreview(loaded.loaded.row),
      expired: authTokenRowExpired(loaded.loaded.row),
      must_change_pin: true,
    },
    test_mode: isInviteHarnessMode(testFlag),
  });
}

/** POST /api/invite/[token] — PIN setup moved to POST /api/auth/verify. */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "PIN setup moved to /auth/verify/[token]. Open the SMS link to continue.",
    },
    { status: 410 }
  );
}
