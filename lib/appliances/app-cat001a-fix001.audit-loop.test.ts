/**
 * APP-CAT-001A-FIX-001 — active-audit read/render loop regression.
 *
 * Field evidence: with an ACTIVE physical audit the Appliances home re-fired audit
 * GETs forever. The cycle was:
 *
 *   parent render → new inline onStatus identity → refresh useCallback invalidated
 *   → useEffect([refresh]) → audit GETs → onActiveSessionChange(fresh session object)
 *   → parent setState → parent render → ...
 *
 * These tests render the real panel inside a harness that deliberately reproduces
 * the unstable-prop condition, so they fail against the proven old behaviour.
 * `refresh` is never mocked away — only the network boundary is.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applianceAuditSessionSignal,
  type ApplianceAuditSession,
} from "@/lib/appliances/physical-audit";

const root = process.cwd();

function readRepo(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

/** Always a NEW object — reproduces freshly parsed API responses. */
function activeSession(
  id = "audit-active-1",
  status: "ACTIVE" | "CLOSED" = "ACTIVE"
): ApplianceAuditSession {
  return {
    id,
    store_number: "2587",
    status,
    started_at: "2026-09-07T14:00:00.000Z",
    closed_at: null,
    started_by: "Tyson",
    closed_by: null,
    notes: "",
    created_at: "2026-09-07T14:00:00.000Z",
  };
}

const fetchApplianceAuditSessions = vi.fn();
const fetchApplianceAuditDetail = vi.fn();
const fetchApplianceAuditConsiderations = vi.fn();

vi.mock("@/lib/appliances/audit-client", () => ({
  fetchApplianceAuditSessions: (...args: unknown[]) =>
    fetchApplianceAuditSessions(...args),
  fetchApplianceAuditDetail: (...args: unknown[]) =>
    fetchApplianceAuditDetail(...args),
  fetchApplianceAuditConsiderations: (...args: unknown[]) =>
    fetchApplianceAuditConsiderations(...args),
  closeAppliancePhysicalAudit: vi.fn(),
  saveApplianceReconciliation: vi.fn(),
  startAppliancePhysicalAudit: vi.fn(),
}));

vi.mock("@/components/hub/HubPortal", () => ({
  HubPortal: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("@/components/appliances/ApplianceAuditConsiderationList", () => ({
  ApplianceAuditConsiderationList: () =>
    React.createElement("div", { "data-testid": "considerations" }),
}));

vi.mock("@/components/ui/NumberField", () => ({
  NumberField: () => React.createElement("input"),
  TextField: () => React.createElement("input"),
}));

let container: HTMLDivElement | null = null;
let reactRoot: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  fetchApplianceAuditSessions.mockReset();
  fetchApplianceAuditDetail.mockReset();
  fetchApplianceAuditConsiderations.mockReset();

  // Every call returns a brand-new object graph, as real JSON parsing would.
  fetchApplianceAuditSessions.mockImplementation(
    async (input?: { status?: string }) => {
      if (input?.status === "ACTIVE") return [activeSession()];
      return [activeSession()];
    }
  );
  fetchApplianceAuditConsiderations.mockResolvedValue({
    items: [],
    eligible_count: 0,
  });
  fetchApplianceAuditDetail.mockResolvedValue({
    session: activeSession(),
    physical_items: [],
    snapshots: [],
    summary: { reconciliation: null },
  });

  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  if (reactRoot) {
    const current = reactRoot;
    await act(async () => {
      current.unmount();
    });
    reactRoot = null;
  }
  container?.remove();
  container = null;
});

/** Let queued microtasks/promises drain so a loop has room to manifest. */
async function settle(cycles = 12): Promise<void> {
  for (let i = 0; i < cycles; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

type Harness = {
  element: React.ReactElement;
  statusCalls: string[];
  sessionCalls: (ApplianceAuditSession | null)[];
  forceRerender: () => void;
};

/**
 * Reproduces the exact parent shape that caused the field loop:
 * an inline arrow for onStatus (new identity every render) plus an active-session
 * write-back that re-renders the parent.
 */
function buildHarness(
  PanelComponent: React.ComponentType<Record<string, unknown>>
): Harness {
  const statusCalls: string[] = [];
  const sessionCalls: (ApplianceAuditSession | null)[] = [];
  let bumpTick: () => void = () => undefined;

  function Parent() {
    const [, setActiveAudit] = React.useState<ApplianceAuditSession | null>(
      null
    );
    const [, setTick] = React.useState(0);
    bumpTick = () => setTick((n) => n + 1);

    return React.createElement(PanelComponent, {
      // Deliberately unstable: this is the proven field condition.
      onStatus: (msg: string) => {
        statusCalls.push(msg);
      },
      onActiveSessionChange: (session: ApplianceAuditSession | null) => {
        sessionCalls.push(session);
        setActiveAudit(session);
      },
      onStarted: () => undefined,
      onContinueScanning: () => undefined,
    });
  }

  return {
    element: React.createElement(Parent),
    statusCalls,
    sessionCalls,
    forceRerender: () => bumpTick(),
  };
}

async function mount(element: React.ReactElement): Promise<void> {
  await act(async () => {
    reactRoot = createRoot(container!);
    reactRoot.render(element);
  });
  await settle();
}

describe("APP-CAT-001A-FIX-001 active-audit loop", () => {
  it("settles after one load even when parent callbacks are unstable", async () => {
    const { AppliancePhysicalAuditPanel } = await import(
      "@/components/appliances/AppliancePhysicalAuditPanel"
    );
    const harness = buildHarness(
      AppliancePhysicalAuditPanel as unknown as React.ComponentType<
        Record<string, unknown>
      >
    );

    await mount(harness.element);

    // refresh() issues exactly two session reads (ACTIVE + ALL) per load.
    // The old behaviour produced an unbounded, ever-growing count here.
    expect(fetchApplianceAuditSessions.mock.calls.length).toBeLessThanOrEqual(2);
    expect(fetchApplianceAuditConsiderations.mock.calls.length).toBe(1);
  });

  it("does not refetch when the parent re-renders repeatedly", async () => {
    const { AppliancePhysicalAuditPanel } = await import(
      "@/components/appliances/AppliancePhysicalAuditPanel"
    );
    const harness = buildHarness(
      AppliancePhysicalAuditPanel as unknown as React.ComponentType<
        Record<string, unknown>
      >
    );

    await mount(harness.element);
    const afterMount = fetchApplianceAuditSessions.mock.calls.length;

    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        harness.forceRerender();
      });
    }
    await settle();

    expect(fetchApplianceAuditSessions.mock.calls.length).toBe(afterMount);
  });

  it("publishes the ACTIVE session upward exactly once per identity", async () => {
    const { AppliancePhysicalAuditPanel } = await import(
      "@/components/appliances/AppliancePhysicalAuditPanel"
    );
    const harness = buildHarness(
      AppliancePhysicalAuditPanel as unknown as React.ComponentType<
        Record<string, unknown>
      >
    );

    await mount(harness.element);

    expect(harness.sessionCalls.length).toBe(1);
    expect(harness.sessionCalls[0]?.id).toBe("audit-active-1");
  });

  it("no active audit settles without publishing a session change", async () => {
    fetchApplianceAuditSessions.mockImplementation(async () => []);

    const { AppliancePhysicalAuditPanel } = await import(
      "@/components/appliances/AppliancePhysicalAuditPanel"
    );
    const harness = buildHarness(
      AppliancePhysicalAuditPanel as unknown as React.ComponentType<
        Record<string, unknown>
      >
    );

    await mount(harness.element);

    expect(fetchApplianceAuditSessions.mock.calls.length).toBeLessThanOrEqual(2);
    // null → null is not a meaningful transition.
    expect(harness.sessionCalls.length).toBe(0);
  });
});

