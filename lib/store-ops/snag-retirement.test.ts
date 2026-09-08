/**
 * AI-RETIRE-001 — Snag Triage retirement.
 *
 * Snag Triage was an orphaned product job: a route, a Gemini classifier, a
 * deterministic fallback, and a dispatcher that could write three authoritative
 * tables — with no UI, no caller, and no read-back. It is retired, not replaced.
 *
 * These tests hold the retirement boundary: the job is gone, and the three
 * workflows that legitimately own those tables are untouched.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  activeDownstockFlags,
  DOWNSTOCK_EVENT,
  type DownstockMap,
} from "./downstock";
import { openShiftWalkTasks, SHIFT_TASKS_EVENT } from "./shift-tasks";
import { EXCEPTION_REASONS, QUICK_BARRIER_REASONS } from "./verification";
import { createWalkTaskId } from "./ai-walk-parse";

const root = path.resolve(__dirname, "..", "..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function repoExists(relativePath: string): boolean {
  return existsSync(path.join(root, relativePath));
}

describe("Snag Triage job is retired", () => {
  it("has no route", () => {
    expect(repoExists("app/api/ai/snag/triage/route.ts")).toBe(false);
    expect(repoExists("app/api/ai/snag")).toBe(false);
  });

  it("has no Gemini classifier, dispatcher, or contract module", () => {
    expect(repoExists("lib/store-ops/ai-snag-triage.ts")).toBe(false);
    expect(repoExists("lib/store-ops/snag-dispatch.ts")).toBe(false);
    expect(repoExists("lib/ai/contracts/snag-triage.ts")).toBe(false);
  });

  it("leaves no client helper that could reach the retired route", () => {
    const client = readRepo("lib/store-ops/client.ts");
    expect(client).not.toMatch(/triageSnagReport|SnagTriageClientResult/);
    expect(client).not.toMatch(/api\/ai\/snag/);
  });

  it("was not replaced by a deterministic Snag Triage surface", () => {
    // The retired fallback (buildLocalSnagTriage) must not reappear anywhere.
    expect(repoExists("lib/store-ops/snag-triage.ts")).toBe(false);
    expect(repoExists("lib/store-ops/local-snag-triage.ts")).toBe(false);
  });

  it("is absent from the offline replay surface", () => {
    // The sync queue replays a closed enum of actions; none may be a snag action.
    const queue = readRepo("lib/sync-queue.ts");
    expect(queue).not.toMatch(/snag/i);
  });
});

describe("workflows that own the three written tables are untouched", () => {
  it("keeps the Flag Downstock workflow and its queue contract", () => {
    const downstock = readRepo("lib/store-ops/downstock.ts");
    expect(downstock).toMatch(/downstock_queue/);
    expect(downstock).toMatch(/export async function flagForDownstock/);
    expect(downstock).toMatch(/export async function clearDownstockFlag/);
    expect(DOWNSTOCK_EVENT).toBe("deptsync:downstock-queue");

    const map: DownstockMap = {
      a: {
        rotation_id: "a",
        resolved_at: null,
      } as DownstockMap[string],
      b: {
        rotation_id: "b",
        resolved_at: "2026-09-08T00:00:00.000Z",
      } as DownstockMap[string],
    };
    expect(Object.keys(activeDownstockFlags(map))).toEqual(["a"]);
  });

  it("keeps the rotation barrier / exception workflow", () => {
    const verification = readRepo("lib/store-ops/verification.ts");
    expect(verification).toMatch(/export async function reportRotationBarriers/);
    expect(verification).toMatch(/export async function listRotationExceptions/);
    expect(repoExists("app/api/rotations/exceptions/route.ts")).toBe(true);
    // Human-owned barrier vocabulary survives retirement unchanged.
    expect(EXCEPTION_REASONS.length).toBeGreaterThan(0);
    expect(QUICK_BARRIER_REASONS.length).toBeGreaterThan(0);
    for (const reason of QUICK_BARRIER_REASONS) {
      expect(EXCEPTION_REASONS).toContain(reason);
    }
  });

  it("keeps the shift walk task workflow", () => {
    const tasks = readRepo("lib/store-ops/shift-tasks.ts");
    expect(tasks).toMatch(/shift_walk_tasks/);
    expect(tasks).toMatch(/export async function dispatchShiftWalkTasks/);
    expect(tasks).toMatch(/export async function resolveShiftWalkTask/);
    expect(SHIFT_TASKS_EVENT).toBe("deptsync:shift-walk-tasks");

    const rows = [
      { id: "1", status: "open" },
      { id: "2", status: "resolved" },
    ] as Parameters<typeof openShiftWalkTasks>[0];
    expect(openShiftWalkTasks(rows).map((r) => r.id)).toEqual(["1"]);
  });

  it("keeps shared helpers the retired dispatcher borrowed", () => {
    // createWalkTaskId belongs to Walk & Talk, not to Snag Triage.
    expect(typeof createWalkTaskId()).toBe("string");
    expect(createWalkTaskId().length).toBeGreaterThan(0);
    expect(repoExists("lib/store-ops/ai-walk-parse.ts")).toBe(true);
  });

  it("does not introduce any migration or cleanup of historical rows", () => {
    const changedTables = ["downstock_queue", "rotation_exceptions", "shift_walk_tasks"];
    for (const table of changedTables) {
      // No delete-by-provenance cleanup may exist for snag-created rows.
      const hits = [
        "lib/store-ops/downstock.ts",
        "lib/store-ops/verification.ts",
        "lib/store-ops/shift-tasks.ts",
      ].filter((f) => readRepo(f).includes(`source: "snag_triage"`));
      expect(hits).toEqual([]);
      expect(table).toBeTruthy();
    }
  });
});

describe("Gemini surface after retirement", () => {
  it("removes the Snag Triage Gemini path only", () => {
    expect(repoExists("lib/store-ops/ai-snag-triage.ts")).toBe(false);
  });

  it("preserves the shared transport and its shared token budgets", () => {
    const gemini = readRepo("lib/ai/gemini.ts");
    expect(gemini).toMatch(/callGeminiFlashJson/);
    // `copilot` is shared with Floor-Walk Copilot and Executive Floor Pad.
    expect(gemini).toMatch(/^\s*copilot:/m);
  });

  it("leaves unrelated Gemini capabilities in place", () => {
    for (const route of [
      "app/api/ai/bay-audit/validate/route.ts",
      "app/api/copilot/parse-walk/route.ts",
      "app/api/flooring/ai-insights/route.ts",
      "app/api/store-locations/ai-parse/route.ts",
      "app/api/store-ops/ai-bay-scan/route.ts",
    ]) {
      expect(repoExists(route)).toBe(true);
    }
    expect(repoExists("lib/ai/contracts/bay-audit.ts")).toBe(true);
  });

  it("keeps prior reductions closed rather than reopening them", () => {
    expect(repoExists("app/api/store-health/ai-summary/route.ts")).toBe(false);
    expect(repoExists("app/api/catalog/ai-taxonomy/route.ts")).toBe(false);
  });
});
