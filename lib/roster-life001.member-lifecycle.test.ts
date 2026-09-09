/**
 * ROSTER-LIFE-001 — roster member removal and correction integrity.
 *
 * Field evidence (Samsung, live roster setup): a removed member stayed visible
 * in the roster for a long time after the removal succeeded, and the
 * remove-confirm dialog sat underneath BottomNav.
 *
 * Removal delay is the ROSTER-ROLE-001 defect again in a second writer:
 * deleteSpecialist changed local roster state without dropping the 45s TTL
 * entry, so the reload that follows a successful delete replayed the member
 * back into the list.
 *
 * The edit finding is deliberately NOT repaired here — there is no safe
 * server-side rename path today. See the tranche report.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteSpecialist,
  fetchSpecialists,
  invalidateRosterCache,
} from "@/lib/specialists";
import type { StoreSpecialist } from "@/lib/types";

const STORAGE_KEY = "carpet_specialists_offline";
const STORE = "2587";

function readRepo(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

function member(id: string, name: string): StoreSpecialist {
  return {
    id,
    store_number: STORE,
    name,
    role: "Associate",
    pin_code: null,
    username: name.toLowerCase(),
    assigned_department: "flooring",
    accessible_departments: ["flooring"],
    must_change_credentials: false,
    is_active: true,
    created_at: new Date().toISOString(),
    offline: true,
  } as StoreSpecialist;
}

describe("ROSTER-LIFE-001 removal is visible immediately", () => {
  beforeEach(() => {
    localStorage.clear();
    invalidateRosterCache();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([member("id-keep", "Keep Me"), member("id-drop", "Drop Me")])
    );
  });

  afterEach(() => {
    localStorage.clear();
    invalidateRosterCache();
  });

  it("a removed member does not reappear from the roster TTL cache", async () => {
    const before = await fetchSpecialists(STORE);
    expect(before.map((m) => m.name).sort()).toEqual(["Drop Me", "Keep Me"]);

    await deleteSpecialist(member("id-drop", "Drop Me"));

    // This is the field defect: without invalidation the cached array is
    // replayed here and the removed member is visible again.
    const after = await fetchSpecialists(STORE);
    expect(after.map((m) => m.name)).toEqual(["Keep Me"]);
    expect(after[0].id).toBe("id-keep");
  });

});

describe("ROSTER-LIFE-001 removal write path", () => {
  const specialists = readRepo("lib/specialists.ts");

  it("deleteSpecialist drops the roster cache before it returns", () => {
    const start = specialists.indexOf("export async function deleteSpecialist(");
    const body = specialists.slice(start, specialists.indexOf("\n}\n", start));
    expect(body).toContain("invalidateRosterCache()");
    // Ahead of every return, so offline, soft, and hard paths all benefit.
    expect(body.indexOf("invalidateRosterCache()")).toBeLessThan(
      body.indexOf("return {")
    );
  });

  it("soft-delete stays the primary removal so audit history survives", () => {
    const start = specialists.indexOf("export async function deleteSpecialist(");
    const body = specialists.slice(start, specialists.indexOf("\n}\n", start));
    expect(body).toContain('.update({ is_active: false, status: "suspended" })');
  });

  it("a failed removal restores the member and reports the error", () => {
    const roster = readRepo("components/hub/tabs/RosterTab.tsx");
    const start = roster.indexOf("async function handleDelete()");
    const body = roster.slice(start, roster.indexOf("\n  }", start));
    expect(body).toContain("setRoster(previous)");
    expect(body).toContain("toastError");
    // Success is only claimed after the await resolves.
    expect(body.indexOf("await deleteSpecialist(target)")).toBeLessThan(
      body.indexOf("toastSuccess")
    );
  });

  it("the confirm cannot be double-submitted", () => {
    const roster = readRepo("components/hub/tabs/RosterTab.tsx");
    const start = roster.indexOf("async function handleDelete()");
    const body = roster.slice(start, roster.indexOf("\n  }", start));
    // The dialog is unmounted before the request goes out.
    expect(body.indexOf("setDeleteTarget(null)")).toBeLessThan(
      body.indexOf("await deleteSpecialist(target)")
    );
  });
});

describe("ROSTER-LIFE-001 records what the member editor cannot do", () => {
  const sheet = readRepo("components/hub/SpecialistEditSheet.tsx");

  it("SpecialistEditSheet renders identity as read-only — there is no edit form", () => {
    // Name, floor title, and department are display-only today.
    expect(sheet).toContain("<span className=\"truncate\">{member.name}</span>");
    expect(sheet).not.toContain("onChange={setName}");
    expect(sheet).not.toContain("updateSpecialistScope");
    expect(sheet).not.toContain("saveSpecialist");
  });

  it("its mutations are actions and authority, not workforce correction", () => {
    expect(sheet).toContain("issueRosterPairing");
    expect(sheet).toContain("adminResetSpecialistPin");
    expect(sheet).toContain("DepartmentAccessChips");
    expect(sheet).toContain("Remove Specialist");
  });

  it("authority gating on the sheet is unchanged", () => {
    expect(sheet).toContain('member.role !== "MasterAdmin"');
    expect(sheet).toContain("const showRemove = canManage");
    expect(sheet).toContain("const grantable =");
  });
});
