/**
 * UX-004C.1 Executive Floor Pad handoff — durable navigation intent.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildExecutiveFloorPadHref,
  EXECUTIVE_FLOOR_PAD_BARE_HREF,
  EXECUTIVE_FLOOR_PAD_OPEN_EVENT,
  EXECUTIVE_FLOOR_PAD_OPEN_PARAM,
  EXECUTIVE_FLOOR_PAD_OPEN_VALUE,
  isExecutiveFloorPadFloorPath,
  isExecutiveFloorPadHash,
  isExecutiveFloorPadOpenIntent,
  requestApplianceScanner,
  requestExecutiveFloorPad,
  requestRemnantCalculator,
  syncExecutiveFloorPadIntentConsumedUrl,
  APPLIANCE_SCANNER_OPEN_EVENT,
  REMNANT_CALCULATOR_OPEN_EVENT,
} from "@/lib/specialty-tools";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("UX-004C.1 Executive Floor Pad durable handoff", () => {
  it("builds a durable query intent (not ephemeral pre-nav event)", () => {
    const href = buildExecutiveFloorPadHref();
    expect(href).toBe(
      `/dashboard?${EXECUTIVE_FLOOR_PAD_OPEN_PARAM}=${EXECUTIVE_FLOOR_PAD_OPEN_VALUE}`
    );
    expect(isExecutiveFloorPadOpenIntent(new URLSearchParams(href.split("?")[1]))).toBe(
      true
    );
    expect(isExecutiveFloorPadOpenIntent(new URLSearchParams())).toBe(false);
    expect(isExecutiveFloorPadHash("#floor-pad")).toBe(true);
    expect(isExecutiveFloorPadHash("#other")).toBe(false);
  });

  it("Floor path gate excludes specialty hub and inactive keep-alive routes", () => {
    expect(isExecutiveFloorPadFloorPath("/dashboard")).toBe(true);
    expect(isExecutiveFloorPadFloorPath("/dashboard/")).toBe(true);
    expect(isExecutiveFloorPadFloorPath("/")).toBe(false);
    expect(isExecutiveFloorPadFloorPath("/settings")).toBe(false);
    expect(isExecutiveFloorPadFloorPath("/admin/store-map")).toBe(false);
    expect(isExecutiveFloorPadFloorPath("/roster")).toBe(false);
  });

  it("bare Floor search params do not match open intent", () => {
    expect(isExecutiveFloorPadOpenIntent(new URLSearchParams())).toBe(false);
    expect(
      isExecutiveFloorPadOpenIntent(
        new URLSearchParams("investigate=current-attention")
      )
    ).toBe(false);
    expect(isExecutiveFloorPadOpenIntent(new URLSearchParams("open=other"))).toBe(
      false
    );
  });

  it("bridge requires Floor pathname + intent; mount alone insufficient", () => {
    const bridge = readRepo(
      "components/hub/ExecutiveFloorPadIntentBridge.tsx"
    );
    expect(bridge).toContain("isExecutiveFloorPadFloorPath(pathname)");
    expect(bridge).toMatch(/Keep-alive Floor stays mounted/);
    expect(bridge).toContain("isExecutiveFloorPadOpenIntent");
    expect(bridge).toContain("isExecutiveFloorPadHash");
    expect(bridge).toContain("lastConsumedKey");
    expect(bridge).toContain("EXECUTIVE_FLOOR_PAD_OPEN_EVENT");
    // Single dispatch then normalize — no setTimeout.
    expect(bridge).not.toContain("setTimeout");
    expect(bridge).toContain("syncExecutiveFloorPadIntentConsumedUrl");
    expect(bridge).toContain("router.replace(EXECUTIVE_FLOOR_PAD_BARE_HREF");
    // One dispatchEvent in the effect body (query+hash share one key path).
    expect(bridge.match(/dispatchEvent/g)?.length).toBe(1);
  });

  it("Floor mounts bridge after Walk & Talk listeners for effect order", () => {
    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    const drawerIdx = floor.indexOf("</ShiftAnalyticsDrawer>");
    const bridgeIdx = floor.indexOf("<ExecutiveFloorPadIntentBridge");
    expect(drawerIdx).toBeGreaterThan(-1);
    expect(bridgeIdx).toBeGreaterThan(drawerIdx);
    expect(floor).toContain("TacticalVoiceFloorPad");
  });

  it("More button soft-navigates with durable href", () => {
    const settings = readRepo("components/sections/SettingsSection.tsx");
    expect(settings).toContain("router.push(buildExecutiveFloorPadHref())");
    expect(settings).not.toContain("requestExecutiveFloorPad()");
    expect(settings).not.toMatch(/location\.assign\(.*floor-pad/);
  });

  it("consume URL sync clears query and hash while preserving history.state", () => {
    const prior = { keep: true };
    const replaceState = vi.fn();
    const href = `${EXECUTIVE_FLOOR_PAD_BARE_HREF}?open=executive-floor-pad#floor-pad`;
    vi.stubGlobal("window", {
      location: new URL(`https://example.test${href}`),
      history: { state: prior, replaceState },
    });
    try {
      syncExecutiveFloorPadIntentConsumedUrl();
      expect(replaceState).toHaveBeenCalledTimes(1);
      expect(replaceState).toHaveBeenCalledWith(
        prior,
        "",
        EXECUTIVE_FLOOR_PAD_BARE_HREF
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("on-Floor request only dispatches open event (no hard reload)", () => {
    const seen: string[] = [];
    const handler = (e: Event) => seen.push(e.type);
    window.addEventListener(EXECUTIVE_FLOOR_PAD_OPEN_EVENT, handler);
    window.history.pushState({}, "", "/dashboard");
    try {
      requestExecutiveFloorPad();
      expect(seen).toEqual([EXECUTIVE_FLOOR_PAD_OPEN_EVENT]);
      expect(window.location.pathname).toBe("/dashboard");
    } finally {
      window.removeEventListener(EXECUTIVE_FLOOR_PAD_OPEN_EVENT, handler);
    }
  });

  it("other specialty request helpers remain event-based", () => {
    const seen: string[] = [];
    const handler = (e: Event) => seen.push(e.type);
    window.addEventListener(APPLIANCE_SCANNER_OPEN_EVENT, handler);
    window.addEventListener(REMNANT_CALCULATOR_OPEN_EVENT, handler);
    try {
      requestApplianceScanner();
      requestRemnantCalculator();
      expect(seen).toEqual([
        APPLIANCE_SCANNER_OPEN_EVENT,
        REMNANT_CALCULATOR_OPEN_EVENT,
      ]);
    } finally {
      window.removeEventListener(APPLIANCE_SCANNER_OPEN_EVENT, handler);
      window.removeEventListener(REMNANT_CALCULATOR_OPEN_EVENT, handler);
    }
  });
});
