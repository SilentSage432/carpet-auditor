"use client";

/**
 * Floor destination bridge for Executive Floor Pad open intent (UX-004C.1).
 *
 * Source navigates with durable `?open=executive-floor-pad` (or legacy hash).
 * This bridge consumes only when the Floor route is active AND intent is present.
 * Keep-alive mount alone is insufficient — pathname must be `/dashboard`.
 *
 * Rendered AFTER ShiftAnalyticsDrawer / TacticalVoiceFloorPad so their
 * event listeners register before this effect can dispatch (child/sibling
 * effect order: listeners first, then this bridge).
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  EXECUTIVE_FLOOR_PAD_BARE_HREF,
  EXECUTIVE_FLOOR_PAD_OPEN_EVENT,
  isExecutiveFloorPadFloorPath,
  isExecutiveFloorPadHash,
  isExecutiveFloorPadOpenIntent,
  syncExecutiveFloorPadIntentConsumedUrl,
} from "@/lib/specialty-tools";

export function ExecutiveFloorPadIntentBridge() {
  const pathname = usePathname() || "";
  const searchParams = useSearchParams();
  const router = useRouter();
  const lastConsumedKey = useRef<string | null>(null);

  useEffect(() => {
    // Keep-alive Floor stays mounted while Settings/Map are active; pathname
    // is the activation gate — inert mount must not consume.
    if (!isExecutiveFloorPadFloorPath(pathname)) return;

    const hash =
      typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    const fromQuery = isExecutiveFloorPadOpenIntent(searchParams);
    const fromHash = isExecutiveFloorPadHash(hash);
    if (!fromQuery && !fromHash) {
      lastConsumedKey.current = null;
      return;
    }

    // One dispatch for query, hash, or both — never double-dispatch.
    const key = fromQuery
      ? `query:${searchParams.get("open")}`
      : `hash:${hash}`;
    if (lastConsumedKey.current === key) return;
    lastConsumedKey.current = key;

    window.dispatchEvent(new CustomEvent(EXECUTIVE_FLOOR_PAD_OPEN_EVENT));
    // Normalize AFTER sync dispatch so listeners already received the event.
    syncExecutiveFloorPadIntentConsumedUrl(EXECUTIVE_FLOOR_PAD_BARE_HREF);
    router.replace(EXECUTIVE_FLOOR_PAD_BARE_HREF, { scroll: false });
  }, [pathname, searchParams, router]);

  return null;
}
