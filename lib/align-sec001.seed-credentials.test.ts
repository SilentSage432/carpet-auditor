/**
 * ALIGN-SEC-001 — seed paths must not create known default credentials.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const schemaPath = path.resolve(__dirname, "../supabase/schema.sql");

describe("ALIGN-SEC-001 seed credentials", () => {
  it("schema.sql does not insert known default PIN values", () => {
    const sql = readFileSync(schemaPath, "utf8");
    expect(sql).not.toMatch(/pin_code[\s\S]{0,80}'1234'/i);
    expect(sql).not.toMatch(/,\s*'1234'\s*,\s*'1234'\s*,\s*'flooring'/i);
    expect(sql).not.toMatch(/'ChangeMe123'/);
    expect(sql).toMatch(/ALIGN-SEC-001/);
  });
});
