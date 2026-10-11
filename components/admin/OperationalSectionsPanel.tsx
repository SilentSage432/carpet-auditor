"use client";

/**
 * RD-3 — Operational Sections management (More → Department Setup).
 * Aisle-first bay membership picker. Stewardship only — not weekly assignment.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { StoreSpecialist } from "@/lib/types";
import type { Department, StoreLocation } from "@/lib/store-ops/types";
import { canManageOperationalSections } from "@/lib/rbac";
import { fetchSpecialists } from "@/lib/specialists";
import {
  addOperationalSectionMembersClient,
  createOperationalSectionClient,
  fetchOperationalSections,
  patchOperationalSectionClient,
  removeOperationalSectionMembersClient,
  STORE_OPS_SECTIONS_CHANGED_EVENT,
} from "@/lib/store-ops/client";
import {
  composeMapAisleIndex,
  formatMapAisleLabel,
  type MapAisleEntry,
} from "@/lib/store-ops/map-aisle-navigation";
import {
  formatUnsectionedLabel,
  sectionBayKey,
  type OperationalSectionBayRef,
  type OperationalSectionView,
} from "@/lib/store-ops/operational-sections";
import { workingDepartmentId } from "@/lib/admin-department-context";
import { useWorkingDepartment } from "@/lib/use-working-department";

type Props = {
  specialist: StoreSpecialist;
  departments: Department[];
  locations: StoreLocation[];
  onChanged?: () => void;
  /** Deep-link focus from Map bay sheet */
  focusSectionId?: string | null;
};

type DraftMode = "list" | "create" | "detail" | "pick-bays";

