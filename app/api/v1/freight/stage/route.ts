import { NextResponse } from "next/server";
import { parseEnterprisePayload } from "@/lib/enterprise-integration/ingest";
import { FreightStageEventSchema } from "@/src/types/enterpriseIntegration";

/**
 * POST /api/v1/freight/stage
 * Stub: validates FreightStageEventSchema. Does not queue Store Ops work.
 */
export async function POST(request: Request) {
  const parsed = await parseEnterprisePayload(
    request,
    FreightStageEventSchema
  );
  if (!parsed.ok) {
    return parsed.response;
  }

  return NextResponse.json({
    success: true,
    queued_items: parsed.data.staged_items.length,
  });
}
