/**
 * APP-UPC-001A — focused opaque scan identity tests.
 */

import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mapApplianceCatalogRow,
  resolveApplianceCatalogItem,
  resolveApplianceScan,
} from "@/lib/appliance-catalog";
import {
  APPLIANCE_SCAN_HMAC_SECRET_ENV,
  fingerprintApplianceScanIdentifier,
  requireApplianceScanHmacSecret,
} from "@/lib/appliances/scan-fingerprint.server";
import {
  canonicalApplianceScanIdentifier,
  isPhysicalApplianceScanIdentifier,
} from "@/lib/appliances/scan-identity";
import {
  captureUnresolvedApplianceScan,
  clearAllUnresolvedApplianceScans,
  groupUnresolvedByScanIdentifier,
  listUnresolvedApplianceScans,
  purgeStaleUnresolvedApplianceScans,
  removeUnresolvedApplianceScans,
  UNRESOLVED_APPLIANCE_SCAN_TTL_MS,
  UNRESOLVED_APPLIANCE_SCANS_KEY,
} from "@/lib/appliances/unresolved-scans";
import { sanitizeBarcodeScan } from "@/lib/barcode";
import type { ApplianceCatalogItem } from "@/lib/types";

const TEST_SECRET = "test-appliance-scan-hmac-secret-not-real";

describe("APP-UPC-001A canonical normalization", () => {
  it("preserves leading zeros (unlike sanitizeBarcodeScan)", () => {
    expect(canonicalApplianceScanIdentifier("0012345")).toBe("0012345");
    expect(sanitizeBarcodeScan("0012345")).toBe("12345");
  });

  it("preserves ESL / non-digit aliases", () => {
    expect(canonicalApplianceScanIdentifier("ESL-ABC12345")).toBe(
      "ESL-ABC12345"
    );
    expect(canonicalApplianceScanIdentifier("  ESL9988776655\n")).toBe(
      "ESL9988776655"
    );
  });

  it("trims control/whitespace framing only", () => {
    expect(canonicalApplianceScanIdentifier("\u0000012345678905\u0000")).toBe(
      "012345678905"
    );
  });

  it("classifies long physical identifiers", () => {
    expect(isPhysicalApplianceScanIdentifier("012345678905")).toBe(true);
    expect(isPhysicalApplianceScanIdentifier("12345")).toBe(false);
  });
});

