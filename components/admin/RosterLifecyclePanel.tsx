"use client";

/**
 * DEPTSYNC-SECTION-OWNERSHIP-002 — schedule-free roster lifecycle UI.
 * MasterAdmin: add / deactivate (with ownership transfer) / reactivate.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { suggestUsername, isMasterAdmin } from "@/lib/rbac";
import {
  createRosterMember,
  deactivateRosterMemberClient,
  fetchRosterDeactivateImpact,
  fetchRosterLifecycle,
  reactivateRosterMemberClient,
} from "@/lib/store-ops/client";
import type {
  DeactivateImpact,
  RosterLifecycleMember,
} from "@/lib/store-ops/roster-lifecycle";
import { toastError, toastSuccess } from "@/lib/toast";
import type { DepartmentScope, StoreSpecialist } from "@/lib/types";

type Props = {
  specialist: StoreSpecialist;
};

export function RosterLifecyclePanel({ specialist }: Props) {
  const canManage = isMasterAdmin(specialist);
  const [active, setActive] = useState<RosterLifecycleMember[]>([]);
  const [inactive, setInactive] = useState<RosterLifecycleMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [department, setDepartment] = useState<DepartmentScope>("flooring");
  const [impact, setImpact] = useState<DeactivateImpact | null>(null);
  const [transferOwnerBySection, setTransferOwnerBySection] = useState<
    Record<string, string>
  >({});

  const refresh = useCallback(async () => {
    if (!canManage) return;
    setError(null);
    try {
      const data = await fetchRosterLifecycle(specialist);
      setActive(data.active);
      setInactive(data.inactive);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load roster");
    } finally {
      setLoading(false);
    }
  }, [canManage, specialist]);

  useEffect(() => {
    let cancelled = false;
    if (!canManage) {
      return;
    }
    void (async () => {
      try {
        const data = await fetchRosterLifecycle(specialist);
        if (cancelled) return;
        setActive(data.active);
        setInactive(data.inactive);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load roster");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage, specialist]);

  const replacementCandidates = useMemo(
    () => active.filter((m) => m.role === "Associate" || m.role === "Supervisor"),
    [active]
  );

  if (!canManage) return null;

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createRosterMember(specialist, {
        name: trimmed,
        department,
        role: "Associate",
        username: suggestUsername(trimmed, department),
        store_number: specialist.store_number,
      });
      setName("");
      toastSuccess(
        `Added ${trimmed}. Standing capacity unchanged — authorize capacity separately if needed.`
      );
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not add associate";
      setError(msg);
      toastError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function openDeactivate(member: RosterLifecycleMember) {
    setBusy(true);
    setError(null);
    setTransferOwnerBySection({});
    try {
      const { impact: next } = await fetchRosterDeactivateImpact(
        specialist,
        member.id
      );
      setImpact(next);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not load deactivate impact";
      setError(msg);
      toastError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeactivate() {
    if (!impact || busy) return;
    setBusy(true);
    setError(null);
    try {
      const transfers = impact.owned_sections
        .map((section) => ({
          section_id: section.section_id,
          new_owner_specialist_id:
            transferOwnerBySection[section.section_id] ?? "",
        }))
        .filter((row) => row.new_owner_specialist_id);
      await deactivateRosterMemberClient(
        specialist,
        impact.specialist_id,
        transfers
      );
      toastSuccess(`${impact.specialist_name} deactivated. History preserved.`);
      setImpact(null);
      await refresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not deactivate associate";
      setError(msg);
      toastError(msg);
      try {
        const { impact: next } = await fetchRosterDeactivateImpact(
          specialist,
          impact.specialist_id
        );
        setImpact(next);
      } catch {
        /* keep prior impact */
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleReactivate(member: RosterLifecycleMember) {
    setBusy(true);
    setError(null);
    try {
      await reactivateRosterMemberClient(specialist, member.id);
      toastSuccess(
        `${member.name} reactivated. Prior section ownership was not restored.`
      );
      await refresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not reactivate associate";
      setError(msg);
      toastError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-testid="roster-lifecycle-panel"
      className="space-y-3 rounded-2xl border border-emerald-500/25 bg-slate-900/90 p-4"
    >
      <div>
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">
          Roster lifecycle
        </p>
        <p className="mt-1 text-[11px] leading-snug text-zinc-400">
          Add, deactivate, or reactivate associates without shift schedules.
          Standing capacity and historical assignments are never silently rewritten.
        </p>
      </div>

      {error ? (
        <p className="text-xs font-medium text-rose-300" role="alert">
          {error}
        </p>
      ) : null}

      <div className="space-y-2 rounded-xl border border-zinc-700/80 bg-zinc-950/50 p-3">
        <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-400">
          Add associate
        </p>
        <input
          data-testid="roster-lifecycle-add-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white"
        />
        <select
          data-testid="roster-lifecycle-add-dept"
          value={department}
          onChange={(e) => setDepartment(e.target.value as DepartmentScope)}
          className="min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white"
        >
          <option value="flooring">Flooring / Home Decor</option>
          <option value="appliances">Appliances</option>
        </select>
        <button
          type="button"
          data-testid="roster-lifecycle-add"
          disabled={busy || !name.trim()}
          onClick={() => void handleAdd()}
          className="flex min-h-11 w-full items-center justify-center rounded-lg border border-emerald-400/40 bg-emerald-950/40 px-3 text-sm font-bold text-emerald-50 disabled:opacity-40"
        >
          {busy ? "Working…" : "Add associate"}
        </button>
      </div>

      <div>
        <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-400">
          Active ({loading ? "…" : active.length})
        </p>
        <ul className="space-y-2">
          {active.map((member) => (
            <li
              key={member.id}
              data-testid={`roster-lifecycle-active-${member.id}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">
                  {member.name}
                </p>
                <p className="font-mono text-[10px] uppercase text-zinc-500">
                  {member.role} · {member.home_department || member.assigned_department || "—"}
                </p>
              </div>
              <button
                type="button"
                data-testid={`roster-lifecycle-deactivate-${member.id}`}
                disabled={busy}
                onClick={() => void openDeactivate(member)}
                className="shrink-0 rounded-lg border border-rose-400/40 px-2.5 py-1.5 text-[11px] font-bold text-rose-100 disabled:opacity-40"
              >
                Deactivate
              </button>
            </li>
          ))}
          {!loading && active.length === 0 ? (
            <li className="rounded-lg border border-dashed border-zinc-700 px-3 py-3 text-center text-xs text-zinc-500">
              No active associates.
            </li>
          ) : null}
        </ul>
      </div>

      <div>
        <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-400">
          Inactive ({loading ? "…" : inactive.length})
        </p>
        <ul className="space-y-2">
          {inactive.map((member) => (
            <li
              key={member.id}
              data-testid={`roster-lifecycle-inactive-${member.id}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 px-2.5 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-300">
                  {member.name}
                </p>
                <p className="font-mono text-[10px] uppercase text-zinc-600">
                  {member.status || "suspended"}
                </p>
              </div>
              <button
                type="button"
                data-testid={`roster-lifecycle-reactivate-${member.id}`}
                disabled={busy}
                onClick={() => void handleReactivate(member)}
                className="shrink-0 rounded-lg border border-emerald-400/40 px-2.5 py-1.5 text-[11px] font-bold text-emerald-100 disabled:opacity-40"
              >
                Reactivate
              </button>
            </li>
          ))}
          {!loading && inactive.length === 0 ? (
            <li className="rounded-lg border border-dashed border-zinc-700 px-3 py-3 text-center text-xs text-zinc-500">
              No inactive associates.
            </li>
          ) : null}
        </ul>
      </div>

      {impact ? (
        <div
          data-testid="roster-lifecycle-deactivate-dialog"
          className="space-y-2 rounded-xl border border-amber-500/35 bg-amber-950/25 p-3"
        >
          <p className="text-sm font-semibold text-amber-50">
            Deactivate {impact.specialist_name}?
          </p>
          {impact.block_reasons.map((reason) => (
            <p key={reason} className="text-[11px] leading-snug text-rose-200">
              {reason}
            </p>
          ))}
          {impact.warnings.map((warning) => (
            <p key={warning} className="text-[11px] leading-snug text-amber-100/80">
              {warning}
            </p>
          ))}
          {impact.owned_sections.length > 0 ? (
            <div className="space-y-2">
              <p className="font-mono text-[10px] font-bold uppercase text-amber-200/90">
                Transfer permanent ownership
              </p>
              {impact.owned_sections.map((section) => (
                <label
                  key={section.section_id}
                  className="block space-y-1 text-[11px] text-amber-50/90"
                >
                  <span>{section.section_name}</span>
                  <select
                    data-testid={`roster-lifecycle-transfer-${section.section_id}`}
                    value={transferOwnerBySection[section.section_id] ?? ""}
                    onChange={(e) =>
                      setTransferOwnerBySection((prev) => ({
                        ...prev,
                        [section.section_id]: e.target.value,
                      }))
                    }
                    className="min-h-10 w-full rounded-lg border border-amber-500/30 bg-zinc-950 px-2 text-sm text-white"
                  >
                    <option value="">Select new owner…</option>
                    {replacementCandidates
                      .filter((m) => m.id !== impact.specialist_id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
            </div>
          ) : null}
          {impact.open_assignment_count > 0 ? (
            <p className="text-[11px] text-amber-100/75">
              Open assignments: {impact.open_assignment_count} (not auto-reassigned)
            </p>
          ) : null}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              data-testid="roster-lifecycle-deactivate-cancel"
              disabled={busy}
              onClick={() => setImpact(null)}
              className="min-h-10 flex-1 rounded-lg border border-zinc-600 px-3 text-xs font-bold text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="roster-lifecycle-deactivate-confirm"
              disabled={
                busy ||
                impact.role === "MasterAdmin" ||
                impact.owned_sections.some(
                  (s) => !transferOwnerBySection[s.section_id]
                )
              }
              onClick={() => void confirmDeactivate()}
              className="min-h-10 flex-1 rounded-lg border border-rose-400/50 bg-rose-950/50 px-3 text-xs font-bold text-rose-50 disabled:opacity-40"
            >
              Confirm deactivate
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
