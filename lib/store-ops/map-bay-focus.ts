/**
 * RD-4 — This Week → Map aisle/bay focus navigation.
 * Presentation intent only. Does not mutate topology or invent locations.
 */

import { normalizeAisle } from "./aisle";

export const MAP_FOCUS_AISLE_PARAM = "aisle" as const;
export const MAP_FOCUS_BAY_PARAM = "bay" as const;
export const MAP_FOCUS_DEPT_PARAM = "deptId" as const;

export type MapBayFocusIntent = {
  aisle: string;
  bay: number;
  departmentId?: string | null;
};

export function buildMapBayFocusHref(input: MapBayFocusIntent): string {
  const aisle = normalizeAisle(input.aisle);
  const bay = Number(input.bay) || 0;
  const params = new URLSearchParams();
  if (aisle) params.set(MAP_FOCUS_AISLE_PARAM, aisle);
  if (bay >= 0) params.set(MAP_FOCUS_BAY_PARAM, String(bay));
  const dept = String(input.departmentId ?? "").trim();
  if (dept) params.set(MAP_FOCUS_DEPT_PARAM, dept);
  const q = params.toString();
  return q ? `/admin/store-map?${q}` : "/admin/store-map";
}

export function resolveMapBayFocusIntent(
  searchParams: URLSearchParams | { get(name: string): string | null }
): MapBayFocusIntent | null {
  const aisle = normalizeAisle(searchParams.get(MAP_FOCUS_AISLE_PARAM) ?? "");
  if (!aisle) return null;
  const bayRaw = searchParams.get(MAP_FOCUS_BAY_PARAM);
  const bay =
    bayRaw == null || bayRaw === ""
      ? 0
      : Number.parseInt(String(bayRaw), 10);
  if (!Number.isFinite(bay) || bay < 0) return null;
  const departmentId = String(
    searchParams.get(MAP_FOCUS_DEPT_PARAM) ?? ""
  ).trim();
  return {
    aisle,
    bay,
    departmentId: departmentId || null,
  };
}