export function OperationalSectionsPanel({
  specialist,
  departments,
  locations,
  onChanged,
  focusSectionId = null,
}: Props) {
  const canManage = canManageOperationalSections(specialist);
  const working = useWorkingDepartment(specialist);
  const departmentId =
    workingDepartmentId(specialist, departments) ??
    departments[0]?.id ??
    "";

  const [sections, setSections] = useState<OperationalSectionView[]>([]);
  const [roster, setRoster] = useState<StoreSpecialist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [mode, setMode] = useState<DraftMode>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState<string>("");
  const [pendingBays, setPendingBays] = useState<OperationalSectionBayRef[]>(
    []
  );
  const [pickAisleKey, setPickAisleKey] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sec, people] = await Promise.all([
        fetchOperationalSections(specialist, {
          departmentId: departmentId || undefined,
          includeRetired: showRetired,
          includeMembers: true,
        }),
        fetchSpecialists().catch(() => [] as StoreSpecialist[]),
      ]);
      setSections(sec.sections ?? []);
      setRoster(people.filter((p) => p.is_active !== false));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load Operational Sections"
      );
    } finally {
      setLoading(false);
    }
  }, [specialist, departmentId, showRetired]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    function onChangedEvt() {
      void reload();
    }
    window.addEventListener(STORE_OPS_SECTIONS_CHANGED_EVENT, onChangedEvt);
    return () =>
      window.removeEventListener(STORE_OPS_SECTIONS_CHANGED_EVENT, onChangedEvt);
  }, [reload]);

  useEffect(() => {
    if (!focusSectionId) return;
    setSelectedId(focusSectionId);
    setMode("detail");
  }, [focusSectionId]);

  const selected = useMemo(
    () => sections.find((s) => s.id === selectedId) ?? null,
    [sections, selectedId]
  );

  const aisleIndex = useMemo(
    () =>
      composeMapAisleIndex({
        locations: locations.filter(
          (loc) => !departmentId || loc.department_id === departmentId
        ),
        departments,
        showRetired: false,
      }),
    [locations, departments, departmentId]
  );

  const claimedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const section of sections) {
      if (!section.is_active) continue;
      if (selectedId && section.id === selectedId) continue;
      for (const member of section.members ?? []) {
        set.add(sectionBayKey(member));
      }
    }
    return set;
  }, [sections, selectedId]);

  const selectedAisle: MapAisleEntry | null = useMemo(() => {
    if (!pickAisleKey) return null;
    return aisleIndex.find((a) => a.key === pickAisleKey) ?? null;
  }, [aisleIndex, pickAisleKey]);

  function openCreate() {
    setName("");
    setDescription("");
    setOwnerId("");
    setPendingBays([]);
    setMode("create");
  }

  function openDetail(id: string) {
    setSelectedId(id);
    setMode("detail");
  }

  async function handleCreate() {
    if (!canManage || !departmentId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createOperationalSectionClient(specialist, {
        department_id: departmentId,
        name,
        description: description || null,
        primary_owner_specialist_id: ownerId || null,
        members: pendingBays,
      });
      setSelectedId(result.section.id);
      setMode("detail");
      setPendingBays([]);
      await reload();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveMeta() {
    if (!canManage || !selected) return;
    setBusy(true);
    setError(null);
    try {
      await patchOperationalSectionClient(specialist, selected.id, {
        name: name || selected.name,
        description: description,
        primary_owner_specialist_id: ownerId || null,
      });
      await reload();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRetireOrReactivate() {
    if (!canManage || !selected) return;
    setBusy(true);
    setError(null);
    try {
      await patchOperationalSectionClient(specialist, selected.id, {
        action: selected.is_active ? "retire" : "reactivate",
      });
      await reload();
      onChanged?.();
      setMode("list");
      setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lifecycle update failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyPendingMembers() {
    if (!canManage || !selected || pendingBays.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await addOperationalSectionMembersClient(
        specialist,
        selected.id,
        pendingBays
      );
      setPendingBays([]);
      setMode("detail");
      await reload();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add bays");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveMember(ref: OperationalSectionBayRef) {
    if (!canManage || !selected) return;
    setBusy(true);
    setError(null);
    try {
      await removeOperationalSectionMembersClient(specialist, selected.id, [
        ref,
      ]);
      await reload();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove bay");
    } finally {
      setBusy(false);
    }
  }

  function togglePendingBay(ref: OperationalSectionBayRef) {
    const key = sectionBayKey(ref);
    setPendingBays((prev) => {
      if (prev.some((b) => sectionBayKey(b) === key)) {
        return prev.filter((b) => sectionBayKey(b) !== key);
      }
      return [...prev, ref];
    });
  }

  useEffect(() => {
    if (mode === "detail" && selected) {
      setName(selected.name);
      setDescription(selected.description ?? "");
      setOwnerId(selected.primary_owner_specialist_id ?? "");
    }
  }, [mode, selected]);

  if (!departmentId) {
    return (
      <p className="text-sm text-zinc-400" data-testid="sections-need-department">
        Select a working department to manage Operational Sections.
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="operational-sections-panel">
      <p className="text-[11px] leading-snug text-zinc-500">
        Persistent bay stewardship. Not weekly assignment and not proof of work.
        A bay belongs to at most one active section.
      </p>

      {error ? (
        <p className="text-sm text-rose-300" role="alert">
          {error}
        </p>
      ) : null}

      {mode === "list" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {canManage ? (
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl border border-accent/40 bg-accent/15 px-3 text-sm font-bold text-accent"
                data-testid="sections-create"
              >
                New section
              </button>
            ) : null}
            <label className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-zinc-800 px-3 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={showRetired}
                onChange={(e) => setShowRetired(e.target.checked)}
                className="h-4 w-4"
              />
              Show retired
            </label>
          </div>

          {loading ? (
            <p className="text-sm text-zinc-500">Loading sections…</p>
          ) : sections.length === 0 ? (
            <p
              className="rounded-xl border border-dashed border-zinc-700 px-3 py-4 text-sm text-zinc-400"
              data-testid="sections-empty"
            >
              No Operational Sections yet. Create one, then add bays from the
              aisle map.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="sections-list">
              {sections.map((section) => (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => openDetail(section.id)}
                    className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-3 py-2 text-left active:scale-[0.99]"
                    data-testid="sections-list-item"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-zinc-100">
                        {section.name}
                        {!section.is_active ? (
                          <span className="ml-2 font-mono text-[10px] text-zinc-500">
                            Retired
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-zinc-500">
                        {section.member_count} bay
                        {section.member_count === 1 ? "" : "s"}
                        {section.primary_owner_name
                          ? ` · ${section.primary_owner_name}`
                          : " · No owner"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      {mode === "create" || mode === "detail" ? (
        <div className="space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-3">
          <button
            type="button"
            onClick={() => {
              setMode("list");
              setSelectedId(null);
              setPendingBays([]);
            }}
            className="min-h-11 text-sm font-semibold text-accent"
            data-testid="sections-back-list"
          >
            ← All sections
          </button>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-400">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canManage || busy || (selected ? !selected.is_active : false)}
              className="glass-input min-h-12 w-full"
              data-testid="sections-name"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-400">Notes (optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canManage || busy || (selected ? !selected.is_active : false)}
              rows={2}
              className="glass-input w-full"
              data-testid="sections-description"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-400">Primary owner</span>
            <select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              disabled={!canManage || busy || (selected ? !selected.is_active : false)}
              className="glass-input min-h-12 w-full"
              data-testid="sections-owner"
            >
              <option value="">No owner</option>
              {roster.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                  {person.role ? ` · ${person.role}` : ""}
                </option>
              ))}
            </select>
          </label>

          {mode === "create" ? (
            <>
              <p className="font-mono text-[10px] text-zinc-500">
                Pending bays: {pendingBays.length}
              </p>
              <button
                type="button"
                onClick={() => {
                  setPickAisleKey(null);
                  setMode("pick-bays");
                }}
                className="flex min-h-12 w-full items-center justify-center rounded-xl border border-zinc-700 text-sm font-semibold text-zinc-100"
                data-testid="sections-pick-bays"
              >
                Add bays from Map
              </button>
              <button
                type="button"
                disabled={busy || !name.trim()}
                onClick={() => void handleCreate()}
                className="flex min-h-12 w-full items-center justify-center rounded-xl border border-accent/40 bg-accent/20 text-sm font-bold text-accent disabled:opacity-40"
                data-testid="sections-create-submit"
              >
                {busy ? "Saving…" : "Create section"}
              </button>
            </>
          ) : null}

          {mode === "detail" && selected ? (
            <>
              <div className="flex flex-wrap gap-2">
                {canManage && selected.is_active ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleSaveMeta()}
                    className="min-h-12 flex-1 rounded-xl border border-accent/40 bg-accent/15 px-3 text-sm font-bold text-accent disabled:opacity-40"
                  >
                    Save
                  </button>
                ) : null}
                {canManage ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRetireOrReactivate()}
                    className={`min-h-12 flex-1 rounded-xl border px-3 text-sm font-bold disabled:opacity-40 ${
                      selected.is_active
                        ? "border-amber-500/40 bg-amber-950/30 text-amber-100"
                        : "border-emerald-500/40 bg-emerald-950/30 text-emerald-100"
                    }`}
                    data-testid="sections-lifecycle"
                  >
                    {selected.is_active ? "Retire" : "Reactivate"}
                  </button>
                ) : null}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                    Member bays · {selected.member_count}
                  </h3>
                  {canManage && selected.is_active ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPendingBays([]);
                        setPickAisleKey(null);
                        setMode("pick-bays");
                      }}
                      className="min-h-11 rounded-lg border border-zinc-700 px-2 text-xs font-semibold text-zinc-200"
                      data-testid="sections-add-bays"
                    >
                      Add bays
                    </button>
                  ) : null}
                </div>
                {(selected.members ?? []).length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    No bays yet — unsectioned geography stays valid.
                  </p>
                ) : (
                  <ul className="divide-y divide-zinc-800/80 overflow-hidden rounded-xl border border-zinc-800/80">
                    {(selected.members ?? []).map((member) => (
                      <li
                        key={member.id}
                        className="flex min-h-12 items-center justify-between gap-2 px-3 py-1.5"
                      >
                        <span className="font-mono text-sm text-zinc-100">
                          {member.aisle}-{member.bay}
                        </span>
                        {canManage && selected.is_active ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void handleRemoveMember({
                                department_id: member.department_id,
                                aisle: member.aisle,
                                bay: member.bay,
                              })
                            }
                            className="min-h-11 px-2 text-xs font-semibold text-rose-300"
                          >
                            Remove
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {mode === "pick-bays" ? (
        <div
          className="space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-3"
          data-testid="sections-bay-picker"
        >
          <button
            type="button"
            onClick={() =>
              setMode(selectedId ? "detail" : "create")
            }
            className="min-h-11 text-sm font-semibold text-accent"
          >
            ← Back
          </button>
          <p className="text-sm text-zinc-300">
            Pick bays by aisle. Claimed bays in other sections are disabled.
          </p>
          <p className="font-mono text-[10px] text-zinc-500">
            Selected: {pendingBays.length}
          </p>

          {!selectedAisle ? (
            <ul className="grid grid-cols-2 gap-2">
              {aisleIndex.map((aisle) => (
                <li key={aisle.key}>
                  <button
                    type="button"
                    onClick={() => setPickAisleKey(aisle.key)}
                    className="flex min-h-[4.5rem] w-full flex-col items-start justify-center rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 text-left"
                  >
                    <span className="font-mono text-sm font-bold text-zinc-50">
                      {formatMapAisleLabel(aisle)}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-500">
                      {aisle.physicalBayCount} bays
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setPickAisleKey(null)}
                className="min-h-11 text-sm font-semibold text-zinc-300"
              >
                ← Aisles
              </button>
              <ul className="divide-y divide-zinc-800/80 overflow-hidden rounded-xl border border-zinc-800/80">
                {selectedAisle.bays.map((pair) => {
                  const ref: OperationalSectionBayRef = {
                    department_id: selectedAisle.departmentId,
                    aisle: selectedAisle.aisle,
                    bay: pair.bay,
                  };
                  const key = sectionBayKey(ref);
                  const claimed = claimedKeys.has(key);
                  const alreadyInSelected = (selected?.members ?? []).some(
                    (m) => sectionBayKey(m) === key
                  );
                  const checked = pendingBays.some(
                    (b) => sectionBayKey(b) === key
                  );
                  const disabled = claimed || alreadyInSelected;
                  return (
                    <li key={key}>
                      <label
                        className={`flex min-h-12 items-center gap-3 px-3 ${
                          disabled ? "opacity-40" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked || alreadyInSelected}
                          disabled={disabled || busy}
                          onChange={() => togglePendingBay(ref)}
                          className="h-5 w-5"
                        />
                        <span className="font-mono text-sm text-zinc-100">
                          {selectedAisle.aisle}-{pair.bay}
                          {claimed ? " · other section" : ""}
                          {alreadyInSelected ? " · already in section" : ""}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {selectedId ? (
            <button
              type="button"
              disabled={busy || pendingBays.length === 0}
              onClick={() => void handleApplyPendingMembers()}
              className="flex min-h-12 w-full items-center justify-center rounded-xl border border-accent/40 bg-accent/20 text-sm font-bold text-accent disabled:opacity-40"
            >
              Add {pendingBays.length} bay
              {pendingBays.length === 1 ? "" : "s"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setMode("create")}
              className="flex min-h-12 w-full items-center justify-center rounded-xl border border-zinc-700 text-sm font-semibold text-zinc-100"
            >
              Done selecting ({pendingBays.length})
            </button>
          )}
        </div>
      ) : null}

      <p className="sr-only">{formatUnsectionedLabel()}</p>
    </div>
  );
}
