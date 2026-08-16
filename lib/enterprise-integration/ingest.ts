/**
 * Enterprise ingest HTTP transport — JSON + Zod safeParse only.
 * Does not persist and does not compose Store Ops owners.
 */

import { NextResponse } from "next/server";
import type { z } from "zod";
import { enterpriseBadRequestBody } from "@/src/types/enterpriseIntegration";

const INVALID_JSON_ISSUE = {
  code: "invalid_json",
  message: "Request body must be valid JSON",
  path: [] as PropertyKey[],
};

export async function parseEnterprisePayload<T extends z.ZodType>(
  request: Request,
  schema: T
): Promise<
  | { ok: true; data: z.infer<T> }
  | { ok: false; response: NextResponse }
> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(enterpriseBadRequestBody([INVALID_JSON_ISSUE]), {
        status: 400,
      }),
    };
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        enterpriseBadRequestBody(parsed.error.issues),
        { status: 400 }
      ),
    };
  }

  return { ok: true, data: parsed.data };
}
