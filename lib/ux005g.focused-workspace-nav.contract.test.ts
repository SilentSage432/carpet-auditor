/**
 * UX-005G — focused workspace navigation suppression.
 *
 * Field evidence (Samsung DS device): the persistent bottom nav stayed visible
 * inside Edit Bay, the Team Roster associate editor, Department Taxonomies,
 * Associates On Duty, and the Sunday Rotation Engine, overlapping the very
 * controls the operator was reaching for. Art. XVI: persistent application
 * chrome MUST never make operational work unreachable.
 *
 * Two layers of proof:
 *   1. Behavioral — the shared occupancy mechanism and its restoration paths
 *      are rendered for real, including coexisting workspaces.
 *   2. Wiring contract — each field-proven surface declares occupancy from its
 *      own open signal, and NavigationHub is the only place that maps occupancy
 *      onto BottomNav.
 *
 * UX-005G.1 added Roster → Add Team Member on later Samsung evidence. It was
 * classified ambiguous during UX-005G archaeology and deliberately left alone
 * until the device resolved it. No new mechanism was introduced.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireFocusedWorkspace,
  focusedWorkspaceCount,
  useFocusedWorkspace,
  useFocusedWorkspaceActive,
} from "@/lib/ui/focused-workspace";

const root = path.resolve(__dirname, "..");

function readRepo(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

const NAV_SELECTOR = 'nav[aria-label="Primary workflow"]';

let container: HTMLDivElement | null = null;
let reactRoot: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
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
  // A leaked claim would silently hide chrome for every later assertion.
  expect(focusedWorkspaceCount()).toBe(0);
});

/** Mirrors the NavigationHub gate: chrome stands down while a workspace owns the viewport. */
function NavProbe() {
  const focused = useFocusedWorkspaceActive();
  return focused
    ? null
    : React.createElement("nav", { "aria-label": "Primary workflow" }, "Floor");
}

/** Mount-gated surface (Edit Bay, roster editor): mount is the open signal. */
function MountGatedWorkspace() {
  useFocusedWorkspace();
  return null;
}

/** Prop-gated surface (Taxonomies, On Duty, Sunday): `open` is the signal. */
function PropGatedWorkspace({ open }: { open: boolean }) {
  useFocusedWorkspace(open);
  return null;
}

async function mount(element: React.ReactElement): Promise<void> {
  await act(async () => {
    reactRoot = createRoot(container!);
    reactRoot.render(element);
  });
}

async function rerender(element: React.ReactElement): Promise<void> {
  await act(async () => {
    reactRoot!.render(element);
  });
}

function navVisible(): boolean {
  return container!.querySelector(NAV_SELECTOR) !== null;
}

