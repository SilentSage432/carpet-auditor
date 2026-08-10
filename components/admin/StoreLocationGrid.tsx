"use client";

import { useMemo, useState } from "react";
import type { Department, StoreLocation } from "@/lib/store-ops/types";
import type { StoreSpecialist } from "@/lib/types";
import {
  assignLocationsToWeek,
  patchStoreLocation,
} from "@/lib/store-ops/client";

type Props = {
  specialist: StoreSpecialist;
  departments: Department[];
  locations: StoreLocation[];
  onChanged: () => void;
};

type BayPair = {
  bay: number;
  selling: StoreLocation | null;
  topstock: StoreLocation | null;
};

type AisleGroup = {
  aisle: number;
  locations: StoreLocation[];
  bays: BayPair[];
};

type DepartmentGroup = {
  departmentId: string;
  departmentName: string;
  tagCount: number;
  aisles: AisleGroup[];
};

function buildBayPairs(locs: StoreLocation[]): BayPair[] {
  const byBay = new Map<number, BayPair>();
  for (const loc of locs) {
    let pair = byBay.get(loc.bay);
    if (!pair) {
      pair = { bay: loc.bay, selling: null, topstock: null };
      byBay.set(loc.bay, pair);
    }
    if (loc.type === "SELLING") pair.selling = loc;
    else if (loc.type === "TOPSTOCK") pair.topstock = loc;
  }
  return [...byBay.values()].sort((a, b) => a.bay - b.bay);
}