describe("APP-UPC-001A server HMAC fingerprint", () => {
  beforeEach(() => {
    process.env[APPLIANCE_SCAN_HMAC_SECRET_ENV] = TEST_SECRET;
  });

  it("same canonical identifier + secret → same fingerprint", () => {
    const a = fingerprintApplianceScanIdentifier("012345678905");
    const b = fingerprintApplianceScanIdentifier("012345678905");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("leading-zero variants fingerprint differently (string identity)", () => {
    const withZero = fingerprintApplianceScanIdentifier("012345678905");
    const stripped = fingerprintApplianceScanIdentifier("12345678905");
    expect(withZero).not.toBe(stripped);
  });

  it("distinct identifiers produce distinct fingerprints", () => {
    const a = fingerprintApplianceScanIdentifier("111111111111");
    const b = fingerprintApplianceScanIdentifier("222222222222");
    expect(a).not.toBe(b);
  });

  it("matches raw Node HMAC of canonical form", () => {
    const canonical = canonicalApplianceScanIdentifier("  0012345  ");
    const expected = createHmac("sha256", TEST_SECRET)
      .update(canonical, "utf8")
      .digest("hex");
    expect(fingerprintApplianceScanIdentifier("  0012345  ")).toBe(expected);
  });

  it("missing secret fails closed", () => {
    delete process.env[APPLIANCE_SCAN_HMAC_SECRET_ENV];
    expect(() =>
      requireApplianceScanHmacSecret({} as NodeJS.ProcessEnv)
    ).toThrow(/fail closed/i);
  });

  it("does not fall back to CRON_SECRET or other secrets", () => {
    delete process.env[APPLIANCE_SCAN_HMAC_SECRET_ENV];
    expect(() =>
      requireApplianceScanHmacSecret({
        CRON_SECRET: "cron",
        HUB_GATE_SECRET: "gate",
        SUPABASE_SERVICE_ROLE_KEY: "service",
      } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/APPLIANCE_SCAN_HMAC_SECRET/);
  });
});

describe("APP-UPC-001A client catalog has no raw identifiers", () => {
  it("mapApplianceCatalogRow strips upc/identifiers if present", () => {
    const item = mapApplianceCatalogRow({
      id: "1",
      store_number: "2587",
      item_number: "111",
      upc: "012345678905",
      identifiers: ["ESL1"],
      description: "Washer",
      category: "Laundry",
      sub_category: "Washer",
      created_at: "",
      updated_at: "",
    });
    expect(item).not.toHaveProperty("upc");
    expect(item).not.toHaveProperty("identifiers");
    expect(item.item_number).toBe("111");
  });

  it("local resolve matches item_number only — not upc", () => {
    const catalog: ApplianceCatalogItem[] = [
      {
        id: "1",
        store_number: "2587",
        item_number: "5709242",
        description: "Washer",
        category: "Laundry",
        sub_category: "Washer",
        created_at: "",
        updated_at: "",
      },
    ];
    expect(resolveApplianceCatalogItem(catalog, "5709242").status).toBe(
      "matched"
    );
    expect(resolveApplianceCatalogItem(catalog, "012345678905").status).toBe(
      "none"
    );
    const scan = resolveApplianceScan(catalog, "012345678905");
    expect(scan.kind === "unlinked_barcode" || scan.kind === "unknown_sku").toBe(
      true
    );
  });
});

describe("APP-UPC-001A unresolved offline queue", () => {
  beforeEach(() => {
    clearAllUnresolvedApplianceScans();
  });

  it("captures three identical offline scans as three pending units", () => {
    for (let i = 0; i < 3; i++) {
      captureUnresolvedApplianceScan({
        store_number: "2587",
        scan_identifier: "012345678905",
        serial_number: "",
        location: "Showroom",
        location_type: "showroom",
        condition_tag: "SHOWROOM_DISPLAY",
        category: "Laundry",
        sub_category: "",
        scanned_by: "DS",
      });
    }
    const rows = listUnresolvedApplianceScans("2587");
    expect(rows).toHaveLength(3);
    const grouped = groupUnresolvedByScanIdentifier(rows);
    expect(grouped.get("012345678905")).toHaveLength(3);
  });

  it("does not put raw identifiers into catalog offline key", () => {
    captureUnresolvedApplianceScan({
      store_number: "2587",
      scan_identifier: "ESL9988776655",
      serial_number: "",
      location: "",
      location_type: "showroom",
      condition_tag: "SHOWROOM_DISPLAY",
      category: "Laundry",
      sub_category: "",
      scanned_by: "",
    });
    expect(localStorage.getItem("appliance_catalog_offline")).toBeNull();
    const pending = localStorage.getItem(UNRESOLVED_APPLIANCE_SCANS_KEY);
    expect(pending).toContain("ESL9988776655");
  });

  it("successful removal deletes pending rows; failed path leaves them", () => {
    const a = captureUnresolvedApplianceScan({
      store_number: "2587",
      scan_identifier: "111111111111",
      serial_number: "",
      location: "",
      location_type: "showroom",
      condition_tag: "SHOWROOM_DISPLAY",
      category: "Laundry",
      sub_category: "",
      scanned_by: "",
    });
    expect(listUnresolvedApplianceScans("2587")).toHaveLength(1);
    // Simulate failed resolution: do not remove.
    expect(listUnresolvedApplianceScans("2587")[0]?.id).toBe(a.id);
    removeUnresolvedApplianceScans([a.id]);
    expect(listUnresolvedApplianceScans("2587")).toHaveLength(0);
  });

  it("TTL purge removes abandoned stale entries", () => {
    const old = captureUnresolvedApplianceScan({
      store_number: "2587",
      scan_identifier: "999999999999",
      captured_at: new Date(
        Date.now() - UNRESOLVED_APPLIANCE_SCAN_TTL_MS - 1000
      ).toISOString(),
      serial_number: "",
      location: "",
      location_type: "showroom",
      condition_tag: "SHOWROOM_DISPLAY",
      category: "Laundry",
      sub_category: "",
      scanned_by: "",
    });
    expect(old.id).toBeTruthy();
    const kept = purgeStaleUnresolvedApplianceScans();
    expect(kept.find((r) => r.id === old.id)).toBeUndefined();
  });
});

describe("APP-UPC-001A server-only boundary (module)", () => {
  it("scan-fingerprint.server declares server-only", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        "lib/appliances/scan-fingerprint.server.ts",
        "utf8"
      )
    );
    expect(src).toContain('import "server-only"');
    expect(src).toContain("APPLIANCE_SCAN_HMAC_SECRET");
    expect(src).not.toContain("NEXT_PUBLIC_");
  });

  it("client catalog module does not import fingerprint server", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("lib/appliance-catalog.ts", "utf8")
    );
    expect(src).not.toContain("scan-fingerprint.server");
    expect(src).not.toContain("APPLIANCE_SCAN_HMAC_SECRET");
  });
});

describe("APP-UPC-001A API routes reject client fingerprint authority", () => {
  it("resolve-scan and teach-scan source reject scan_fingerprint", async () => {
    const fs = await import("node:fs");
    const resolve = fs.readFileSync(
      "app/api/appliances/catalog/resolve-scan/route.ts",
      "utf8"
    );
    const teach = fs.readFileSync(
      "app/api/appliances/catalog/teach-scan/route.ts",
      "utf8"
    );
    expect(resolve).toContain("Client-supplied scan_fingerprint is not accepted");
    expect(teach).toContain("Client-supplied scan_fingerprint is not accepted");
  });
});

describe("APP-UPC-001A export / CSV has no upc column", () => {
  it("applianceScansToCsv headers exclude upc", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("lib/appliance-scans.ts", "utf8");
    const fnStart = src.indexOf("export function applianceScansToCsv");
    const fn = src.slice(fnStart, fnStart + 2500);
    expect(fn).toContain('"Item Number"');
    expect(fn).not.toMatch(/\bupc\b/i);
  });

  it("physical audit reconciliation CSV headers exclude upc", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("lib/appliances/physical-audit.ts", "utf8");
    const fnStart = src.indexOf(
      "export function applianceAuditReconciliationToCsv"
    );
    const fn = src.slice(fnStart, fnStart + 2000);
    expect(fn).toContain('"Item Number"');
    expect(fn).not.toMatch(/\bupc\b/i);
  });
});
