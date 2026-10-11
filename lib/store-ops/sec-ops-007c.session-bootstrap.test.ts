/**
 * DEPTSYNC-SEC-OPS-007C/D — secure-session bootstrap contracts.
 * After 007D: AccessGate recovers via decideAccessGateBoot (no permanent booting).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("SEC-OPS-007C/D AccessGate bootstrap contract", () => {
  it("AccessGate uses decideAccessGateBoot and leaves booting on failures", async () => {
    const source = await readFile(
      path.resolve(__dirname, "../../components/auth/AccessGate.tsx"),
      "utf8"
    );
    expect(source).toMatch(/mode === "booting"/);
    expect(source).toMatch(/Loading DeptSync secure session/);
    expect(source).toMatch(/decideAccessGateBoot/);
    expect(source).toMatch(/fetchSpecialists/);
    expect(source).toMatch(/try\s*\{/);
    expect(source).toMatch(/catch/);
    expect(source).toMatch(/setMode\("login"\)/);
    expect(source).toMatch(/setMode\("unlock"\)/);
    expect(source).toMatch(/bootGenRef/);
    expect(source).toMatch(/signOut\(\{\s*scope:\s*"local"/);
  });

  it("fetchSpecialists still rethrows select failures (bootstrap must catch)", async () => {
    const source = await readFile(
      path.resolve(__dirname, "../specialists.ts"),
      "utf8"
    );
    expect(source).toMatch(/\[fetchSpecialists\] store_specialists select failed/);
    expect(source).toMatch(/throw err/);
  });
});
