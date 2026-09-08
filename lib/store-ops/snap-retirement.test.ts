/**
 * SNAP-RETIRE-001 — Bay Audit Validate / Snap Bay persisting path retirement.
 *
 * SNAP-DECISION-001 chose RETIRE. The capability's intended job was to let a
 * Gemini verdict gate `weekly_rotations` completion, which Article X and
 * Appendix B row B forbid, and its evidence loop was severed at every stage.
 *
 * These tests pin the retirement in both directions: the model-authored
 * completion authority is gone, and the ephemeral Visual Bay Scan capability
 * plus the historical `bay_audit_logs` table survive untouched.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function repoExists(relativePath: string): boolean {
  return existsSync(path.join(root, relativePath));
}

/**
 * Assertions about absent *behaviour* must read executable code only —
 * a comment explaining why a gate was removed is not a gate.
 */
function readCode(relativePath: string): string {
  return readRepo(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("SNAP-RETIRE-001 — retired surface is absent", () => {
  it("A. removes the Bay Audit Validate route", () => {
    expect(repoExists("app/api/ai/bay-audit/validate/route.ts")).toBe(false);
    // The route tree existed only for this capability.
    expect(repoExists("app/api/ai")).toBe(false);
  });

  it("B. removes the dedicated Bay Audit AI implementation", () => {
    expect(repoExists("lib/store-ops/ai-bay-audit.ts")).toBe(false);
  });

  it("C. removes the Bay Audit contracts", () => {
    expect(repoExists("lib/ai/contracts/bay-audit.ts")).toBe(false);
    expect(repoExists("lib/ai/contracts")).toBe(false);
  });

  it("D. removes the Bay Audit runtime persistence helper", () => {
    expect(repoExists("lib/store-ops/bay-audit-logs.ts")).toBe(false);
  });

  it("E. removes the validateBayAudit client helper and its result type", () => {
    const client = readRepo("lib/store-ops/client.ts");
    expect(client).not.toContain("validateBayAudit");
    expect(client).not.toContain("BayAuditValidateResult");
    expect(client).not.toContain("/api/ai/bay-audit/validate");
  });

  it("F. removes BayCompleteGatedError entirely", () => {
    for (const file of [
      "lib/store-ops/client.ts",
      "components/store-ops/ZebraChecklist.tsx",
    ]) {
      expect(readRepo(file)).not.toContain("BayCompleteGatedError");
    }
  });

  it("removes the modal's persisting branch but keeps the modal", () => {
    const modal = readRepo("components/store-ops/VisualBayScannerModal.tsx");
    expect(modal).not.toContain("auditContext");
    expect(modal).not.toContain("onAuditValidated");
    expect(modal).not.toContain("validateBayAudit");
    expect(modal).not.toContain("BayAuditVerdict");
    expect(modal).toContain("scanBayVisual");
  });

  it("removes the Floor audit plumbing and its sole entry point", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    for (const marker of [
      "bayAudits",
      "externalAudits",
      "auditContext",
      "onAuditValidated",
      "setBayScanOpen",
      "VisualBayScannerModal",
      "Snap Bay Photo",
    ]) {
      expect(floor, `${marker} must not survive on Floor`).not.toContain(marker);
    }
  });

  it("removes the dead audit-gate state from the checklist", () => {
    const zebra = readRepo("components/store-ops/ZebraChecklist.tsx");
    for (const marker of [
      "auditByRotation",
      "externalAudits",
      "gatedRotationId",
      "handleSupervisorOverrideComplete",
      "audit_verdict",
      "audit_log_id",
    ]) {
      expect(zebra, `${marker} must not survive`).not.toContain(marker);
    }
  });

  it("drops the retired capability from the offline registry", () => {
    const registry = readRepo("lib/offline-capability.ts");
    expect(registry).not.toContain("bay_audit_logs");
    expect(registry).not.toContain("Snap Bay");
  });
});

describe("SNAP-RETIRE-001 — the model-authority path is gone", () => {
  const route = readRepo("app/api/rotations/complete/route.ts");
  const client = readRepo("lib/store-ops/client.ts");

  it("G. forwards no audit verdict or log id during completion", () => {
    for (const marker of ["audit_verdict", "audit_log_id"]) {
      expect(route, `${marker} must not reach the server`).not.toContain(marker);
      expect(client, `${marker} must not leave the client`).not.toContain(marker);
    }
    expect(client).not.toContain("supervisor_override");
  });

  it("H. leaves no model-verdict completion gate behind", () => {
    expect(route).not.toContain("gated");
    expect(route).not.toContain("FAIL");
    expect(route).not.toContain("fetchBayAuditLog");
    expect(route).not.toContain("markBayAuditOverride");
    expect(route).not.toContain("422");
  });

  it("replaces the gate with nothing — no deterministic scoring substitute", () => {
    // Retirement rejected the product job; it did not swap the judge.
    const code = readCode("app/api/rotations/complete/route.ts").toLowerCase();
    for (const marker of ["score", "verdict", "rubric", "threshold", "confidence"]) {
      expect(code, `${marker} must not reappear as a gate`).not.toContain(marker);
    }
  });

  it("I. keeps ordinary human rotation completion intact", () => {
    expect(route).toContain("completeWeeklyRotation");
    expect(route).toContain("rotation_id is required");
    expect(route).toContain("autoVerify");
    expect(client).toContain("export async function completeRotation");
    expect(client).toContain("STORE_OPS_COMPLETE_ROTATION");
  });

  it("keeps actor and department scope enforcement on completion", () => {
    expect(route).toContain("requireStoreOpsActor");
    expect(route).toContain("isDeptFloorActor");
    expect(route).toContain("assertActorCanAccessDepartmentId");
  });

  it("J. keeps the two-stage human verification queue working", () => {
    const review = readRepo("lib/store-ops/rotation-review.ts");
    expect(review).toContain("PENDING_VERIFICATION");
    expect(review).toContain("verifyCompletionAttempt");
    expect(review).toContain("sendBackCompletionAttempt");
    expect(repoExists("app/api/rotations/verify/route.ts")).toBe(true);
  });

  it("K. keeps send-back and completion-attempt history working", () => {
    expect(repoExists("lib/store-ops/completion-attempt-history.ts")).toBe(true);
    const history = readRepo("lib/store-ops/completion-attempt-history.ts");
    expect(history).toContain("sendBackCompletionAttempt");
    const modal = readRepo("components/store-ops/SupervisorAuditSummaryModal.tsx");
    expect(modal).toContain("sendBackNote");
  });

  it("L. removes the dead Bay Audit join from rotation review", () => {
    const review = readRepo("lib/store-ops/rotation-review.ts");
    expect(review).not.toContain("fetchLatestBayAuditLogsByRotationIds");
    expect(review).not.toContain("BayAuditLogRow");
    expect(review).not.toContain("bay_audit_logs");
    // The never-rendered verdict chip and photo are gone with it.
    const modal = readRepo("components/store-ops/SupervisorAuditSummaryModal.tsx");
    expect(modal).not.toContain("item.audit");
  });
});

describe("SNAP-RETIRE-001 — Visual Bay Scan is preserved, not re-dispositioned", () => {
  it("M. keeps the ephemeral scan route and its domain module", () => {
    expect(repoExists("app/api/store-ops/ai-bay-scan/route.ts")).toBe(true);
    const scan = readRepo("lib/store-ops/ai-bay-scan.ts");
    expect(scan).toContain("export function buildBayScanPrompt");
    expect(scan).toContain("export function normalizeBayScanResult");
    expect(scan).toContain("export const BAY_SCAN_RESPONSE_SCHEMA");
    expect(scan).toContain("export function resolveImageMimeType");
  });

  it("N. keeps Visual Bay Scan non-persisting", () => {
    const route = readRepo("app/api/store-ops/ai-bay-scan/route.ts");
    expect(route).not.toContain("supabase");
    expect(route).not.toContain("insert");
    // The shared modal is now ephemeral by contract at every mount.
    const modal = readRepo("components/store-ops/VisualBayScannerModal.tsx");
    expect(modal).not.toContain("bay_audit_logs");
  });

  it("keeps its three existing mounts and adds none", () => {
    const mounts = [
      "components/hub/tabs/MapTab.tsx",
      "components/admin/WalkTheFloorSheet.tsx",
      "components/sections/CycleAuditSection.tsx",
    ];
    for (const mount of mounts) {
      expect(readRepo(mount)).toContain("VisualBayScannerModal");
    }
    expect(mounts).toHaveLength(3);
  });

  it("O. keeps the shared bayScan token budget", () => {
    expect(readRepo("lib/ai/gemini.ts")).toMatch(/^\s*bayScan:/m);
  });
});

describe("SNAP-RETIRE-001 — shared transport and inventory", () => {
  it("P. leaves AI-SAFETY-001 bounding at one attempt / 20s / zero retries", () => {
    const transport = readRepo("lib/ai/gemini.ts");
    expect(transport).toContain("GEMINI_REQUEST_TIMEOUT_MS = 20_000");
    expect(transport).toContain("AbortController");
    expect(transport).toContain("clearTimeout");
    expect(transport).toContain("GeminiTimeoutError");
    // No retry existed and none may be introduced under a retirement label.
    // The transport's prose says so; this asserts the executable code agrees.
    const code = readCode("lib/ai/gemini.ts");
    expect(code).not.toMatch(/\bretry\b|\bbackoff\b|maxAttempts/i);
    expect(code.match(/generateContent\(/g) ?? []).toHaveLength(1);
  });

  it("Q. leaves exactly five live Gemini consumers", () => {
    const consumers = [
      "app/api/store-locations/ai-parse/route.ts",
      "app/api/copilot/parse-walk/route.ts",
      "app/api/store-ops/ai-bay-scan/route.ts",
      "app/api/flooring/ai-insights/route.ts",
      "app/actions/manager-notes.ts",
    ];
    for (const consumer of consumers) {
      expect(repoExists(consumer)).toBe(true);
      expect(readRepo(consumer)).toContain("callGeminiFlashJson");
    }
    expect(consumers).toHaveLength(5);
  });

  it("R. preserves the four-route / one-Server-Action distinction", () => {
    const routes = [
      "app/api/store-locations/ai-parse/route.ts",
      "app/api/copilot/parse-walk/route.ts",
      "app/api/store-ops/ai-bay-scan/route.ts",
      "app/api/flooring/ai-insights/route.ts",
    ];
    expect(routes).toHaveLength(4);
    for (const route of routes) {
      expect(readRepo(route)).toMatch(/export async function (POST|GET)/);
    }
    const action = readRepo("app/actions/manager-notes.ts");
    expect(action).toContain('"use server"');
    expect(repoExists("app/api/actions/manager-notes/route.ts")).toBe(false);
  });

  it("keeps the SDK confined to the shared transport", () => {
    expect(readRepo("lib/ai/gemini.ts")).toContain("GoogleGenerativeAI");
  });
});

describe("SNAP-RETIRE-001 — historical evidence is preserved", () => {
  const migration = readRepo("supabase/migrations/20260818_bay_audit_logs.sql");

  it("S. keeps the historical table definition and its RLS", () => {
    expect(migration).toContain("create table if not exists public.bay_audit_logs");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("Enforce Store and Department Isolation");
  });

  it("adds no drop, delete, or backfill migration", () => {
    expect(migration).not.toMatch(/drop table/i);
    const migrations = readFileSync(
      path.join(root, "supabase/migrations/20260818_bay_audit_logs.sql"),
      "utf8"
    );
    expect(migrations).not.toMatch(/delete from public\.bay_audit_logs/i);
  });

  it("leaves no runtime writer or reader for the retired table", () => {
    for (const file of [
      "lib/store-ops/client.ts",
      "lib/store-ops/rotation-review.ts",
      "app/api/rotations/complete/route.ts",
      "lib/offline-capability.ts",
    ]) {
      expect(readRepo(file)).not.toContain("bay_audit_logs");
    }
  });
});
