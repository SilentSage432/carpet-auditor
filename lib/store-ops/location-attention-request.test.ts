/**
 * Attention request-token race tests.
 */

import { describe, expect, it } from "vitest";
import {
  isAttentionResponseCurrent,
  nextAttentionRequestToken,
} from "./location-attention-request";

describe("attention request race token", () => {
  it("rejects late prior-department responses", () => {
    const a = nextAttentionRequestToken(0, "dept-a");
    const b = nextAttentionRequestToken(a.generation, "dept-b");
    expect(isAttentionResponseCurrent(a, b.generation, "dept-b")).toBe(false);
    expect(isAttentionResponseCurrent(b, b.generation, "dept-b")).toBe(true);
  });

  it("rejects stale generation on same department (reload race)", () => {
    const first = nextAttentionRequestToken(0, "dept-a");
    const second = nextAttentionRequestToken(first.generation, "dept-a");
    expect(
      isAttentionResponseCurrent(first, second.generation, "dept-a")
    ).toBe(false);
    expect(
      isAttentionResponseCurrent(second, second.generation, "dept-a")
    ).toBe(true);
  });

  it("state-write gate: resolved token cannot commit after generation advances", () => {
    // Simulate: request #1 resolves after request #2 already updated generation.
    let generation = 0;
    const req1 = nextAttentionRequestToken(generation, "dept-a");
    generation = req1.generation;
    const req2 = nextAttentionRequestToken(generation, "dept-a");
    generation = req2.generation;
    // Late req1 must not write
    expect(isAttentionResponseCurrent(req1, generation, "dept-a")).toBe(false);
    expect(isAttentionResponseCurrent(req2, generation, "dept-a")).toBe(true);
  });
});
