"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AddBaySheet } from "@/components/admin/AddBaySheet";
import { EditBayDrawer } from "@/components/admin/EditBayDrawer";
import { HubIcon } from "@/components/hub/NavIcons";
import { compareAisles } from "@/lib/store-ops/aisle";
import { deleteStoreLocations } from "@/lib/store-ops/client";
import {
  findDuplicateLegacyBays,
  pruneIdsFromDuplicateGroups,
} from "@/lib/store-ops/locations";
import {
  formatBayTag,
  type Department,
  type StoreLocation,
  type VelocityTier,
} from "@/lib/store-ops/types";
import { parseVelocityTier } from "@/lib/store-ops/velocity";
import { toastError, toastSuccess } from "@/lib/toast";
import type { StoreSpecialist } from "@/lib/types";

const BulkLocationGenerator = dynamic(
  () =>
    import("@/components/admin/BulkLocationGenerator").then(
      (mod) => mod.BulkLocationGenerator
    ),
  { ssr: false }
);

type BayPair = {
  bay: number;
  selling: StoreLocation | null;
  topstock: StoreLocation | null;
};

type AisleGroup = {
  aisle: string;
  bays: BayPair[];
  tagCount: number;
};

type Props = {
  specialist: StoreSpecialist;
  departments: Department[];
  locations: StoreLocation[];
  canMutate: boolean;
  contextLabel: string;
  onChanged: () => void;
};

function pairIds(pair: BayPair): string[] {
  return [pair.selling, pair.topstock]
    .filter((loc): loc is StoreLocation => Boolean(loc))
    .map((loc) => loc.id);
}

