/**
 * IRP / down-stocking velocity — cadence tones + auto-tier rules.
 * Presentation renders; rotations.ts consumes isRotationVelocityPriority.
 * Does not persist logs (bay-service.ts) or own weekly last_completed_at.
 */

import { daysSinceIso } from "./bay-health";
import type {
  BayServiceIntensity,
  StoreLocation,
  VelocityTier,
} from "./types";

export const VELOCITY_FRESH_DAYS = 7;
export const VELOCITY_DECAY_DAYS = 18;
export const VELOCITY_AUTO_TIER_WINDOW_DAYS = 30;
export const VELOCITY_AUTO_TIER_HOT_COUNT = 2;
/** Seeded aisle cadence — Standard / High Velocity bulk presets. */
export const VELOCITY_CADENCE_STANDARD_DAYS = 14;
export const VELOCITY_CADENCE_HIGH_DAYS = 5;
export const CUSTOM_DECAY_MIN_DAYS = 3;
export const CUSTOM_DECAY_MAX_DAYS = 21;

export type VelocitySeedPreset = "standard" | "high" | "priority_lock";

export type VelocitySeed = {
  velocity_tier: VelocityTier;
  priority_override: boolean;
  custom_decay_days: number;
};

export type VelocityHeatTone = "fresh" | "decaying" | "untouched" | "hotspot";

export const BAY_SERVICE_INTENSITIES: readonly BayServiceIntensity[] = [
  "light_touch",
  "heavy_packdown",
  "critical_hole",
] as const;

export function parseVelocityTier(
  raw: unknown
): VelocityTier {
  if (raw === "high" || raw === "critical_hotspot" || raw === "standard") {
    return raw;
  }
  return "standard";
}

export function parseVelocitySeedPreset(raw: unknown): VelocitySeedPreset {
  if (raw === "high" || raw === "priority_lock" || raw === "standard") {
    return raw;
  }
  return "standard";
}

export function parseCustomDecayDays(raw: unknown): number | null {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return null;
  if (n < CUSTOM_DECAY_MIN_DAYS || n > CUSTOM_DECAY_MAX_DAYS) return null;
  return n;
}

export function defaultDecayDaysForTier(tier: VelocityTier): number {
  if (tier === "high" || tier === "critical_hotspot") {
    return VELOCITY_CADENCE_HIGH_DAYS;
  }
  return VELOCITY_CADENCE_STANDARD_DAYS;
}

export function velocitySeedFromPreset(
  preset: VelocitySeedPreset
): VelocitySeed {
  if (preset === "high") {
    return {
      velocity_tier: "high",
      priority_override: false,
      custom_decay_days: VELOCITY_CADENCE_HIGH_DAYS,
    };
  }
  if (preset === "priority_lock") {
    return {
      velocity_tier: "high",
      priority_override: true,
      custom_decay_days: VELOCITY_CADENCE_HIGH_DAYS,
    };
  }
  return {
    velocity_tier: "standard",
    priority_override: false,
    custom_decay_days: VELOCITY_CADENCE_STANDARD_DAYS,
  };
}

export function resolveDecayDays(
  loc: Pick<StoreLocation, "velocity_tier" | "custom_decay_days">
): number {
  return (
    parseCustomDecayDays(loc.custom_decay_days) ??
    defaultDecayDaysForTier(parseVelocityTier(loc.velocity_tier))
  );
}

/**
 * Sunday-draw decay multiplier — shorter cadence (5-day high) weights
 * the same calendar age higher than 14-day standard.
 */
export function decayDrawMultiplier(
  loc: Pick<
    StoreLocation,
    "velocity_tier" | "custom_decay_days" | "last_serviced_at" | "last_completed_at"
  >
): number {
  const days = resolveDecayDays(loc);
  const age =
    daysSinceIso(loc.last_serviced_at) ?? daysSinceIso(loc.last_completed_at);
  const ageDays = age == null ? days * 2 : Math.max(1, age);
  let multiplier = ageDays / days;
  if (ageDays >= days) multiplier *= 2;
  return Math.max(0.5, multiplier);
}

/** Overdue vs seeded cadence — joins the Sunday velocity-priority pool. */
export function isCadenceDueForSundayDraw(
  loc: Pick<
    StoreLocation,
    | "velocity_tier"
    | "custom_decay_days"
    | "last_serviced_at"
    | "last_completed_at"
  >
): boolean {
  const age =
    daysSinceIso(loc.last_serviced_at) ?? daysSinceIso(loc.last_completed_at);
  if (age == null) return false;
  return age >= resolveDecayDays(loc);
}

export function parseBayServiceIntensity(
  raw: unknown
): BayServiceIntensity | null {
  if (
    raw === "light_touch" ||
    raw === "heavy_packdown" ||
    raw === "critical_hole"
  ) {
    return raw;
  }
  return null;
}

export function isHotServiceIntensity(
  intensity: BayServiceIntensity
): boolean {
  return intensity === "heavy_packdown" || intensity === "critical_hole";
}

export function isRotationVelocityPriority(
  loc: Pick<StoreLocation, "velocity_tier" | "priority_override">
): boolean {
  if (loc.priority_override === true) return true;
  const tier = parseVelocityTier(loc.velocity_tier);
  return tier === "high" || tier === "critical_hotspot";
}