describe("UX-005G occupancy mechanism", () => {
  it("A. normal hub state renders the bottom nav", async () => {
    await mount(React.createElement(NavProbe));
    expect(navVisible()).toBe(true);
    expect(focusedWorkspaceCount()).toBe(0);
  });

  it("B/C. a mount-gated focused workspace hides the nav and restores it on close", async () => {
    function Tree({ open }: { open: boolean }) {
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(NavProbe, { key: "nav" }),
        open ? React.createElement(MountGatedWorkspace, { key: "ws" }) : null
      );
    }

    await mount(React.createElement(Tree, { open: false }));
    expect(navVisible()).toBe(true);

    await rerender(React.createElement(Tree, { open: true }));
    expect(navVisible()).toBe(false);
    expect(focusedWorkspaceCount()).toBe(1);

    await rerender(React.createElement(Tree, { open: false }));
    expect(navVisible()).toBe(true);
    expect(focusedWorkspaceCount()).toBe(0);
  });

  it("B/C. a prop-gated focused workspace hides the nav and restores it on close", async () => {
    function Tree({ open }: { open: boolean }) {
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(NavProbe, { key: "nav" }),
        // Host stays mounted across open/close, like SundayAuditStagingCard.
        React.createElement(PropGatedWorkspace, { key: "ws", open })
      );
    }

    await mount(React.createElement(Tree, { open: false }));
    expect(navVisible()).toBe(true);

    await rerender(React.createElement(Tree, { open: true }));
    expect(navVisible()).toBe(false);

    await rerender(React.createElement(Tree, { open: false }));
    expect(navVisible()).toBe(true);
  });

  it("I. unmounting the whole shell cannot leave the nav hidden", async () => {
    await mount(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(NavProbe, { key: "nav" }),
        React.createElement(MountGatedWorkspace, { key: "ws" })
      )
    );
    expect(navVisible()).toBe(false);

    await act(async () => {
      reactRoot!.unmount();
    });
    reactRoot = null;

    // Occupancy released by effect cleanup, so the next shell renders chrome.
    expect(focusedWorkspaceCount()).toBe(0);
    await mount(React.createElement(NavProbe));
    expect(navVisible()).toBe(true);
  });

  it("J. closing a nested workspace keeps the nav hidden while the parent owns the viewport", async () => {
    function Tree({ parent, child }: { parent: boolean; child: boolean }) {
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(NavProbe, { key: "nav" }),
        parent
          ? React.createElement(
              React.Fragment,
              { key: "parent" },
              React.createElement(MountGatedWorkspace, { key: "p" }),
              // SpecialistEditSheet opens its pairing dialog while staying open.
              child ? React.createElement(MountGatedWorkspace, { key: "c" }) : null
            )
          : null
      );
    }

    await mount(React.createElement(Tree, { parent: true, child: true }));
    expect(focusedWorkspaceCount()).toBe(2);
    expect(navVisible()).toBe(false);

    await rerender(React.createElement(Tree, { parent: true, child: false }));
    expect(focusedWorkspaceCount()).toBe(1);
    expect(navVisible()).toBe(false);

    await rerender(React.createElement(Tree, { parent: false, child: false }));
    expect(focusedWorkspaceCount()).toBe(0);
    expect(navVisible()).toBe(true);
  });

  it("releases are idempotent so a double-release cannot un-hide a live workspace", () => {
    const releaseA = acquireFocusedWorkspace();
    const releaseB = acquireFocusedWorkspace();
    expect(focusedWorkspaceCount()).toBe(2);

    releaseA();
    releaseA();
    expect(focusedWorkspaceCount()).toBe(1);

    releaseB();
    expect(focusedWorkspaceCount()).toBe(0);
  });
});

describe("UX-005G Associates On Duty (rendered surface)", () => {
  it("G. opening the on-duty sheet claims the viewport; closing releases it", async () => {
    const { OnDutyAssociateStrip } = await import(
      "@/components/store-ops/OnDutyAssociateStrip"
    );

    function Tree({ open }: { open: boolean }) {
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(NavProbe, { key: "nav" }),
        React.createElement(
          OnDutyAssociateStrip as React.ComponentType<Record<string, unknown>>,
          {
            key: "strip",
            groups: [],
            selectedId: "all",
            onSelect: () => undefined,
            storewide: true,
            hideStrip: true,
            sheetOpen: open,
            onSheetOpenChange: () => undefined,
          }
        )
      );
    }

    await mount(React.createElement(Tree, { open: false }));
    expect(navVisible()).toBe(true);

    await rerender(React.createElement(Tree, { open: true }));
    expect(navVisible()).toBe(false);
    expect(
      container!.querySelector('[aria-labelledby="on-duty-sheet-title"]')
    ).not.toBeNull();

    await rerender(React.createElement(Tree, { open: false }));
    expect(navVisible()).toBe(true);
  });
});