function buildPairs(locs: StoreLocation[]): BayPair[] {
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

function worstTier(pair: BayPair): VelocityTier {
  const a = parseVelocityTier(pair.selling?.velocity_tier);
  const b = parseVelocityTier(pair.topstock?.velocity_tier);
  if (a === "critical_hotspot" || b === "critical_hotspot") {
    return "critical_hotspot";
  }
  if (a === "high" || b === "high") return "high";
  return "standard";
}

function tierLabel(tier: VelocityTier): string {
  if (tier === "critical_hotspot") return "CRITICAL";
  if (tier === "high") return "HIGH";
  return "STANDARD";
}

function aisleTitle(aisle: string): string {
  const raw = String(aisle ?? "").trim();
  if (!raw) return "Aisle";
  if (/^(BW|BACK)/i.test(raw)) return "Back Wall";
  if (/^(RW|RACK)/i.test(raw)) return `Aisle ${raw.toUpperCase()}`;
  return `Aisle ${raw}`;
}

/**
 * Manage Aisles & Bays — CRUD console for the active department map.
 * Visual walk/heatmap stays in StoreLocationGrid.
 */
export function AisleBayManager({
  specialist,
  departments,
  locations,
  canMutate,
  contextLabel,
  onChanged,
}: Props) {
  const [openAisles, setOpenAisles] = useState<Record<string, boolean>>({});
  const [aisleVisible, setAisleVisible] = useState(16);
  const [bayVisible, setBayVisible] = useState<Record<string, number>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pruneBusy, setPruneBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addPrefill, setAddPrefill] = useState<{
    departmentId: string;
    aisle: string;
  } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editFaces, setEditFaces] = useState<StoreLocation[] | null>(null);
  const [deleteFaces, setDeleteFaces] = useState<StoreLocation[] | null>(null);

  const groups = useMemo((): AisleGroup[] => {
    const byAisle = new Map<string, StoreLocation[]>();
    for (const loc of locations) {
      const key = String(loc.aisle);
      const list = byAisle.get(key) ?? [];
      list.push(loc);
      byAisle.set(key, list);
    }
    return [...byAisle.entries()]
      .sort((a, b) => compareAisles(a[0], b[0]))
      .map(([aisle, locs]) => ({
        aisle,
        bays: buildPairs(locs),
        tagCount: locs.length,
      }));
  }, [locations]);

  const mappedBayCount = useMemo(
    () => groups.reduce((sum, g) => sum + g.bays.length, 0),
    [groups]
  );

  const duplicateGroups = useMemo(
    () => findDuplicateLegacyBays(locations),
    [locations]
  );
  const pruneIds = useMemo(
    () => pruneIdsFromDuplicateGroups(duplicateGroups),
    [duplicateGroups]
  );

  const defaultDeptId =
    locations[0]?.department_id || departments[0]?.id || "";

  function toggleAisle(aisle: string) {
    setOpenAisles((prev) => ({ ...prev, [aisle]: !prev[aisle] }));
  }

  function togglePair(pair: BayPair) {
    const ids = pairIds(pair);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allOn = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
    setBatchConfirm(false);
  }

  function selectAll() {
    if (selectedIds.size === locations.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(locations.map((loc) => loc.id)));
    }
    setBatchConfirm(false);
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    if (!batchConfirm) {
      setBatchConfirm(true);
      return;
    }
    setBusy(true);
    try {
      await deleteStoreLocations(specialist, [...selectedIds]);
      toastSuccess(`Deleted ${selectedIds.size} mapped tag${selectedIds.size === 1 ? "" : "s"}`);
      setSelectedIds(new Set());
      setBatchConfirm(false);
      onChanged();
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "Could not delete selected bays"
      );
    } finally {
      setBusy(false);
    }
  }

  async function pruneDuplicates() {
    if (pruneIds.length === 0) return;
    setPruneBusy(true);
    try {
      await deleteStoreLocations(specialist, pruneIds);
      toastSuccess(
        `Removed ${pruneIds.length} duplicate tag${pruneIds.length === 1 ? "" : "s"}`
      );
      onChanged();
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "Could not prune duplicates"
      );
    } finally {
      setPruneBusy(false);
    }
  }

  async function confirmRowDelete() {
    if (!deleteFaces?.length) return;
    setBusy(true);
    try {
      await deleteStoreLocations(
        specialist,
        deleteFaces.map((loc) => loc.id)
      );
      toastSuccess(`Deleted ${formatBayTag(deleteFaces[0])}`);
      setDeleteFaces(null);
      onChanged();
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "Could not delete bay"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex min-h-9 items-center rounded-full border border-accent/40 bg-accent/10 px-3 font-mono text-[11px] font-bold tracking-tight text-accent">
          {mappedBayCount} mapped bay{mappedBayCount === 1 ? "" : "s"}
        </span>
        <span className="font-mono text-[11px] tracking-tight text-zinc-500">
          {contextLabel}
        </span>
      </div>

      {canMutate ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setAddPrefill(
                defaultDeptId
                  ? { departmentId: defaultDeptId, aisle: "" }
                  : null
              );
              setAddOpen(true);
            }}
            className="btn-primary-glow flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-bold"
          >
            + Add Single Bay
          </button>
          <button
            type="button"
            onClick={() => setBulkOpen(true)}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-950/30 px-3 text-sm font-bold text-amber-100"
          >
            <HubIcon id="zap" className="h-4 w-4" />
            Bulk Generator
          </button>
        </div>
      ) : null}

      {canMutate && locations.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={selectAll}
            className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-zinc-700 px-3 text-sm font-semibold"
          >
            {selectedIds.size === locations.length
              ? "Clear selection"
              : "Select All"}
          </button>
          <button
            type="button"
            disabled={selectedIds.size === 0 || busy}
            onClick={() => void deleteSelected()}
            className={`flex min-h-11 flex-1 items-center justify-center rounded-xl border px-3 text-sm font-bold disabled:opacity-40 ${
              batchConfirm
                ? "border-rose-400 bg-rose-600 text-white"
                : "border-rose-500/40 bg-rose-950/30 text-rose-100"
            }`}
          >
            {busy
              ? "Deleting…"
              : batchConfirm
                ? `Confirm delete ${selectedIds.size}`
                : `Delete Selected (${selectedIds.size})`}
          </button>
        </div>
      ) : null}

      {canMutate && duplicateGroups.length > 0 ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/25 px-3 py-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">
            Map prune · duplicate legacy bays
          </p>
          <p className="mt-1 text-sm text-amber-100/90">
            {duplicateGroups.length} duplicate group
            {duplicateGroups.length === 1 ? "" : "s"} · {pruneIds.length} extra
            tag{pruneIds.length === 1 ? "" : "s"} to delete. Canonical tags
            stay on the map.
          </p>
          <button
            type="button"
            disabled={pruneBusy}
            onClick={() => void pruneDuplicates()}
            className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-amber-400/45 bg-amber-950/40 px-3 text-sm font-bold text-amber-50 disabled:opacity-40"
          >
            {pruneBusy ? "Deleting…" : "Delete duplicate tags"}
          </button>
        </div>
      ) : null}

      {locations.length === 0 ? (
        <p className="glass-card border-dashed px-4 py-8 text-center text-sm text-zinc-400">
          No aisles mapped for {contextLabel} yet.
        </p>
      ) : (
        <>
        <ul className="space-y-2">
          {groups.slice(0, aisleVisible).map((group) => {
            const open = Boolean(openAisles[group.aisle]);
            const bayLimit = bayVisible[group.aisle] ?? 24;
            const visibleBays = open ? group.bays.slice(0, bayLimit) : [];
            return (
              <li
                key={group.aisle}
                className="glass-card overflow-hidden !rounded-xl !p-0"
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggleAisle(group.aisle)}
                  className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left"
                >
                  <span>
                    <span className="block text-sm font-bold text-white">
                      {aisleTitle(group.aisle)}
                    </span>
                    <span className="font-mono text-[11px] tracking-tight text-zinc-500">
                      {group.bays.length} bay
                      {group.bays.length === 1 ? "" : "s"} · {group.tagCount}{" "}
                      tag{group.tagCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <HubIcon
                    id={open ? "chevronUp" : "chevronDown"}
                    className="h-4 w-4 text-zinc-400"
                  />
                </button>
                {open ? (
                  <ul className="space-y-1.5 border-t border-zinc-800/80 px-2 py-2">
                    {visibleBays.map((pair) => {
                      const faces = [pair.selling, pair.topstock].filter(
                        (loc): loc is StoreLocation => Boolean(loc)
                      );
                      const loc = faces[0];
                      if (!loc) return null;
                      const ids = pairIds(pair);
                      const selected = ids.every((id) => selectedIds.has(id));
                      const tier = worstTier(pair);
                      return (
                        <li
                          key={`${group.aisle}-${pair.bay}`}
                          className="rounded-xl border border-zinc-800 bg-zinc-950/50 px-2 py-2"
                        >
                          <div className="flex items-start gap-2">
                            {canMutate ? (
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => togglePair(pair)}
                                className="mt-1.5 h-4 w-4"
                                style={{ accentColor: "var(--accent)" }}
                                aria-label={`Select ${formatBayTag(loc)}`}
                              />
                            ) : null}
                            <div className="min-w-0 flex-1">
                              <p className="font-mono text-sm font-bold tracking-tight tabular-nums text-white">
                                {formatBayTag(loc)}
                              </p>
                              <p className="mt-1 flex flex-wrap gap-1">
                                {pair.selling ? (
                                  <span className="glass-pill-emerald font-mono text-[10px] tracking-tight">
                                    Selling
                                  </span>
                                ) : null}
                                {pair.topstock ? (
                                  <span className="glass-pill-cyan font-mono text-[10px] tracking-tight">
                                    Topstock
                                  </span>
                                ) : null}
                                <span className="inline-flex items-center rounded-full border border-zinc-700 px-2 py-0.5 font-mono text-[10px] font-bold tracking-tight text-zinc-300">
                                  {tierLabel(tier)}
                                </span>
                                {pair.selling?.priority_override ||
                                pair.topstock?.priority_override ? (
                                  <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 font-mono text-[10px] font-bold tracking-tight text-amber-100">
                                    <HubIcon id="lock" className="h-3 w-3" />
                                    LOCK
                                  </span>
                                ) : null}
                              </p>
                            </div>
                          </div>
                          {canMutate ? (
                            <div className="mt-2 grid grid-cols-2 gap-1.5">
                              <button
                                type="button"
                                onClick={() => setEditFaces(faces)}
                                className="flex min-h-10 items-center justify-center gap-1 rounded-xl border border-zinc-700 text-xs font-bold"
                              >
                                <HubIcon id="edit" className="h-3.5 w-3.5" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteFaces(faces)}
                                className="flex min-h-10 items-center justify-center gap-1 rounded-xl border border-rose-500/40 text-xs font-bold text-rose-200"
                              >
                                <HubIcon id="trash" className="h-3.5 w-3.5" />
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                    {group.bays.length > bayLimit ? (
                      <li>
                        <button
                          type="button"
                          onClick={() =>
                            setBayVisible((prev) => ({
                              ...prev,
                              [group.aisle]: bayLimit + 24,
                            }))
                          }
                          className="flex min-h-10 w-full items-center justify-center font-mono text-[11px] font-bold text-accent"
                        >
                          Show more bays ({group.bays.length - bayLimit})
                        </button>
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
        {groups.length > aisleVisible ? (
          <button
            type="button"
            onClick={() => setAisleVisible((n) => n + 16)}
            className="flex min-h-11 w-full items-center justify-center rounded-xl border border-zinc-800 font-mono text-[11px] font-bold text-accent"
          >
            Show more aisles ({groups.length - aisleVisible})
          </button>
        ) : null}
        </>
      )}

      {addOpen ? (
        <AddBaySheet
          specialist={specialist}
          departments={departments}
          prefill={addPrefill}
          onClose={() => {
            setAddOpen(false);
            setAddPrefill(null);
          }}
          onChanged={onChanged}
        />
      ) : null}

      {editFaces ? (
        <EditBayDrawer
          specialist={specialist}
          departments={departments}
          faces={editFaces}
          onClose={() => setEditFaces(null)}
          onChanged={onChanged}
        />
      ) : null}

      {bulkOpen ? (
        <div className="glass-backdrop fixed inset-0 z-[80] flex flex-col justify-end">
          <button
            type="button"
            aria-label="Close bulk generator"
            className="absolute inset-0"
            onClick={() => setBulkOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="glass-card theme-modal relative z-10 max-h-[90dvh] w-full overflow-y-auto !rounded-t-2xl !rounded-b-none border-t-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-600" />
            <div className="mb-3 flex items-center justify-between">
              <h2 className="glass-title text-lg">Bulk Generator</h2>
              <button
                type="button"
                onClick={() => setBulkOpen(false)}
                className="btn-icon-touch"
                aria-label="Close"
              >
                <HubIcon id="close" className="h-5 w-5" />
              </button>
            </div>
            <BulkLocationGenerator
              specialist={specialist}
              departments={departments}
              onGenerated={() => {
                onChanged();
                setBulkOpen(false);
              }}
            />
          </div>
        </div>
      ) : null}

      {deleteFaces ? (
        <div className="glass-backdrop fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Cancel delete"
            onClick={() => setDeleteFaces(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="glass-card theme-modal relative z-10 w-full max-w-md !rounded-t-2xl p-4 sm:!rounded-2xl"
          >
            <h2 className="glass-title text-lg">
              Delete {formatBayTag(deleteFaces[0])}?
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              Removes Selling and Topstock tags for this bay from the map.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDeleteFaces(null)}
                className="flex min-h-12 items-center justify-center rounded-xl border border-zinc-700 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmRowDelete()}
                className="flex min-h-12 items-center justify-center rounded-xl bg-rose-600 text-sm font-bold text-white disabled:opacity-40"
              >
                {busy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
