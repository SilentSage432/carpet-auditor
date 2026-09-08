/**
 * APP-SYNC-UX-001 — sync attention must be nameable and reachable.
 *
 * Field evidence: a red global banner read "3 items need supervisor attention"
 * during appliance work. The count is quarantined sync *operations*, not
 * merchandise, and the banner offered no route to inspect them.
 *
 * Product requirement: if DeptSync says something needs supervisor attention, the
 * supervisor must be able to see what it is and what they can do about it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { syncActionSubject } from "@/lib/sync-conflict";
import {
  SYNC_QUEUE_INSPECT_HREF,
  type SyncAction,
  type SyncActionType,
} from "@/lib/sync-queue";

function readRepo(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function action(
  type: SyncActionType,
  payload: Record<string, unknown>
): Pick<SyncAction, "type" | "payload"> {
  return { type, payload };
}

function values(fields: { label: string; value: string }[]): string[] {
  return fields.map((f) => f.value);
}

function labelled(
  fields: { label: string; value: string }[],
  label: string
): string | undefined {
  return fields.find((f) => f.label === label)?.value;
}

describe("APP-SYNC-UX-001 attention copy", () => {
  const banner = readRepo("components/hub/OfflineNetworkBanner.tsx");

  it("blocked operations are called sync issues, never items", () => {
    expect(banner).toContain("sync issue");
    expect(banner).not.toMatch(/sync item/);
    expect(banner).not.toMatch(/\$\{state\.quarantined\} item/);
  });

  it("singular and plural attention copy both exist", () => {
    expect(banner).toMatch(
      /sync issue\$\{state\.quarantined === 1 \? "" : "s"\} need attention/
    );
  });

  it("attention no longer only tells the supervisor to open Settings", () => {
    expect(banner).not.toContain("— open Settings");
  });
});

describe("APP-SYNC-UX-001 attention is actionable", () => {
  const banner = readRepo("components/hub/OfflineNetworkBanner.tsx");
  const settings = readRepo("components/sections/SettingsSection.tsx");

  it("attention renders an activatable control, other states do not", () => {
    expect(banner).toContain('data-testid="sync-attention-banner"');
    expect(banner).toMatch(/attention \?[\s\S]{0,400}<button/);
    expect(banner).toContain("Review");
  });

  it("the control navigates to the one canonical sync surface", () => {
    expect(banner).toContain("SYNC_QUEUE_INSPECT_HREF");
    expect(banner).toContain("router.push(SYNC_QUEUE_INSPECT_HREF)");
    expect(SYNC_QUEUE_INSPECT_HREF).toBe("/settings#sync-queue");
  });

  it("Settings opens the queue accordion for that destination", () => {
    expect(settings).toContain('hash === "sync-queue"');
    expect(settings).toContain('setOpenSection("device")');
    expect(settings).toContain('id="sync-queue"');
    expect(settings).toContain("<SyncQueuePanel");
  });

  it("no second sync-management surface was introduced", () => {
    const panels = readRepo("components/settings/SyncQueuePanel.tsx");
    expect(panels).toContain("retryQuarantinedAction");
    expect(panels).toContain("discardQuarantinedAction");
    expect(banner).not.toContain("retryQuarantinedAction");
    expect(banner).not.toContain("discardQuarantinedAction");
  });

  it("Retry / Discard role safety is unchanged", () => {
    const panel = readRepo("components/settings/SyncQueuePanel.tsx");
    expect(panel).toMatch(/isSupervisor|isMasterAdmin/);
  });
});

describe("APP-SYNC-UX-001 queued operation subject identity", () => {
  it("appliance identifier shows Lowe's item # and the taught identifier", () => {
    const fields = syncActionSubject(
      action("upsert_appliance_catalog_identifier", {
        id: "8f1c9b2e-1111-4222-8333-444455556666",
        store_number: "2587",
        item_number: "1234567",
        identifier: "ESL9988776655",
      })
    );
    expect(labelled(fields, "Item #")).toBe("1234567");
    expect(labelled(fields, "Identifier")).toBe("ESL9988776655");
  });

  it("appliance scan shows item, location and audit membership", () => {
    const fields = syncActionSubject(
      action("upsert_appliance_scan", {
        item_number: "1234567",
        location: "Showroom Bay 4",
        bay_number: "4",
        audit_session_id: "8f1c9b2e-1111-4222-8333-444455556666",
      })
    );
    expect(labelled(fields, "Item #")).toBe("1234567");
    expect(labelled(fields, "Location")).toBe("Showroom Bay 4");
    expect(labelled(fields, "Part of")).toBe("Physical audit count");
  });

  it("downstock shows the human location context it actually has", () => {
    const fields = syncActionSubject(
      action("STORE_OPS_DOWNSTOCK_ADD", {
        location_id: "8f1c9b2e-1111-4222-8333-444455556666",
        note: "Two rolls blocking the pull",
        week: "2026-W37",
      })
    );
    expect(labelled(fields, "Note")).toBe("Two rolls blocking the pull");
    expect(labelled(fields, "Week")).toBe("2026-W37");
  });

  it("rotation shows aisle / bay when the payload carries them", () => {
    const fields = syncActionSubject(
      action("STORE_OPS_COMPLETE_ROTATION", {
        aisle: "12",
        bay_number: "3",
        completed_by: "Tyson",
      })
    );
    expect(labelled(fields, "Aisle")).toBe("12");
    expect(labelled(fields, "Bay")).toBe("3");
    expect(labelled(fields, "Completed by")).toBe("Tyson");
  });

  it("labels are never manufactured from absent evidence", () => {
    const fields = syncActionSubject(
      action("upsert_appliance_scan", { item_number: "1234567" })
    );
    expect(values(fields)).toEqual(["1234567"]);
    expect(labelled(fields, "Location")).toBeUndefined();
    expect(labelled(fields, "Part of")).toBeUndefined();
  });

  it("opaque internal ids are never surfaced", () => {
    const fields = syncActionSubject(
      action("STORE_OPS_SUNDAY_ASSIGN", {
        bay_id: "8f1c9b2e-1111-4222-8333-444455556666",
        week: "2026-W37",
      })
    );
    expect(values(fields).join(" ")).not.toContain("8f1c9b2e");
    expect(labelled(fields, "Week")).toBe("2026-W37");
  });

  it("payloads without recognisable subjects render nothing", () => {
    expect(syncActionSubject(action("clear_appliance_scans", {}))).toEqual([]);
    expect(
      syncActionSubject(action("lock_appliance_showroom_baseline", {}))
    ).toEqual([]);
  });

  it("nested payload objects are never dumped", () => {
    const fields = syncActionSubject(
      action("upsert_appliance_catalog", {
        item_number: "1234567",
        description: { nested: "value" },
      })
    );
    expect(values(fields)).toEqual(["1234567"]);
  });

  it("long values are truncated rather than flooding the row", () => {
    const fields = syncActionSubject(
      action("upsert_appliance_catalog", {
        item_number: "1234567",
        description: "x".repeat(200),
      })
    );
    expect(labelled(fields, "Description")!.length).toBeLessThanOrEqual(48);
  });

  it("subject identity is bounded per row", () => {
    const fields = syncActionSubject(
      action("upsert_appliance_scan", {
        item_number: "1234567",
        location: "Showroom Bay 4",
        bay_number: "4",
        aisle: "12",
        serial_number: "SN-0001",
        audit_session_id: "8f1c9b2e-1111-4222-8333-444455556666",
      })
    );
    expect(fields.length).toBeLessThanOrEqual(4);
  });
});

describe("APP-SYNC-UX-001 SyncQueuePanel presentation", () => {
  const panel = readRepo("components/settings/SyncQueuePanel.tsx");

  it("renders subject identity alongside failure reason and time", () => {
    expect(panel).toContain("syncActionSubject");
    expect(panel).toContain('data-testid="sync-action-subject"');
    expect(panel).toContain("syncFailureReasonLabel");
  });

  it("never dumps raw payload JSON", () => {
    expect(panel).not.toMatch(/JSON\.stringify\(\s*action\.payload/);
    expect(panel).not.toMatch(/JSON\.stringify\(\s*payload/);
  });
});

describe("APP-SYNC-UX-001 preserves device evidence", () => {
  it("the repair never clears, retries or purges the queue on its own", () => {
    const banner = readRepo("components/hub/OfflineNetworkBanner.tsx");
    expect(banner).not.toContain("purgeSyncQueue");
    expect(banner).not.toContain("clearSyncQueue");
    expect(banner).not.toContain("flushSyncQueue(");
  });

  it("quarantined actions still require an explicit supervisor decision", () => {
    const queue = readRepo("lib/sync-queue.ts");
    expect(queue).toContain("export function retryQuarantinedAction");
    expect(queue).toContain("export function discardQuarantinedAction");
  });
});