describe("UX-005G shell ownership", () => {
  it("NavigationHub is the only surface that maps occupancy onto BottomNav", () => {
    const hub = readRepo("components/hub/NavigationHub.tsx");
    expect(hub).toContain("useFocusedWorkspaceActive");
    expect(hub).toContain(
      "showBottomNav && !focusedWorkspaceOpen && primaryLinks.length > 0"
    );

    // BottomNav itself stays a dumb renderer — no visibility logic of its own.
    const bottom = readRepo("components/hub/BottomNav.tsx");
    expect(bottom).not.toContain("focused");
    expect(bottom).not.toContain("display: none");
  });

  it("no surface hides the nav with its own ad-hoc hack", () => {
    for (const rel of [
      "components/admin/EditBayDrawer.tsx",
      "components/hub/SpecialistEditSheet.tsx",
      "components/catalog/TaxonomyManagerModal.tsx",
      "components/store-ops/OnDutyAssociateStrip.tsx",
      "components/admin/SundayAuditAssignmentModal.tsx",
      "components/hub/tabs/RosterTab.tsx",
    ]) {
      const code = readRepo(rel);
      expect(code).not.toContain("hub-bottom-nav");
      expect(code).not.toContain("showBottomNav");
      expect(code).not.toContain("display: none");
    }
  });

  it("the top header is not suppressed — store/department/identity stay visible", () => {
    const hub = readRepo("components/hub/NavigationHub.tsx");
    // The sticky header block carries no occupancy condition.
    expect(hub).toMatch(/sticky top-0 z-40 shrink-0 pt-safe/);
    expect(hub).not.toMatch(/focusedWorkspaceOpen[\s\S]{0,80}HubHeader/);
  });
});

describe("UX-005G surface integration", () => {
  const SURFACES: Array<{ label: string; file: string; signal: string }> = [
    {
      label: "D. Edit Bay",
      file: "components/admin/EditBayDrawer.tsx",
      // Conditionally rendered by AisleBayManager — mount is the open signal.
      signal: "useFocusedWorkspace()",
    },
    {
      label: "E. Team Roster associate editor",
      file: "components/hub/SpecialistEditSheet.tsx",
      signal: "useFocusedWorkspace()",
    },
    {
      label: "F. Department Taxonomies",
      file: "components/catalog/TaxonomyManagerModal.tsx",
      signal: "useFocusedWorkspace(open)",
    },
    {
      label: "G. Associates On Duty",
      file: "components/store-ops/OnDutyAssociateStrip.tsx",
      signal: "useFocusedWorkspace(sheetOpen)",
    },
    {
      label: "H. Sunday Rotation Engine",
      file: "components/admin/SundayAuditAssignmentModal.tsx",
      signal: "useFocusedWorkspace(open)",
    },
    {
      // UX-005G.1 — field-proven later; same mount-gated pattern as D and E.
      label: "K. Add Team Member",
      file: "components/hub/tabs/RosterTab.tsx",
      signal: "useFocusedWorkspace()",
    },
  ];

  for (const surface of SURFACES) {
    it(`${surface.label} declares focused-workspace occupancy`, () => {
      const code = readRepo(surface.file);
      expect(code).toContain('from "@/lib/ui/focused-workspace"');
      expect(code).toContain(surface.signal);
    });
  }

  it("prop-gated surfaces claim occupancy before their early return", () => {
    for (const rel of [
      "components/catalog/TaxonomyManagerModal.tsx",
      "components/admin/SundayAuditAssignmentModal.tsx",
    ]) {
      const code = readRepo(rel);
      const hookAt = code.indexOf("useFocusedWorkspace(open)");
      const bailAt = code.indexOf("if (!open) return null;");
      expect(hookAt).toBeGreaterThan(-1);
      expect(bailAt).toBeGreaterThan(-1);
      expect(hookAt).toBeLessThan(bailAt);
    }
  });

  it("the two nav-dependent sheets now clear the device safe area themselves", () => {
    // Both previously relied on the nav as an accidental bottom spacer.
    for (const rel of [
      "components/catalog/TaxonomyManagerModal.tsx",
      "components/admin/SundayAuditAssignmentModal.tsx",
    ]) {
      const code = readRepo(rel);
      expect(code).toContain("hub-modal-sheet");
    }
    const css = readRepo("app/globals.css");
    expect(css).toContain(".hub-modal-sheet");
    expect(css).toContain("safe-area-inset-bottom");
  });
});

