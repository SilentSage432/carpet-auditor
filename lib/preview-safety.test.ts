/**
 * Preview write-guard contracts — shared production DB must not accept mutations.
 */

import { describe, expect, it } from "vitest";
import {
  isPreviewMutationAllowlistedPath,
  isVercelPreviewRuntime,
  shouldBlockPreviewMutation,
} from "./preview-safety";

describe("preview-safety", () => {
  it("detects Vercel preview runtime only", () => {
    expect(isVercelPreviewRuntime({ VERCEL_ENV: "preview" })).toBe(true);
    expect(isVercelPreviewRuntime({ VERCEL_ENV: "production" })).toBe(false);
    expect(isVercelPreviewRuntime({ VERCEL_ENV: "development" })).toBe(false);
    expect(isVercelPreviewRuntime({})).toBe(false);
  });

  it("allowlists auth/invite writes", () => {
    expect(isPreviewMutationAllowlistedPath("/api/auth/gate")).toBe(true);
    expect(isPreviewMutationAllowlistedPath("/api/invite/x")).toBe(true);
    expect(isPreviewMutationAllowlistedPath("/api/section-week-coverage")).toBe(
      false
    );
  });

  it("blocks coverage/roster/cron mutations in preview", () => {
    const env = { VERCEL_ENV: "preview" };
    expect(
      shouldBlockPreviewMutation({
        method: "POST",
        pathname: "/api/section-week-coverage",
        env,
      })
    ).toBe(true);
    expect(
      shouldBlockPreviewMutation({
        method: "DELETE",
        pathname: "/api/roster/lifecycle/x",
        env,
      })
    ).toBe(true);
    expect(
      shouldBlockPreviewMutation({
        method: "GET",
        pathname: "/api/cron/weekly-rotation",
        env,
      })
    ).toBe(true);
  });

  it("allows GET reads and auth POSTs in preview", () => {
    const env = { VERCEL_ENV: "preview" };
    expect(
      shouldBlockPreviewMutation({
        method: "GET",
        pathname: "/api/section-week-coverage",
        env,
      })
    ).toBe(false);
    expect(
      shouldBlockPreviewMutation({
        method: "POST",
        pathname: "/api/auth/gate",
        env,
      })
    ).toBe(false);
  });

  it("does not block production mutations", () => {
    expect(
      shouldBlockPreviewMutation({
        method: "POST",
        pathname: "/api/section-week-coverage",
        env: { VERCEL_ENV: "production" },
      })
    ).toBe(false);
  });
});
