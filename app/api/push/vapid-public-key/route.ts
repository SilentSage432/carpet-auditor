import { NextResponse } from "next/server";
import { getVapidPublicKey, isWebPushConfigured } from "@/lib/push/vapid";

/** GET /api/push/vapid-public-key — browser-safe VAPID public key. */
export async function GET() {
  const publicKey = getVapidPublicKey();
  if (!publicKey || !isWebPushConfigured()) {
    return NextResponse.json(
      {
        publicKey: null,
        error:
          "Web Push is not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.",
      },
      { status: 503 }
    );
  }
  return NextResponse.json({ publicKey });
}
