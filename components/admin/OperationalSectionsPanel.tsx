"use client";

/**
 * RD-3 + SECTION-UX-001 — Operational Sections management
 * (More → Department Setup).
 * Aisle-first multi-select expands to explicit active bay membership.
 * Stewardship only — not weekly assignment.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StoreSpecialist } from "@/lib/types";
import type { StoreAisle } from "@/lib/store-ops/store-aisles";
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
  assertSectionAislePreviewFresh,
  composeDepartmentAisleIndexForSections,
  composeSectionAisleMembershipPreview,
  composeSectionAisleSelectionRows,
  countDiscoverableBaysForSection,
  indexClaimedBaysFromSections,
  toggleAisleKeySelection,
} from "@/lib/store-ops/section-aisle-membership";
import {
  formatUnsectionedLabel,
  sectionBayKey,
  type OperationalSectionBayRef,
  type OperationalSectionView,
} from "@/lib/store-ops/operational-sections";
import { workingDepartmentId } from "@/lib/admin-department-context";
import { useWorkingDepartment } from "@/lib/use-working-department";
import {
  classifySectionsEmptyState,
  resolveOperationalSectionsListFilter,
  shouldApplySectionsFetchResult,
} from "@/lib/store-ops/operational-sections-department-filter";

type Props = {
  specialist: StoreSpecialist;
  departments: Department[];
  locations: StoreLocation[];
  registryAisles?: StoreAisle[];
  onChanged?: () => void;
  /** Deep-link focus from Map bay sheet */
  focusSectionId?: string | null;
};

type DraftMode = "list" | "create" | "detail" | "pick-aisles";

