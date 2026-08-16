import { NextResponse } from "next/server";
import { parseEnterprisePayload } from "@/lib/enterprise-integration/ingest";
import { BayTopologyIngestSchema } from "@/src/types/enterpriseIntegration";

/**
 * POST /api/v1/topology/ingest
 * Stub: validates BayTopologyIngestSchema. Does not write store_locations.
 */
export async function POST(request: Request) {
  const parsed = await parseEnterprisePayload(
    request,
    BayTopologyIngestSchema
  );
  if (!parsed.ok) {
    return parsed.response;
  }

  return NextResponse.json({
    success: true,
    processed_bays: 1,
  });
}
