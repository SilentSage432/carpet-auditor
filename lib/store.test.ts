import { describe, expect, it } from "vitest";
import {
  adoptStoreNumberFromSpecialist,
  formatStoreLabel,
  normalizeStoreNumber,
  resolveActiveStoreNumber,
  setStoreNumber,
} from "@/lib/store";

describe("store identity resolution", () => {
  it("formatStoreLabel shows set-store copy only when blank", () => {
    expect(formatStoreLabel("")).toBe("Lowe's (set store #)");
    expect(formatStoreLabel("2587")).toBe("Lowe's #2587");
  });

  it("resolveActiveStoreNumber prefers device store over profile", () => {
    setStoreNumber("02587");
    expect(resolveActiveStoreNumber("9999")).toBe("02587");
    setStoreNumber("");
    expect(resolveActiveStoreNumber("2587")).toBe("2587");
    expect(resolveActiveStoreNumber("")).toBe("");
  });

  it("adoptStoreNumberFromSpecialist writes profile store when device unset", () => {
    setStoreNumber("");
    const adopted = adoptStoreNumberFromSpecialist("2587");
    expect(adopted).toBe("2587");
    expect(normalizeStoreNumber(resolveActiveStoreNumber())).toBe("2587");
    setStoreNumber("");
  });
});