describe("APP-CAT-001A-FIX-001 active-session identity", () => {
  it("re-parsed identical sessions share one signal", () => {
    expect(applianceAuditSessionSignal(activeSession())).toBe(
      applianceAuditSessionSignal(activeSession())
    );
  });

  it("propagates null → ACTIVE", () => {
    expect(applianceAuditSessionSignal(null)).not.toBe(
      applianceAuditSessionSignal(activeSession())
    );
  });

  it("propagates ACTIVE A → ACTIVE B", () => {
    expect(applianceAuditSessionSignal(activeSession("a"))).not.toBe(
      applianceAuditSessionSignal(activeSession("b"))
    );
  });

  it("propagates ACTIVE → null", () => {
    expect(applianceAuditSessionSignal(activeSession())).not.toBe(
      applianceAuditSessionSignal(null)
    );
  });

  it("propagates ACTIVE → CLOSED for the same id", () => {
    expect(applianceAuditSessionSignal(activeSession("a", "ACTIVE"))).not.toBe(
      applianceAuditSessionSignal(activeSession("a", "CLOSED"))
    );
  });
});

describe("APP-CAT-001A-FIX-001 loop guard wiring", () => {
  const panel = readRepo(
    "components/appliances/AppliancePhysicalAuditPanel.tsx"
  );
  const section = readRepo("components/sections/ApplianceAuditSection.tsx");

  it("refresh no longer depends on caller-supplied callback identity", () => {
    expect(panel).toContain("onStatusRef");
    expect(panel).toContain("onActiveSessionChangeRef");
    expect(panel).toContain(
      "}, [loadConsiderations, loadRecentCards, publishActiveSession]);"
    );
    expect(panel).not.toMatch(
      /\}, \[loadConsiderations, loadRecentCards, onActiveSessionChange, onStatus\]/
    );
  });

  it("active-session write-back is guarded by semantic identity", () => {
    expect(panel).toContain("applianceAuditSessionSignal");
    expect(panel).toContain("activeSignalRef");
    expect(panel).toContain("publishActiveSession");
  });

  it("section passes stable callbacks to the physical audit panel", () => {
    expect(section).toContain("onStatus={flashStatus}");
    expect(section).toContain("onContinueScanning={handleContinueScanning}");
    expect(section).toContain("onStarted={handleAuditStarted}");
    expect(section).not.toMatch(
      /onStatus=\{\(msg, tone = "ok"\) => flashStatus\(msg, tone\)\}[\s\S]{0,200}reviewFinishToken/
    );
  });

  it("repair introduces no polling", () => {
    expect(panel).not.toMatch(/setInterval|setTimeout\([^)]*refresh/);
  });
});
