/**
 * DEPTSYNC-SEC-OPS-007G — hub bootstrap source contracts.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("SEC-OPS-007G hub page bootstrap contract", () => {
  it("JWT-first fetchSpecialists with decideHubPageBoot + generation guard", async () => {
    const source = await readFile(
      path.resolve(__dirname, "../../app/page.tsx"),
      "utf8"
    );
    expect(source).toMatch(/decideHubPageBoot/);
    expect(source).toMatch(/canFetchProtectedRoster/);
    expect(source).toMatch(/bootGenRef/);
    expect(source).toMatch(/signOut\(\{\s*scope:\s*"local"/);
    expect(source).toMatch(/setGate\("unlock"\)/);
    expect(source).toMatch(/setGate\("login"\)/);
    expect(source).toMatch(/setRosterReady\(true\)/);
    // Must not call fetchSpecialists before probing live session in boot path.
    const bootStart = source.indexOf("const bootGen = ++bootGenRef.current");
    const fetchIdx = source.indexOf("fetchSpecialists()", bootStart);
    const sessionIdx = source.indexOf("resolveLiveSupabaseSession()", bootStart);
    expect(bootStart).toBeGreaterThan(-1);
    expect(sessionIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(sessionIdx);
  });

  it("AccessGate 007D recovery retained", async () => {
    const source = await readFile(
      path.resolve(__dirname, "../../components/auth/AccessGate.tsx"),
      "utf8"
    );
    expect(source).toMatch(/decideAccessGateBoot/);
    expect(source).toMatch(/bootGenRef/);
    expect(source).toMatch(/if \(hasJwt\)/);
    expect(source).toMatch(/resolveLiveSupabaseSession/);
  });

  it("service worker cache bumped for auth-boot delivery", async () => {
    const source = await readFile(
      path.resolve(__dirname, "../../public/sw.js"),
      "utf8"
    );
    expect(source).toMatch(/deptsync-shell-v8-auth-002/);
  });
});
