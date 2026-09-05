import { afterEach, describe, expect, it } from "vitest";
import {
  getHubMasterPin,
  isHubMasterPin,
  requireHubMasterPin,
} from "./hub-master-pin";
import { actorBoundStoreNumber } from "./appliance-store-scope";
import { requireStoreOpsActor, StoreOpsAuthError } from "./auth";

describe("hub master PIN fail-closed", () => {
  const prevPin = process.env.HUB_MASTER_PIN;

  afterEach(() => {
    if (prevPin === undefined) delete process.env.HUB_MASTER_PIN;
    else process.env.HUB_MASTER_PIN = prevPin;
  });

  it("does not accept 1234 when HUB_MASTER_PIN is unset", () => {
    delete process.env.HUB_MASTER_PIN;
    expect(getHubMasterPin()).toBeNull();
    expect(isHubMasterPin("1234")).toBe(false);
    expect(isHubMasterPin("")).toBe(false);
  });

  it("requireHubMasterPin fails closed when unset (no implicit default)", () => {
    delete process.env.HUB_MASTER_PIN;
    expect(() => requireHubMasterPin()).toThrow(/HUB_MASTER_PIN is not configured/);
  });

  it("matches only the configured Master PIN when set", () => {
    process.env.HUB_MASTER_PIN = "pilot-unique-pin";
    expect(getHubMasterPin()).toBe("pilot-unique-pin");
    expect(isHubMasterPin("pilot-unique-pin")).toBe(true);
    expect(isHubMasterPin("1234")).toBe(false);
  });
});

describe("appliance API authorization helpers (read + write)", () => {
  it("rejects a missing Store Ops actor (unauthenticated cannot access)", () => {
    expect(() => requireStoreOpsActor(null)).toThrow(StoreOpsAuthError);
    try {
      requireStoreOpsActor(null);
    } catch (err) {
      expect(err).toBeInstanceOf(StoreOpsAuthError);
      expect((err as StoreOpsAuthError).status).toBe(401);
    }
  });

  it("allows a valid actor through requireStoreOpsActor", () => {
    const actor = {
      userId: "u1",
      specialistId: "s1",
      role: "department_supervisor" as const,
      departmentCode: "flooring",
      accessibleDepartmentCodes: ["flooring"],
      storeNumber: "2587",
    };
    expect(requireStoreOpsActor(actor)).toEqual(actor);
  });

  it("binds reads/writes to the authenticated actor store", () => {
    expect(actorBoundStoreNumber({ storeNumber: "2587" }, null)).toBe("2587");
  });

  it("ignores client-requested cross-store escalation on reads/writes", () => {
    expect(actorBoundStoreNumber({ storeNumber: "2587" }, "9999")).toBe("2587");
    expect(
      actorBoundStoreNumber({ storeNumber: "2587" }, "0000")
    ).toBe("2587");
  });
});

describe("appliance route actor enforcement (source contract)", () => {
  it("catalog and scans GET/POST/PATCH/DELETE require resolveStoreOpsActor", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../../app/api/appliances");
    for (const file of ["catalog/route.ts", "scans/route.ts"]) {
      const source = await fs.readFile(path.join(root, file), "utf8");
      expect(source).not.toMatch(/function storeFromRequest/);
      expect(source).toMatch(/requireStoreOpsActor\(await resolveStoreOpsActor/);
      expect(source).toMatch(/actorBoundStoreNumber/);
      const getBlocks = source.split("export async function GET");
      expect(getBlocks.length).toBeGreaterThan(1);
      expect(getBlocks[1]).toMatch(/requireStoreOpsActor/);
      expect(getBlocks[1]).toMatch(/actorBoundStoreNumber/);
    }
  });
});

/**
 * Public hub-bridge must not bootstrap Master Admin — only findExistingMasterSpecialist.
 */
describe("hub-bridge master bootstrap contract", () => {
  it("hub-bridge module no longer imports ensureMasterAdminBootstrap", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "hub-bridge.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/ensureMasterAdminBootstrap/);
    expect(source).toMatch(/findExistingMasterSpecialist/);
    expect(source).toMatch(/mintExistingMasterWithHubPin/);
  });
});