export function OperationalSectionsPanel({
  specialist,
  departments,
  locations,
  registryAisles = [],
  onChanged,
  focusSectionId = null,
}: Props) {
  const canManage = canManageOperationalSections(specialist);
  const working = useWorkingDepartment(specialist);
  const pinnedDepartmentId = workingDepartmentId(specialist, departments);
  const listFilter = useMemo(
    () =>
      resolveOperationalSectionsListFilter({
        pinnedDepartmentId,
        workingScopeIsAll: working === "all",
        departmentsLoaded: departments.length > 0 || working === "all",
      }),
    [pinnedDepartmentId, working, departments.length]
  );
  /** Explicit pin for create/edit; never departments[0] fallback. */
  const departmentId = listFilter.departmentId ?? "";

  const [sections, setSections] = useState<OperationalSectionView[]>([]);
  const [roster, setRoster] = useState<StoreSpecialist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [mode, setMode] = useState<DraftMode>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fetchGenRef = useRef(0);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState<string>("");
  const [pendingBays, setPendingBays] = useState<OperationalSectionBayRef[]>(
    []
  );
  /** SECTION-UX-001 — multi-aisle selection (keys from composeMapAisleIndex). */
  const [selectedAisleKeys, setSelectedAisleKeys] = useState<string[]>([]);
  const [aislePreviewFingerprint, setAislePreviewFingerprint] = useState<
    string | null
  >(null);

  const reload = useCallback(async () => {
    if (listFilter.awaitingResolution) {
      setLoading(true);
      return;
    }
    const requestId = ++fetchGenRef.current;
    setLoading(true);
    setError(null);
    try {
      const [sec, people] = await Promise.all([
        fetchOperationalSections(specialist, {
          departmentId: listFilter.departmentId,
          includeRetired: showRetired,
          includeMembers: true,
        }),
        fetchSpecialists().catch(() => [] as StoreSpecialist[]),
      ]);
      if (!shouldApplySectionsFetchResult(requestId, fetchGenRef.current)) {
        return;
      }
      setSections(sec.sections ?? []);
      setRoster(people.filter((p) => p.is_active !== false));
    } catch (err) {
      if (!shouldApplySectionsFetchResult(requestId, fetchGenRef.current)) {
        return;
      }
      // Keep prior sections — do not treat load failure as an empty list.
      setError(
        err instanceof Error ? err.message : "Could not load Operational Sections"
      );
    } finally {
      if (shouldApplySectionsFetchResult(requestId, fetchGenRef.current)) {
        setLoading(false);
      }
    }
  }, [specialist, listFilter, showRetired]);

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
      composeDepartmentAisleIndexForSections({
        locations,
        departments,
        departmentId,
        registryAisles,
      }),
    [locations, departments, departmentId, registryAisles]
  );

  const claimedByKey = useMemo(
    () =>
      indexClaimedBaysFromSections({
        sections,
        excludeSectionId: selectedId,
      }),
    [sections, selectedId]
  );

  const existingMemberKeys = useMemo(() => {
    const set = new Set<string>();
    for (const member of selected?.members ?? []) {
      set.add(sectionBayKey(member));
    }
    // Create flow: pending bays already chosen count as "existing" for preview.
    if (!selectedId) {
      for (const bay of pendingBays) set.add(sectionBayKey(bay));
    }
    return set;
  }, [selected?.members, selectedId, pendingBays]);

  const aisleRows = useMemo(
    () =>
      composeSectionAisleSelectionRows({
        aisleIndex,
        selectedAisleKeys,
        claimedByKey,
        existingMemberKeys,
      }),
    [aisleIndex, selectedAisleKeys, claimedByKey, existingMemberKeys]
  );

  const aisleMembershipPreview = useMemo(
    () =>
      composeSectionAisleMembershipPreview({
        aisleIndex,
        selectedAisleKeys,
        claimedByKey,
        existingMemberKeys,
      }),
    [aisleIndex, selectedAisleKeys, claimedByKey, existingMemberKeys]
  );

  function handleToggleAisleKey(aisleKey: string) {
    const next = toggleAisleKeySelection(selectedAisleKeys, aisleKey);
    const preview = composeSectionAisleMembershipPreview({
      aisleIndex,
      selectedAisleKeys: next,
      claimedByKey,
      existingMemberKeys,
    });
    setSelectedAisleKeys(next);
    setAislePreviewFingerprint(preview.fingerprint);
  }

  const discoverableBays = useMemo(() => {
    if (!selected?.is_active) {
      return { discoverable_count: 0, aisle_labels: [] as string[] };
    }
    return countDiscoverableBaysForSection({
      aisleIndex,
      sectionMembers: selected.members ?? [],
      claimedByKey,
    });
  }, [selected, aisleIndex, claimedByKey]);

  function openCreate() {
    setName("");
    setDescription("");
    setOwnerId("");
    setPendingBays([]);
    setSelectedAisleKeys([]);
    setAislePreviewFingerprint(null);
    setMode("create");
  }

  function openAislePicker() {
    setSelectedAisleKeys([]);
    setAislePreviewFingerprint(null);
    if (!selectedId) {
      // Keep pendingBays from prior create picks; only clear aisle draft.
    } else {
      setPendingBays([]);
    }
    setMode("pick-aisles");
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

  function recomputeAislePreviewFresh() {
    return composeSectionAisleMembershipPreview({
      aisleIndex,
      selectedAisleKeys,
      claimedByKey,
      existingMemberKeys,
    });
  }

  async function handleApplyAisleSelection() {
    if (!canManage) return;
    const recomputed = recomputeAislePreviewFresh();
    const freshness = assertSectionAislePreviewFresh(
      aislePreviewFingerprint ?? recomputed.fingerprint,
      recomputed
    );
    if (!freshness.ok) {
      setError(freshness.message);
      return;
    }
    if (recomputed.total_bays_to_add === 0) {
      setError(
        recomputed.conflicts.length > 0
          ? "Selected aisles have no available bays — conflicted bays stay in their current section."
          : "Selected aisles have no available active bays to add."
      );
      return;
    }

    if (selectedId && selected) {
      setBusy(true);
      setError(null);
      try {
        await addOperationalSectionMembersClient(
          specialist,
          selected.id,
          recomputed.bays_to_add
        );
        setPendingBays([]);
        setSelectedAisleKeys([]);
        setMode("detail");
        await reload();
        onChanged?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add bays");
      } finally {
        setBusy(false);
      }
      return;
    }

    // Create flow: merge into pending, return to create form (no persistence yet).
    setPendingBays((prev) => {
      const seen = new Set(prev.map((b) => sectionBayKey(b)));
      const next = [...prev];
      for (const bay of recomputed.bays_to_add) {
        const key = sectionBayKey(bay);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(bay);
      }
      return next;
    });
    setSelectedAisleKeys([]);
    setMode("create");
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

  useEffect(() => {
    if (mode === "detail" && selected) {
      setName(selected.name);
      setDescription(selected.description ?? "");
      setOwnerId(selected.primary_owner_specialist_id ?? "");
    }
  }, [mode, selected]);

  const emptyKind = classifySectionsEmptyState({
    loading,
    error,
    sectionCount: sections.length,
    filter: listFilter,
  });

  if (listFilter.awaitingResolution) {
    return (
      <p
        className="text-sm text-zinc-400"
        data-testid="sections-awaiting-department"
      >
        Loading department context…
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="operational-sections-panel">
      <p className="text-[11px] leading-snug text-zinc-500">
        Persistent bay stewardship. Not weekly assignment and not proof of work.
        A bay belongs to at most one active section. Numbered aisles and named
        zones (e.g. SHOW-L, CARPET-WALL) appear together — select the whole
        aisle/zone to include its currently documented active bays.
        {listFilter.storeWide
          ? " Full Store pin lists every department’s sections."
          : null}
      </p>

      {error ? (
        <p className="text-sm text-rose-300" role="alert">
          {error}
        </p>
      ) : null}

      {mode === "list" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {canManage && listFilter.canManageInDepartment ? (
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl border border-accent/40 bg-accent/15 px-3 text-sm font-bold text-accent"
                data-testid="sections-create"
              >
                New section
              </button>
            ) : null}
            {canManage && listFilter.storeWide ? (
              <p
                className="w-full text-[11px] leading-snug text-zinc-500"
                data-testid="sections-need-department"
              >
                Pin a working department to create or edit sections. Viewing all
                store sections below.
              </p>
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

          {emptyKind === "loading" ? (
            <p className="text-sm text-zinc-500">Loading sections…</p>
          ) : emptyKind === "none_in_department" ? (
            <p
              className="rounded-xl border border-dashed border-zinc-700 px-3 py-4 text-sm text-zinc-400"
              data-testid="sections-empty-filtered"
            >
              No Operational Sections in this department. Pin Full Store to see
              every department, or create a section here.
            </p>
          ) : emptyKind === "none_configured" ? (
            <p
              className="rounded-xl border border-dashed border-zinc-700 px-3 py-4 text-sm text-zinc-400"
              data-testid="sections-empty"
            >
              No Operational Sections yet. Create one, then add aisles (all
              active bays in each aisle).
            </p>
          ) : emptyKind === "error" && sections.length === 0 ? (
            <p
              className="rounded-xl border border-dashed border-rose-700/50 px-3 py-4 text-sm text-rose-200/80"
              data-testid="sections-load-failed"
            >
              Sections could not be loaded. Previous data was not cleared — try
              again.
            </p>
          ) : sections.length === 0 ? null : (
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
                Pending bays from aisles: {pendingBays.length}
              </p>
              <button
                type="button"
                onClick={openAislePicker}
                className="flex min-h-12 w-full items-center justify-center rounded-xl border border-zinc-700 text-sm font-semibold text-zinc-100"
                data-testid="sections-pick-bays"
              >
                Select aisles
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
                      onClick={openAislePicker}
                      className="min-h-11 rounded-lg border border-zinc-700 px-2 text-xs font-semibold text-zinc-200"
                      data-testid="sections-add-bays"
                    >
                      Add aisles
                    </button>
                  ) : null}
                </div>
                {canManage &&
                selected.is_active &&
                discoverableBays.discoverable_count > 0 ? (
                  <div
                    className="mb-2 rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2"
                    data-testid="sections-discoverable-bays"
                  >
                    <p className="text-[12px] font-semibold text-amber-50">
                      {discoverableBays.discoverable_count} newly mapped bay
                      {discoverableBays.discoverable_count === 1 ? "" : "s"}{" "}
                      available
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-amber-100/75">
                      In {discoverableBays.aisle_labels.join(", ")}. Not added
                      automatically — use Add aisles and re-select those
                      aisles/zones to include them.
                    </p>
                  </div>
                ) : null}
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

      {mode === "pick-aisles" ? (
        <div
          className="space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-3"
          data-testid="sections-bay-picker"
        >
          <button
            type="button"
            onClick={() => {
              setSelectedAisleKeys([]);
              setMode(selectedId ? "detail" : "create");
            }}
            className="min-h-11 text-sm font-semibold text-accent"
            data-testid="sections-aisle-picker-back"
          >
            ← Back
          </button>
          <p className="text-sm text-zinc-300">
            Select aisles or named zones to include every currently documented
            active bay. Future bays are never auto-included. Conflicted bays in
            other sections are never moved silently. Joint stewardship (multiple
            owners) is not available yet — one primary owner per section.
          </p>

          {aisleRows.length === 0 ? (
            <p
              className="rounded-xl border border-dashed border-zinc-700 px-3 py-4 text-sm text-zinc-400"
              data-testid="sections-aisle-picker-empty"
            >
              No active aisles documented for this department yet. Map bays
              first, then return here to include them.
            </p>
          ) : (
            <ul
              className="space-y-2"
              data-testid="sections-aisle-multi-select"
            >
              {aisleRows.map((row) => (
                <li key={row.aisle_key}>
                  <label
                    className={`flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 active:scale-[0.99] ${
                      row.selected
                        ? "border-accent/45 bg-accent/10"
                        : "border-zinc-800 bg-zinc-950/60"
                    } ${row.zero_active_bays ? "opacity-50" : ""}`}
                    data-testid="sections-aisle-option"
                  >
                    <input
                      type="checkbox"
                      checked={row.selected}
                      disabled={busy || row.zero_active_bays}
                      onChange={() => handleToggleAisleKey(row.aisle_key)}
                      className="h-5 w-5 shrink-0"
                      data-testid="sections-aisle-checkbox"
                    />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block font-mono text-sm font-bold text-zinc-50">
                        {row.aisle_label}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-zinc-500">
                        {row.active_bay_count} active bay
                        {row.active_bay_count === 1 ? "" : "s"}
                        {row.available_bay_count < row.active_bay_count
                          ? ` · ${row.available_bay_count} available`
                          : ""}
                        {row.conflict_bay_count > 0
                          ? ` · ${row.conflict_bay_count} in other section`
                          : ""}
                        {row.already_member_count > 0
                          ? ` · ${row.already_member_count} already included`
                          : ""}
                        {row.zero_active_bays ? " · no active bays" : ""}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {selectedAisleKeys.length > 0 ? (
            <div
              className="space-y-2 rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-3"
              data-testid="sections-aisle-preview"
            >
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300">
                Preview before save
              </p>
              <ul className="space-y-1 text-[12px] text-cyan-50">
                <li data-testid="sections-aisle-preview-aisles">
                  Aisles:{" "}
                  {aisleMembershipPreview.selected_aisle_labels.join(", ") ||
                    "—"}
                </li>
                <li data-testid="sections-aisle-preview-total">
                  Active bays to add: {aisleMembershipPreview.total_bays_to_add}
                </li>
                {aisleMembershipPreview.conflicts.length > 0 ? (
                  <li
                    className="text-amber-100"
                    data-testid="sections-aisle-preview-conflicts"
                  >
                    Conflicts (kept in other section):{" "}
                    {aisleMembershipPreview.conflicts.length}
                    {" — "}
                    {aisleMembershipPreview.conflicts
                      .slice(0, 6)
                      .map((c) => `${c.aisle_label} bay ${c.bay}`)
                      .join(", ")}
                    {aisleMembershipPreview.conflicts.length > 6
                      ? "…"
                      : ""}
                  </li>
                ) : (
                  <li data-testid="sections-aisle-preview-conflicts">
                    Conflicts: none
                  </li>
                )}
                {aisleMembershipPreview.zero_active_aisles.length > 0 ? (
                  <li
                    className="text-amber-100/90"
                    data-testid="sections-aisle-preview-zero"
                  >
                    Zero active bays:{" "}
                    {aisleMembershipPreview.zero_active_aisles.join(", ")}
                  </li>
                ) : null}
                {aisleMembershipPreview.partial_aisles.length > 0 ? (
                  <li data-testid="sections-aisle-preview-partial">
                    Partial aisles:{" "}
                    {aisleMembershipPreview.partial_aisles.join(", ")}
                  </li>
                ) : null}
              </ul>
              <p className="text-[10px] leading-snug text-cyan-100/65">
                {aisleMembershipPreview.note}
              </p>
            </div>
          ) : null}

          <button
            type="button"
            disabled={
              busy ||
              selectedAisleKeys.length === 0 ||
              aisleMembershipPreview.total_bays_to_add === 0
            }
            onClick={() => void handleApplyAisleSelection()}
            className="flex min-h-12 w-full items-center justify-center rounded-xl border border-accent/40 bg-accent/20 text-sm font-bold text-accent disabled:opacity-40"
            data-testid="sections-aisle-confirm"
          >
            {selectedId
              ? `Add ${aisleMembershipPreview.total_bays_to_add} bay${
                  aisleMembershipPreview.total_bays_to_add === 1 ? "" : "s"
                }`
              : `Include ${aisleMembershipPreview.total_bays_to_add} bay${
                  aisleMembershipPreview.total_bays_to_add === 1 ? "" : "s"
                }`}
          </button>
        </div>
      ) : null}

      <p className="sr-only">{formatUnsectionedLabel()}</p>
    </div>
  );
}
