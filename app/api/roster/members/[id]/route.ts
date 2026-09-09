import { NextResponse } from "next/server";
import {
  resolveStoreOpsActor,
  requireSupervisorOrAdmin,
  requireStoreOpsActor,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import {
  isUniqueViolationError,
  readableError,
} from "@/lib/store-ops/errors";
import { requireSupabaseAdmin } from "@/lib/supabase/admin-response";
import { normalizePhoneE164 } from "@/lib/phone";
import { parseRosterFloorTitle } from "@/lib/types";

/**
 * PATCH /api/roster/members/[id]
 * Correct an existing member's workforce details in place.
 *
 * Workforce description only. Authority — role, accessible_departments, PIN,
 * tokens, auth identity — is governed elsewhere and is rejected here.
 * Home department is deliberately absent: moving it has an unresolved
 * interaction with accessible_departments (ROSTER-EDIT-001 report).
 *
 * Updates by immutable id + store_number. Never upserts on name, so a rename
 * corrects the existing row instead of creating a second member.
 */

const EDITABLE_FIELDS = ["name", "phone", "floor_title"] as const;

type PatchBody = {
  name?: unknown;
  phone?: unknown;
  floor_title?: unknown;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = requireSupervisorOrAdmin(
      requireStoreOpsActor(await resolveStoreOpsActor(request))
    );
    const { supabase, response } = requireSupabaseAdmin();
    if (!supabase) return response;

    const { id } = await context.params;
    const memberId = String(id ?? "").trim();
    if (!memberId) {
      return NextResponse.json({ error: "member id is required" }, { status: 400 });
    }

    const body = (await request.json()) as PatchBody;

    // Authority-sensitive keys are refused outright rather than ignored, so a
    // caller can never believe an escalation was accepted.
    const unsupported = Object.keys(body ?? {}).filter(
      (key) => !(EDITABLE_FIELDS as readonly string[]).includes(key)
    );
    if (unsupported.length > 0) {
      return NextResponse.json(
        {
          error: `Unsupported field(s): ${unsupported.join(", ")}. This route edits workforce details only.`,
        },
        { status: 400 }
      );
    }

    // Store scope comes from the actor, never from the request body.
    const { data: member, error: fetchError } = await supabase
      .from("store_specialists")
      .select("id, role, store_number, name, phone_number, floor_title")
      .eq("id", memberId)
      .eq("store_number", actor.storeNumber)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json(
        { error: readableError(fetchError, "Could not load roster member") },
        { status: 500 }
      );
    }
    if (!member) {
      return NextResponse.json({ error: "Roster member not found" }, { status: 404 });
    }

    const targetRole = String(member.role ?? "");
    if (targetRole === "MasterAdmin") {
      return NextResponse.json(
        { error: "Master Admin details cannot be edited here" },
        { status: 403 }
      );
    }
    if (actor.role === "department_supervisor" && targetRole !== "Associate") {
      return NextResponse.json(
        { error: "Supervisors may only edit associates" },
        { status: 403 }
      );
    }

    const patch: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = String(body.name ?? "").trim();
      if (!name) {
        return NextResponse.json({ error: "Enter a name" }, { status: 400 });
      }
      patch.name = name;
    }

    if (body.phone !== undefined) {
      const raw = String(body.phone ?? "").trim();
      if (!raw) {
        patch.phone_number = null;
      } else {
        const phone = normalizePhoneE164(raw);
        if (!phone) {
          return NextResponse.json(
            { error: "Enter a valid phone number" },
            { status: 400 }
          );
        }
        patch.phone_number = phone;
      }
    }

    if (body.floor_title !== undefined) {
      /**
       * Job title exists for associates only — resolveRosterJobSave stores null
       * for Supervisor and MasterAdmin. Honour that rather than inventing a
       * state the create flow cannot produce, and never derive role from it.
       */
      if (targetRole !== "Associate") {
        return NextResponse.json(
          { error: "Job title applies to associates only" },
          { status: 400 }
        );
      }
      const floorTitle = parseRosterFloorTitle(body.floor_title);
      if (!floorTitle) {
        return NextResponse.json(
          { error: "Unknown job title" },
          { status: 400 }
        );
      }
      patch.floor_title = floorTitle;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No changes supplied" }, { status: 400 });
    }

    const { error: updateError } = await supabase
      .from("store_specialists")
      .update(patch)
      .eq("id", memberId)
      .eq("store_number", actor.storeNumber);

    if (updateError) {
      if (isUniqueViolationError(updateError)) {
        return NextResponse.json(
          { error: "Another team member on this store already uses that name" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: readableError(updateError, "Could not save member details") },
        { status: 500 }
      );
    }

    // Truthful read-back — the caller is told what the row holds, not what it asked for.
    const { data: saved, error: readError } = await supabase
      .from("store_specialists")
      .select("*")
      .eq("id", memberId)
      .eq("store_number", actor.storeNumber)
      .maybeSingle();

    if (readError || !saved) {
      return NextResponse.json(
        {
          error: readableError(
            readError,
            "Saved, but the updated member could not be read back"
          ),
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, specialist: saved });
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
