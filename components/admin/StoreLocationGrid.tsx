"use client";

import { useMemo, useState } from "react";
import type { Department, StoreLocation } from "@/lib/store-ops/types";
import type { StoreSpecialist } from "@/lib/types";
import { patchStoreLocation } from "@/lib/store-ops/client";

type Props = {
  specialist: StoreSpecialist;
  departments: Department[];
  locations: StoreLocation[];
  onChanged: () => void;
};

type Group = {
  departmentId: string;
  departmentName: string;
  aisle: number;
  rows: StoreLocation[];
};

export function StoreLocationGrid({
  specialist,
  departments,
  locations,
  onChanged,
}: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deptName = useMemo(() => {
    const map = new Map(departments.map((d) => [d.id, d.name]));
    return (id: string) => map.get(id) ?? "Unknown";
  }, [departments]);

  const groups = useMemo(() => {
    const byKey = new Map<string, Group>();
    for (const loc of locations) {
      const key = `${loc.department_id}:${loc.aisle}`;
      let group = byKey.get(key);
      if (!group) {
        group = {
          departmentId: loc.department_id,
          departmentName: deptName(loc.department_id),
          aisle: loc.aisle,
          rows: [],
        };
        byKey.set(key, group);
      }
      group.rows.push(loc);
    }
    return [...byKey.values()].sort((a, b) => {
      const nameCmp = a.departmentName.localeCompare(b.departmentName);
      if (nameCmp !== 0) return nameCmp;
      return a.aisle - b.aisle;
    });
  }, [locations, deptName]);

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
    <section className="space-y-4">
      <div>
        <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-emerald-400">
          Store Location Grid
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Grouped by department and aisle. Deactivate a bay to exclude it from rotations.
        </p>
      </div>

      {error ? (
        <p className="text-sm font-medium text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      {groups.map((group) => (
        <div
          key={`${group.departmentId}-${group.aisle}`}
          className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70"
        >
          <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/60 px-4 py-3">
            <div>
              <p className="text-sm font-bold text-slate-50">
                {group.departmentName}
              </p>
              <p className="font-mono text-xs text-emerald-400/90">
                Aisle {group.aisle} · {group.rows.length} tags
              </p>
            </div>
          </div>

          <ul className="divide-y divide-slate-800">
            {group.rows
              .slice()
              .sort((a, b) => a.bay - b.bay || a.type.localeCompare(b.type))
              .map((loc) => (
                <li
                  key={loc.id}
                  className={`flex items-center gap-3 px-4 py-3 ${
                    loc.is_active ? "" : "opacity-50"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-semibold text-slate-100">
                      Bay {loc.bay} · {loc.type}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {loc.status}
                      {loc.cycle_number > 1 ? ` · Cycle ${loc.cycle_number}` : ""}
                      {!loc.is_active ? " · Deactivated" : ""}
                    </p>
                  </div>
                  <label className="flex min-h-12 min-w-[5.5rem] items-center justify-end gap-2 text-xs font-semibold text-slate-300">
                    <span>{loc.is_active ? "Active" : "Off"}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={loc.is_active}
                      disabled={pendingId === loc.id}
                      onClick={() => toggleActive(loc)}
                      className={`relative h-7 w-12 rounded-full transition ${
                        loc.is_active ? "bg-emerald-500" : "bg-slate-600"
                      } disabled:opacity-60`}
                    >
                      <span
                        className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${
                          loc.is_active ? "left-[1.35rem]" : "left-0.5"
                        }`}
                      />
                    </button>
                  </label>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