export function StoreLocationGrid({
  specialist,
  departments,
  locations,
  onChanged,
}: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDepts, setOpenDepts] = useState<Record<string, boolean>>({});
  const [openAisles, setOpenAisles] = useState<Record<string, boolean>>({});

  const departmentGroups = useMemo((): DepartmentGroup[] => {
    const nameById = new Map(departments.map((d) => [d.id, d.name]));
    const byDept = new Map<string, StoreLocation[]>();

    for (const loc of locations) {
      const list = byDept.get(loc.department_id) ?? [];
      list.push(loc);
      byDept.set(loc.department_id, list);
    }

    const groups: DepartmentGroup[] = [];
    for (const [departmentId, locs] of byDept) {
      const byAisle = new Map<number, StoreLocation[]>();
      for (const loc of locs) {
        const list = byAisle.get(loc.aisle) ?? [];
        list.push(loc);
        byAisle.set(loc.aisle, list);
      }

      const aisles: AisleGroup[] = [...byAisle.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([aisle, aisleLocs]) => ({
          aisle,
          locations: aisleLocs,
          bays: buildBayPairs(aisleLocs),
        }));

      groups.push({
        departmentId,
        departmentName: nameById.get(departmentId) ?? "Unknown",
        tagCount: locs.length,
        aisles,
      });
    }

    return groups.sort((a, b) =>
      a.departmentName.localeCompare(b.departmentName)
    );
  }, [locations, departments]);

  function toggleDept(id: string) {
    setOpenDepts((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleAisle(key: string) {
    setOpenAisles((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function toggleActive(loc: StoreLocation) {
    setPendingId(loc.id);
    setError(null);
    try {
      await patchStoreLocation(specialist, loc.id, {
        is_active: !loc.is_active,
      });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setPendingId(null);
    }
  }

  async function toggleShowroom(loc: StoreLocation) {
    setPendingId(loc.id);
    setError(null);
    try {
      const next =
        (loc.location_type ?? "STANDARD") === "SHOWROOM_STACKOUT"
          ? "STANDARD"
          : "SHOWROOM_STACKOUT";
      await patchStoreLocation(specialist, loc.id, {
        location_type: next,
        audit_frequency_days: next === "SHOWROOM_STACKOUT" ? 3 : 7,
      });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set zone");
    } finally {
      setPendingId(null);
    }
  }

  async function priorityAdd(loc: StoreLocation) {
    setPendingId(loc.id);
    setError(null);
    try {
      await assignLocationsToWeek(specialist, [loc.id], loc.department_id);
      onChanged();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not add bay to this week"
      );
    } finally {
      setPendingId(null);
    }
  }

  if (locations.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/50 p-6 text-center">
        <p className="text-sm text-slate-400">
          No store locations mapped yet. Expand Map Management &amp; Bulk Add
          to generate aisle tags.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-emerald-400">
          Store Location Grid
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Expand a department, then an aisle. Selling and Topstock share one bay
          row. ★ adds to this week (+priority); 🏛 marks showroom / stack-out.
        </p>
      </div>

      {error ? (
        <p className="text-sm font-medium text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      {departmentGroups.map((dept) => {
        const deptOpen = Boolean(openDepts[dept.departmentId]);
        return (
          <div
            key={dept.departmentId}
            className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70"
          >
            <button
              type="button"
              aria-expanded={deptOpen}
              onClick={() => toggleDept(dept.departmentId)}
              className="flex min-h-14 w-full items-center justify-between gap-3 bg-slate-950/60 px-4 py-3 text-left"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-50">
                  {dept.departmentName}
                  <span className="ml-2 font-mono text-xs font-semibold text-emerald-400/90">
                    · {dept.tagCount} tag{dept.tagCount === 1 ? "" : "s"}
                  </span>
                </p>
                <p className="font-mono text-[11px] text-slate-500">
                  {dept.aisles.length} aisle
                  {dept.aisles.length === 1 ? "" : "s"}
                </p>
              </div>
              <span aria-hidden className="font-mono text-base text-slate-300">
                {deptOpen ? "▲" : "▼"}
              </span>
            </button>

            {deptOpen ? (
              <div className="space-y-2 border-t border-slate-800 p-2">
                {dept.aisles.map((aisle) => {
                  const aisleKey = `${dept.departmentId}:${aisle.aisle}`;
                  const aisleOpen = Boolean(openAisles[aisleKey]);
                  const bayCount = aisle.bays.length;
                  return (
                    <div
                      key={aisleKey}
                      className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40"
                    >
                      <button
                        type="button"
                        aria-expanded={aisleOpen}
                        onClick={() => toggleAisle(aisleKey)}
                        className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left"
                      >
                        <p className="font-mono text-sm font-semibold text-slate-100">
                          Aisle {aisle.aisle}
                          <span className="ml-2 text-xs font-medium text-slate-400">
                            · {bayCount} bay{bayCount === 1 ? "" : "s"}
                          </span>
                        </p>
                        <span
                          aria-hidden
                          className="font-mono text-sm text-slate-400"
                        >
                          {aisleOpen ? "▲" : "▼"}
                        </span>
                      </button>

                      {aisleOpen ? (
                        <ul className="divide-y divide-slate-800 border-t border-slate-800">
                          {aisle.bays.map((pair) => (
                            <li
                              key={`${aisleKey}-bay-${pair.bay}`}
                              className="space-y-1.5 px-3 py-2"
                            >
                              <div className="flex min-h-11 items-center gap-2">
                                <p className="w-14 shrink-0 font-mono text-xs font-bold text-slate-400">
                                  Bay {pair.bay}
                                </p>
                                <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
                                  <TypeToggle
                                    label="S"
                                    fullLabel="Selling"
                                    loc={pair.selling}
                                    pendingId={pendingId}
                                    onToggle={toggleActive}
                                    onShowroom={toggleShowroom}
                                    onPriorityAdd={priorityAdd}
                                  />
                                  <TypeToggle
                                    label="T"
                                    fullLabel="Topstock"
                                    loc={pair.topstock}
                                    pendingId={pendingId}
                                    onToggle={toggleActive}
                                    onShowroom={toggleShowroom}
                                    onPriorityAdd={priorityAdd}
                                  />
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function TypeToggle({
  label,
  fullLabel,
  loc,
  pendingId,
  onToggle,
  onShowroom,
  onPriorityAdd,
}: {
  label: string;
  fullLabel: string;
  loc: StoreLocation | null;
  pendingId: string | null;
  onToggle: (loc: StoreLocation) => void;
  onShowroom: (loc: StoreLocation) => void;
  onPriorityAdd: (loc: StoreLocation) => void;
}) {
  if (!loc) {
    return (
      <div className="flex min-h-9 items-center gap-1.5 rounded-md border border-dashed border-slate-800 px-1.5 opacity-40">
        <span className="font-mono text-[10px] font-bold text-slate-500">
          {label}
        </span>
        <span className="text-[10px] text-slate-600">—</span>
      </div>
    );
  }

  const showroom = (loc.location_type ?? "STANDARD") === "SHOWROOM_STACKOUT";
  const priority = Number(loc.manual_priority_count) || 0;

  return (
    <div
      className={`rounded-md border px-1.5 py-1 ${
        showroom
          ? "border-amber-500/40 bg-amber-950/30"
          : "border-slate-800 bg-slate-900/80"
      } ${loc.is_active ? "" : "opacity-50"}`}
    >
      <div className="flex min-h-8 items-center justify-between gap-1">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-bold text-emerald-400/90">
            {label}
            <span className="ml-1 font-sans font-medium text-slate-500">
              {loc.status === "PENDING"
                ? "P"
                : loc.status === "ASSIGNED"
                  ? "A"
                  : loc.status.slice(0, 1)}
              {priority > 0 ? ` ·★${priority}` : ""}
              {showroom ? " ·🏛" : ""}
            </span>
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={loc.is_active}
          aria-label={`${fullLabel} bay ${loc.bay} ${loc.is_active ? "active" : "off"}`}
          disabled={pendingId === loc.id}
          onClick={() => onToggle(loc)}
          className={`relative h-5 w-9 shrink-0 rounded-full transition ${
            loc.is_active ? "bg-emerald-500" : "bg-slate-600"
          } disabled:opacity-60`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
              loc.is_active ? "left-[1rem]" : "left-0.5"
            }`}
          />
        </button>
      </div>
      <div className="mt-1 flex gap-1">
        <button
          type="button"
          disabled={pendingId === loc.id || showroom}
          onClick={() => onPriorityAdd(loc)}
          className="flex-1 rounded border border-emerald-500/30 py-0.5 text-[9px] font-bold text-emerald-200 disabled:opacity-40"
          title="Add to this week's rotation (+priority)"
        >
          ★ Week
        </button>
        <button
          type="button"
          disabled={pendingId === loc.id}
          onClick={() => onShowroom(loc)}
          className="flex-1 rounded border border-amber-500/30 py-0.5 text-[9px] font-bold text-amber-100 disabled:opacity-40"
          title="Toggle showroom / stack-out zone"
        >
          {showroom ? "Std" : "Show"}
        </button>
      </div>
    </div>
  );
}
