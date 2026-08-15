import { NextResponse } from "next/server";

/**
 * POST /api/store-ops/ai-note-summary
 * Retired — unbounded S Pen canvas synthesis (≤8MB) is no longer available.
 * Canonical owner: Executive Floor Pad Copilot (`extractTasksAndTag`).
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Retired — use Executive Floor Pad Copilot (extractTasksAndTag). Unbounded canvas synthesis is no longer available.",
      retired: true,
    },
    { status: 410 }
  );
}
