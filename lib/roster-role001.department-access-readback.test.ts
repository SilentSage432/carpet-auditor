/**
 * ROSTER-ROLE-001 — cross-department grant read-back integrity.
 *
 * Field evidence (Samsung, live roster setup): toggling a "Cross-department
 * access" chip showed a success toast and then snapped back, so the grant
 * looked lost. Production disagreed — store_specialists.accessible_departments
 * held the grant. The write was never the problem.
 *
 * Root cause: updateDepartmentAccess dropped the Store Ops list caches but not
 * the roster cache, so the reload that follows the mutation replayed the
 * pre-toggle roster from a 45s TTL entry and overwrote the fresh value.
 *
 * These are the chips that grant DeptSync access scope. They are not a
 * workforce "secondary role" — no such model exists (see the tranche report).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createTtlCache } from "@/lib/store-ops/ttl-cache";
import { composeAccessibleDepartments } from "@/lib/department-access";

function readRepo(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("ROSTER-ROLE-001 the stale read-back mechanism", () => {
  it("reproduces the defect: a fresh TTL entry replays pre-mutation data", async () => {
    const cache = createTtlCache<string[]>(45_000);
    let dbValue = ["plumbing"];
    const load = async () => [...dbValue];

    expect(await cache.getSWR("roster:2587", load)).toEqual(["plumbing"]);

    // The grant lands in the database.
    dbValue = ["plumbing", "electrical"];

    // Without invalidation the reload returns the pre-toggle roster — the chip
    // visibly reverts even though the write succeeded.
    expect(await cache.getSWR("roster:2587", load)).toEqual(["plumbing"]);
  });

  it("invalidating before the reload returns the truthful persisted value", async () => {
    const cache = createTtlCache<string[]>(45_000);
    let dbValue = ["plumbing"];
    const load = async () => [...dbValue];

    await cache.getSWR("roster:2587", load);
    dbValue = ["plumbing", "electrical"];

    cache.invalidate();

    expect(await cache.getSWR("roster:2587", load)).toEqual([
      "plumbing",
      "electrical",
    ]);
  });
});

describe("ROSTER-ROLE-001 mutation cache contract", () => {
  const client = readRepo("lib/store-ops/client.ts");

  /** Slice one exported declaration — type literals contain their own braces. */
  function declaration(source: string, signature: string): string {
    const start = source.indexOf(signature);
    expect(start).toBeGreaterThan(-1);
    const next = source.indexOf("\nexport ", start + 1);
    return source.slice(start, next === -1 ? source.length : next);
  }

  it("updateDepartmentAccess drops the roster cache — the field defect", () => {
    const body = declaration(
      client,
      "export async function updateDepartmentAccess("
    );
    expect(body).toContain("invalidateRosterCache()");
    // The Store Ops list caches alone were never enough.
    expect(body).toContain("invalidateStoreOpsListCaches()");
  });

  it("every roster-mutating client function invalidates the roster cache", () => {
    for (const fn of [
      "export async function updateDepartmentAccess(",
      "export async function issueRosterPairing(",
      "export async function createRosterMember(",
      "export async function inviteSupervisor(",
    ]) {
      expect(declaration(client, fn)).toContain("invalidateRosterCache()");
    }
  });
});

describe("ROSTER-ROLE-001 the grant route cannot claim a false success", () => {
  const route = readRepo("app/api/admin/department-access/route.ts");

  it("no longer strips accessible_departments and retries", () => {
    // The retry wrote assigned_department alone and then reported ok:true.
    expect(route).not.toContain(
      'isMissingColumnError(specialistError, "accessible_departments")'
    );
    expect(route).not.toMatch(/\.update\(\{ assigned_department: primary \}\)/);
  });

  it("echoes the persisted row rather than the requested value", () => {
    expect(route).toContain("saved.accessible_departments");
    expect(route).toContain("accessible_departments: persisted");
    expect(route).not.toMatch(/accessible_departments: accessible,\s*\}\);/);
  });

  it("a genuine write failure still returns an error, not ok", () => {
    const failAt = route.indexOf("if (specialistError) {");
    const okAt = route.indexOf("ok: true");
    expect(failAt).toBeGreaterThan(-1);
    expect(failAt).toBeLessThan(okAt);
    expect(route).toContain("Could not update accessible departments");
  });
});

describe("ROSTER-ROLE-001 preserves the role/authority separation", () => {
  it("the grant carries departments only — it never rewrites role", () => {
    const route = readRepo("app/api/admin/department-access/route.ts");
    const patchAt = route.indexOf("const specialistPatch");
    const patch = route.slice(patchAt, route.indexOf("};", patchAt));
    expect(patch).toContain("assigned_department");
    expect(patch).toContain("accessible_departments");
    expect(patch).not.toContain("role:");
    expect(patch).not.toContain("floor_title");
  });

  it("MasterAdmin and supervisor guards are unchanged", () => {
    const route = readRepo("app/api/admin/department-access/route.ts");
    expect(route).toContain("Master Admin already has full-store access");
    expect(route).toContain("Supervisors may only grant access on associates");
  });

  it("composition still pins the home department first and dedupes", () => {
    expect(composeAccessibleDepartments("plumbing", ["electrical"])).toEqual([
      "plumbing",
      "electrical",
    ]);
    // No duplicate when the home department is re-sent.
    expect(
      composeAccessibleDepartments("plumbing", ["plumbing", "electrical"])
    ).toEqual(["plumbing", "electrical"]);
    // Deselection is truthful — dropping the extra leaves only home.
    expect(composeAccessibleDepartments("plumbing", [])).toEqual(["plumbing"]);
  });

  it("primary role creation is untouched by this repair", () => {
    const roster = readRepo("components/hub/tabs/RosterTab.tsx");
    expect(roster).toContain("resolveRosterJobSave(jobOptionId, department)");
    expect(roster).toContain("floor_title: job.floor_title");
    // UX-005G.1 focused-workspace suppression stays wired.
    expect(roster).toContain("useFocusedWorkspace()");
  });
});
