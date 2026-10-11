/**
 * ALIGN-SEC-001 — cron routes require CRON_SECRET at the handler.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const cronRoute = path.resolve(
  __dirname,
  "../app/api/cron/weekly-rotation/route.ts"
);
const proxyPath = path.resolve(__dirname, "../proxy.ts");

describe("ALIGN-SEC-001 cron + proxy contracts", () => {
  it("weekly-rotation cron authorizes with CRON_SECRET and rejects otherwise", () => {
    const src = readFileSync(cronRoute, "utf8");
    expect(src).toMatch(/CRON_SECRET/);
    expect(src).toMatch(/authorizeCron/);
    expect(src).toMatch(/status:\s*401/);
    expect(src).not.toMatch(/BOOTSTRAP_SECRET/);
  });

  it("proxy does not treat arbitrary Bearer as authenticated", () => {
    const src = readFileSync(proxyPath, "utf8");
    expect(src).toMatch(/edgeAllowsRequest/);
    expect(src).not.toMatch(/startsWith\("Bearer\s*"\)/);
    expect(src).toMatch(/Bearer header MUST NOT bypass/i);
  });
});
