import { NextResponse } from "next/server";
import {
  parseStoreOpsActor,
  requireSuperAdmin,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth";
import {
  generateWeeklyRotations,
  resolveDepartmentIdByCode,
} from "@/lib/store-ops/rotations";
import { getSupabaseAdmin } from "@/lib/store-ops/supabase-admin";

/**
 * POST /api/rotations/generate
 * Body: { department_id: uuid, count: number }
 * Super admin only — picks PENDING bays (auto cycle-reset when exhausted).
 */
export async function POST(request: Request) {
  try {
    requireSuperAdmin(parseStoreOpsActor(request));
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase is not configured" },
        { status: 503 }
      );
    }

    const body = (await request.json()) as {
      department_id?: string;
      department_code?: string;
      count?: number;
    };

    let departmentId = body.department_id?.trim() || "";
    if (!departmentId && body.department_code) {
      departmentId =
        (await resolveDepartmentIdByCode(supabase, body.department_code)) ?? "";
    }

    if (!departmentId) {
      return NextResponse.json(
        { error: "department_id is required" },
        { status: 400 }
      );
    }

    const count = Number(body.count);
    if (!Number.isFinite(count) || count < 1) {
      return NextResponse.json(
        { error: "count must be a positive integer" },
        { status: 400 }
      );
    }

    const result = await generateWeeklyRotations(
      supabase,
      departmentId,
      Math.floor(count)
    );

    return NextResponse.json({
      ...result,
      created: result.rotations.length,
    });
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 400 }
    );
  }
}
