/**
 * DEPTSYNC-ROTATION-AUTO-003 — post-publication / weekly plan visibility.
 *
 * Pure composition from staged rotations + assignment rows.
 * Does not claim Zebra entry or Orient completion.
 */

export type WeekPublicationBayState =
  | "assigned"
  | "unfilled"
  | "supervisor_edited"
  | "supervisor_held_clear"
  | "failed_unassigned"
  | "zebra_handoff_required"
  | "completed";

export type WeekPublicationBayRow = {
  rotation_id: string;
  aisle: string;
  bay: number;
  state: WeekPublicationBayState;
  owner_specialist_id: string | null;
  owner_name: string | null;
  supervisor_locked: boolean;
  zebra_entered: boolean;
  is_completed: boolean;
};

export type WeekPublicationVisibility = {
  week_label: string;
  staged_total: number;
  assigned_total: number;
  unfilled_total: number;
  supervisor_edited_total: number;
  supervisor_held_clear_total: number;
  zebra_handoff_required_total: number;
  completed_total: number;
  approved_capacity_total: number | null;
  shortfall_notes: string[];
  rows: WeekPublicationBayRow[];
};

export type WeekPublicationAssignmentEvidence = {
  bay_id: string;
  roster_specialist_id?: string | null;
  assigned_specialist_id?: string | null;
  specialist_name?: string | null;
  status?: string | null;
  supervisor_locked?: boolean | null;
  zebra_entered_at?: string | null;
};

export type WeekPublicationStagedBay = {
  id: string;
  aisle: string;
  bay: number;
  is_completed?: boolean | null;
};

function isOwned(row: WeekPublicationAssignmentEvidence | null | undefined): boolean {
  if (!row) return false;
  const status = String(row.status ?? "").trim().toLowerCase();
  if (status === "cleared") return false;
  return Boolean(
    String(row.roster_specialist_id ?? "").trim() ||
      String(row.assigned_specialist_id ?? "").trim()
  );
}

/**
 * Compose honest weekly plan visibility after stage and/or publish.
 */
export function composeWeekPublicationVisibility(input: {
  week_label: string;
  staged: readonly WeekPublicationStagedBay[];
  assignmentsByBayId: ReadonlyMap<string, WeekPublicationAssignmentEvidence>;
  approved_capacity_total?: number | null;
  shortfall_notes?: readonly string[];
}): WeekPublicationVisibility {
  const rows: WeekPublicationBayRow[] = [];
  let assigned = 0;
  let unfilled = 0;
  let edited = 0;
  let heldClear = 0;
  let zebraNeeded = 0;
  let completed = 0;

  for (const bay of input.staged) {
    const id = String(bay.id).trim();
    const a = input.assignmentsByBayId.get(id) ?? null;
    const locked = a?.supervisor_locked === true;
    const owned = isOwned(a);
    const status = String(a?.status ?? "").trim().toLowerCase();
    const zebraEntered = Boolean(a?.zebra_entered_at);
    const isCompleted = bay.is_completed === true || status === "completed";

    let state: WeekPublicationBayState;
    if (isCompleted) {
      state = "completed";
      completed += 1;
    } else if (locked && !owned) {
      state = "supervisor_held_clear";
      heldClear += 1;
      unfilled += 1;
    } else if (locked && owned) {
      state = "supervisor_edited";
      edited += 1;
      assigned += 1;
      if (!zebraEntered) zebraNeeded += 1;
    } else if (owned) {
      state = zebraEntered ? "assigned" : "zebra_handoff_required";
      assigned += 1;
      if (!zebraEntered) {
        zebraNeeded += 1;
        // keep primary state as zebra_handoff_required for outstanding handoff
        state = "zebra_handoff_required";
      }
    } else {
      state = "failed_unassigned";
      unfilled += 1;
    }

    rows.push({
      rotation_id: id,
      aisle: String(bay.aisle ?? ""),
      bay: Number(bay.bay) || 0,
      state,
      owner_specialist_id: owned
        ? String(a?.roster_specialist_id || a?.assigned_specialist_id || "").trim() ||
          null
        : null,
      owner_name: owned
        ? String(a?.specialist_name ?? "").trim() || null
        : null,
      supervisor_locked: locked,
      zebra_entered: zebraEntered,
      is_completed: isCompleted,
    });
  }

  rows.sort((x, y) =>
    `${x.aisle}|${x.bay}`.localeCompare(`${y.aisle}|${y.bay}`, undefined, {
      numeric: true,
    })
  );

  return {
    week_label: input.week_label,
    staged_total: input.staged.length,
    assigned_total: assigned,
    unfilled_total: unfilled,
    supervisor_edited_total: edited,
    supervisor_held_clear_total: heldClear,
    zebra_handoff_required_total: zebraNeeded,
    completed_total: completed,
    approved_capacity_total:
      input.approved_capacity_total == null
        ? null
        : Math.max(0, Math.floor(input.approved_capacity_total)),
    shortfall_notes: [...(input.shortfall_notes ?? [])],
    rows,
  };
}