describe("UX-005G.1 Add Team Member", () => {
  const ROSTER = "components/hub/tabs/RosterTab.tsx";

  it("claims occupancy inside the sheet, not in the always-mounted tab body", () => {
    const code = readRepo(ROSTER);
    const sheetAt = code.indexOf("function AddTeamMemberSheet(");
    const hookAt = code.indexOf("useFocusedWorkspace()");
    expect(sheetAt).toBeGreaterThan(-1);
    expect(hookAt).toBeGreaterThan(-1);
    /**
     * WorkflowTabShell keeps RosterTab mounted for the whole session, so a
     * claim in the tab body would hide the nav permanently. It must sit inside
     * the conditionally-rendered sheet.
     */
    expect(hookAt).toBeGreaterThan(sheetAt);
    expect(code.split("useFocusedWorkspace()").length - 1).toBe(1);
  });

  it("is mount-gated, which is why it uses the argument-free pattern", () => {
    const code = readRepo(ROSTER);
    expect(code).toContain("{addOpen ? (");
    expect(code).toContain("<AddTeamMemberSheet");
    expect(code).toContain("onClose={() => setAddOpen(false)}");
    // No `open` prop exists on this sheet, so there is no signal to pass.
    expect(code).not.toContain("useFocusedWorkspace(addOpen)");
  });

  it("routes every exit through onClose so cleanup restores the nav", () => {
    const code = readRepo(ROSTER);
    const sheet = code.slice(code.indexOf("function AddTeamMemberSheet("));
    // Backdrop, Cancel, and a successful add all unmount via the same callback.
    expect(sheet).toContain('aria-label="Close add team member"');
    expect(sheet).toContain("onClick={onClose}");
    expect(sheet).toMatch(/await onCreated\(created\);\s*\n\s*onClose\(\);/);
    // No bespoke restoration path.
    expect(sheet).not.toContain("onShowNav");
    expect(sheet).not.toContain("releaseFocusedWorkspace");
    expect(sheet).not.toContain("acquireFocusedWorkspace");
  });

  it("keeps its own device safe-area padding and gains no nav compensation", () => {
    const code = readRepo(ROSTER);
    const sheet = code.slice(code.indexOf("function AddTeamMemberSheet("));
    // Already correct before UX-005G.1 — deliberately left unchanged.
    expect(sheet).toContain("pb-[max(1rem,env(safe-area-inset-bottom))]");
    expect(sheet).not.toContain("hub-workspace-pad-bottom");
    expect(sheet).not.toContain("hub-bottom-nav-stack");
  });

  it("adds no second occupancy store", () => {
    const store = readRepo("lib/ui/focused-workspace.ts");
    expect(store).toContain("let occupancy = 0");
    // One counter, one subscribe, one hook pair — unchanged by UX-005G.1.
    expect(store.split("let occupancy").length - 1).toBe(1);
    const code = readRepo(ROSTER);
    expect(code).not.toContain("createContext");
    expect(code).not.toContain("useSyncExternalStore");
  });
});

describe("UX-005G preserves prior mobile work", () => {
  it("UX-004C stacking contract is untouched", () => {
    const shell = readRepo("components/hub/WorkflowTabShell.tsx");
    expect(shell).toMatch(/active \? "z-10"/);
    expect(shell).not.toMatch(/active \? "z-40"/);

    const css = readRepo("app/globals.css");
    expect(css).toContain(".hub-bottom-nav");
    expect(css).toMatch(/z-30/);

    const portal = readRepo("components/hub/HubPortal.tsx");
    expect(portal).toContain("createPortal");
    expect(portal).toContain("document.body");
  });

  it("BottomNav IA is unchanged — Floor / Map / Roster / More", () => {
    const nav = readRepo("lib/nav-hub.ts");
    expect(nav).toContain('shortLabel: "Floor"');
    expect(nav).toContain('shortLabel: "Map"');
    expect(nav).toContain('shortLabel: "Roster"');
    expect(nav).toContain('shortLabel: "More"');
  });

  it("UX-004B history semantics are not co-opted for close-on-back", () => {
    const investigation = readRepo("lib/store-ops/map-attention-investigation.ts");
    expect(investigation).toMatch(/history\.replaceState\(window\.history\.state,\s*""/);

    // Suppression rides effect cleanup, never a pushed history entry.
    const store = readRepo("lib/ui/focused-workspace.ts");
    expect(store).not.toContain("pushState");
    expect(store).not.toContain("popstate");
  });

  it("occupancy stays presentation-only — no ops, data, or auth coupling", () => {
    const store = readRepo("lib/ui/focused-workspace.ts");
    expect(store).not.toContain("supabase");
    expect(store).not.toContain("rotation");
    expect(store).not.toContain("verification");
    expect(store).not.toContain("fetch(");
  });
});