function velocityRank(tier: VelocityTier): number {
  if (tier === "critical_hotspot") return 2;
  if (tier === "high") return 1;
  return 0;
}

function maxVelocityTier(a: VelocityTier, b: VelocityTier): VelocityTier {
  return velocityRank(a) >= velocityRank(b) ? a : b;
}

/**
 * Promote only. 2+ heavy_packdown or critical_hole in the window → high;
 * 2+ critical_hole → critical_hotspot.
 */
export function nextVelocityTier(
  current: VelocityTier | null | undefined,
  recentIntensities: BayServiceIntensity[]
): VelocityTier {
  const currentTier = parseVelocityTier(current);
  const hot = recentIntensities.filter(isHotServiceIntensity);
  const critical = recentIntensities.filter((i) => i === "critical_hole");
  let next = currentTier;
  if (critical.length >= VELOCITY_AUTO_TIER_HOT_COUNT) {
    next = maxVelocityTier(next, "critical_hotspot");
  } else if (hot.length >= VELOCITY_AUTO_TIER_HOT_COUNT) {
    next = maxVelocityTier(next, "high");
  }
  return next;
}

export function classifyVelocityHeat(
  loc:
    | Pick<StoreLocation, "last_serviced_at" | "velocity_tier">
    | null
    | undefined,
  now = new Date()
): VelocityHeatTone {
  if (!loc) return "untouched";
  const tier = parseVelocityTier(loc.velocity_tier);
  if (tier === "high" || tier === "critical_hotspot") return "hotspot";
  const ageDays = daysSinceIso(loc.last_serviced_at, now);
  if (ageDays == null || ageDays > VELOCITY_DECAY_DAYS) return "untouched";
  if (ageDays <= VELOCITY_FRESH_DAYS) return "fresh";
  return "decaying";
}

export function worstVelocityHeat(
  tones: Iterable<VelocityHeatTone>
): VelocityHeatTone {
  let worst: VelocityHeatTone = "fresh";
  for (const tone of tones) {
    if (tone === "hotspot") return "hotspot";
    if (tone === "untouched") worst = "untouched";
    else if (tone === "decaying" && worst === "fresh") worst = "decaying";
  }
  return worst;
}

export function velocityHeatDotClass(tone: VelocityHeatTone): string {
  if (tone === "fresh") {
    return "bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.7)]";
  }
  if (tone === "decaying") {
    return "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]";
  }
  if (tone === "hotspot") {
    return "bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.8)]";
  }
  return "bg-zinc-500 ring-1 ring-orange-400/80";
}

export function velocityHeatRowClass(tone: VelocityHeatTone): string {
  if (tone === "fresh") {
    return "rounded-xl bg-cyan-500/15";
  }
  if (tone === "decaying") {
    return "rounded-xl bg-amber-500/15";
  }
  if (tone === "hotspot") {
    return "velocity-hotspot-pulse rounded-xl bg-rose-600/20 ring-1 ring-fuchsia-500/50";
  }
  return "rounded-xl bg-zinc-800/50 ring-1 ring-orange-500/45";
}

export function velocityHeatPillClass(tone: VelocityHeatTone): string {
  if (tone === "fresh") return "bg-cyan-500/25 text-cyan-100";
  if (tone === "decaying") return "bg-amber-500/20 text-amber-100";
  if (tone === "hotspot") return "bg-rose-500/30 text-rose-100";
  return "bg-zinc-700/50 text-zinc-300 ring-1 ring-inset ring-orange-500/40";
}

export function velocityHeatLabel(tone: VelocityHeatTone): string {
  if (tone === "fresh") return "Serviced ≤7 days";
  if (tone === "decaying") return "Cadence 8–18 days";
  if (tone === "hotspot") return "High / critical hotspot";
  return "Untouched >18 days";
}

/** Yield so historical decay scoring does not block Floor/Map first paint. */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout: 24 });
      return;
    }
    setTimeout(resolve, 0);
  });
}

export type LocationDecayScore = {
  location: Pick<
    StoreLocation,
    | "id"
    | "aisle"
    | "bay"
    | "type"
    | "velocity_tier"
    | "custom_decay_days"
    | "last_serviced_at"
    | "last_completed_at"
  >;
  score: number;
};

/** Chunked decay multipliers — yields every `yieldEvery` bays. */
export async function scoreLocationDecaysAsync<
  T extends Pick<
    StoreLocation,
    | "velocity_tier"
    | "custom_decay_days"
    | "last_serviced_at"
    | "last_completed_at"
  >,
>(locations: T[], yieldEvery = 40): Promise<Array<{ location: T; score: number }>> {
  const out: Array<{ location: T; score: number }> = [];
  for (let i = 0; i < locations.length; i += 1) {
    if (i > 0 && i % yieldEvery === 0) await yieldToMain();
    out.push({ location: locations[i], score: decayDrawMultiplier(locations[i]) });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export const VELOCITY_HEAT_LEGEND: ReadonlyArray<{
  tone: VelocityHeatTone;
  label: string;
}> = [
  { tone: "fresh", label: "≤7 days" },
  { tone: "decaying", label: "8–18 days" },
  { tone: "untouched", label: ">18 days / never" },
  { tone: "hotspot", label: "High / critical" },
];
