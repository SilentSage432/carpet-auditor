/**
 * DEPTSYNC-SEC-OPS-007F — roster authorization diagnostic contracts (no fix).
 *
 * Documents: anon 42501 is intentional SEC-OPS-002 containment; client list
 * projection excludes secrets and fits authenticated column grants; hub boot
 * calls fetchSpecialists without awaiting getSession / JWT gate.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isLikelyAuthRejection } from "@/lib/auth/access-gate-bootstrap";

/** Columns granted to authenticated by SEC-OPS-002 (migration text). */
const SEC_OPS_002_AUTHENTICATED_SELECT = new Set([
  "id",
  "username",
  "name",
  "role",
  "department_id",
  "is_active",
  "created_at",
  "assigned_department",
  "assigned_department_id",
  "must_change_credentials",
  "store_number",
  "invite_token_expires_at",
  "must_change_pin",
  "phone_number",
  "accessible_departments",
  "status",
  "invite_consumed_at",
  "auth_token_expires_at",
  "pin_updated_at",
  "auth_user_id",
  "email",
  "floor_title",
  "home_department",
]);

const SECRET_COLUMNS = [
  "pin",
  "pin_code",
  "pin_hash",
  "temp_pin_hash",
  "invite_token",
  "invite_token_hash",
  "auth_token_hash",
];

function parseSelectList(source: string, constName: string): string[] {
  const re = new RegExp(
    `const ${constName} = \\[([\\s\\S]*?)\\]\\.join`,
    "m"
  );
  const m = source.match(re);
  expect(m, `${constName} list`).toBeTruthy();
  return [...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

describe("SEC-OPS-007F fetchSpecialists projection", () => {
  it("uses explicit non-secret columns (no select *)", async () => {
    const source = await readFile(
      path.resolve(__dirname, "../specialists.ts"),
      "utf8"
    );
    expect(source).toMatch(/SPECIALIST_LIST_SELECT/);
    // Roster list path only — other helpers may use different selects.
    const loadStart = source.indexOf("async function loadSpecialists");
    const loadEnd = source.indexOf(
      "export async function saveSpecialist",
      loadStart
    );
    const loadBody = source.slice(loadStart, loadEnd);
    expect(loadBody).toMatch(/\.select\(SPECIALIST_LIST_SELECT\)/);
    expect(loadBody).not.toMatch(/\.select\(\s*["']\*["']\s*\)/);
    const cols = parseSelectList(source, "SPECIALIST_LIST_SELECT");
    for (const secret of SECRET_COLUMNS) {
      expect(cols).not.toContain(secret);
    }
    for (const col of cols) {
      expect(SEC_OPS_002_AUTHENTICATED_SELECT.has(col)).toBe(true);
    }
  });
});

describe("SEC-OPS-007F SEC-OPS-002 anon containment contract", () => {
  it("migration revokes anon table privileges on store_specialists", async () => {
    const source = await readFile(
      path.resolve(
        __dirname,
        "../../supabase/migrations/20261013_sec_ops_002_rls_containment.sql"
      ),
      "utf8"
    );
    expect(source).toMatch(
      /revoke all on table public\.store_specialists from anon/i
    );
    expect(source).toMatch(
      /revoke select on table public\.store_specialists from authenticated/i
    );
    expect(source).toMatch(
      /grant select \([\s\S]*home_department[\s\S]*\) on public\.store_specialists to authenticated/i
    );
  });

  it("42501 permission-denied object is classified as auth rejection", () => {
    const err = {
      code: "42501",
      message: "permission denied for table store_specialists",
      hint: "Grant the required privileges to the current role with: GRANT SELECT ON public.store_specialists TO anon;",
    };
    expect(isLikelyAuthRejection(err)).toBe(true);
  });
});

describe("SEC-OPS-007F bootstrap consumers", () => {
  it("AccessGate only fetches roster after live session probe when hasJwt", async () => {
    const source = await readFile(
      path.resolve(__dirname, "../../components/auth/AccessGate.tsx"),
      "utf8"
    );
    expect(source.indexOf("resolveLiveSupabaseSession")).toBeLessThan(
      source.indexOf("fetchSpecialists()")
    );
    expect(source).toMatch(/if \(hasJwt\)/);
  });

  it("hub page JWT-gates roster (007G repair; was ungated in 007F)", async () => {
    const source = await readFile(
      path.resolve(__dirname, "../../app/page.tsx"),
      "utf8"
    );
    expect(source).toMatch(/canFetchProtectedRoster/);
    expect(source).toMatch(/decideHubPageBoot/);
    expect(source).toMatch(/resolveLiveSupabaseSession/);
    expect(source.indexOf("resolveLiveSupabaseSession")).toBeLessThan(
      source.indexOf("fetchSpecialists()")
    );
  });
});
