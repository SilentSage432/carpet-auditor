"use client";

import { useEffect, useState } from "react";
import { TextField } from "@/components/ui/NumberField";
import {
  dedupeRoster,
  fetchSpecialists,
  getActiveSpecialist,
  isDefaultPin,
  roleBadge,
  saveSpecialist,
} from "@/lib/specialists";
import { DepartmentPicker } from "@/components/hub/DepartmentPicker";
import { DepartmentIcon, HubIcon } from "@/components/hub/NavIcons";
import type {
  DepartmentScope,
  SpecialistRole,
  StoreSpecialist,
} from "@/lib/types";

type Props = {
  open: boolean;
  active: StoreSpecialist | null;
  onClose: () => void;
  onSelect: (specialist: StoreSpecialist, meta?: { usedDefaultPin: boolean }) => void;
};

export function SpecialistModal({ open, active, onClose, onSelect }: Props) {
  const [team, setTeam] = useState<StoreSpecialist[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<SpecialistRole>("Associate");
  const [newPin, setNewPin] = useState("");
  const [newDepartment, setNewDepartment] = useState<DepartmentScope>("flooring");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchSpecialists().then((rows) => {
      if (!cancelled) {
        setTeam(dedupeRoster(rows));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const loading = team === null;
  const roster = team ?? [];

  function requestSelect(member: StoreSpecialist) {
    // Single session: no action-level PIN — workspace is already unlocked.
    onSelect(member, { usedDefaultPin: isDefaultPin(member) });
    onClose();
  }

  async function handleAdd() {
    if (!newName.trim()) {
      setError("Enter a team member name");
      return;
    }
    if (newRole === "Supervisor" && !newPin.trim()) {
      setError("Supervisor requires a PIN code");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const active = getActiveSpecialist();
      const inheritedDept =
        newRole === "Associate"
          ? (active?.assigned_department === "appliances" ||
            active?.assigned_department === "flooring"
              ? active.assigned_department
              : newDepartment)
          : newRole === "MasterAdmin"
            ? "all"
            : newDepartment;

      const { record } = await saveSpecialist({
        name: newName.trim(),
        role: newRole,
        pin_code: newPin.trim() || null,
        assigned_department: inheritedDept,
        must_change_credentials: newRole === "Supervisor",
      });
      setTeam((prev) => dedupeRoster([record, ...(prev ?? [])]));
      setNewName("");
      setNewRole("Associate");
      setNewPin("");
      setNewDepartment("flooring");
      setAdding(false);
      requestSelect(record);
    } catch {
      setError("Could not add team member");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            aria-label="Close specialist picker"
            onClick={onClose}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="specialist-title"
            className="relative z-[61] max-h-[90dvh] w-full max-w-md overflow-y-auto glass-card theme-modal rounded-t-2xl !rounded-b-none p-4 sm:!rounded-2xl"
          >
            <h2 id="specialist-title" className="text-lg font-bold text-white">
              Select Active Specialist
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Switch the active profile for this session — no extra PIN needed.
            </p>

            {loading ? (
              <p className="mt-6 text-center text-sm text-zinc-500">Loading team…</p>
            ) : (
              <ul className="mt-4 max-h-64 space-y-1 overflow-y-auto">
                {roster.map((member) => {
                  const selected =
                    active?.id === member.id || active?.name === member.name;
                  return (
                    <li key={member.id}>
                      <button
                        type="button"
                        onClick={() => requestSelect(member)}
                        className={`flex min-h-14 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left ${
                          selected
                            ? "theme-accent-surface ring-1 ring-accent/50"
                            : "bg-zinc-950/70 hover:bg-zinc-800"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <DepartmentIcon
                            department={member.assigned_department}
                            className="h-4 w-4 shrink-0 text-accent"
                          />
                          <span className="min-w-0">
                          <span className="block truncate font-semibold text-white">
                            {member.name}
                          </span>
                          <span className="mt-0.5 block text-xs text-zinc-400">
                            {roleBadge(member)}
                          </span>
                          </span>
                        </span>
                        {selected ? (
                          <span className="shrink-0 text-xs font-bold text-accent">
                            Active
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {adding ? (
              <div className="mt-4 space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                <TextField
                  label="Name"
                  value={newName}
                  onChange={setNewName}
                  placeholder='e.g. Alex'
                />
                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium text-zinc-200">
                    Role
                  </legend>
                  <div className="grid grid-cols-3 gap-1 rounded-xl border border-zinc-800 bg-zinc-950 p-1">
                    {(
                      [
                        ["Associate", "user"],
                        ["Supervisor", "shield"],
                        ["MasterAdmin", "crown"],
                      ] as const
                    ).map(([value, icon]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setNewRole(value)}
                        className={`flex min-h-12 items-center justify-center rounded-lg ${
                          newRole === value
                            ? "bg-accent text-accent-fg"
                            : "text-zinc-400"
                        }`}
                        aria-label={value}
                      >
                        <HubIcon id={icon} className="h-4 w-4" />
                      </button>
                    ))}
                  </div>
                </fieldset>
                {(newRole === "Supervisor" || newRole === "Associate") && (
                  <DepartmentPicker
                    value={newDepartment}
                    onChange={setNewDepartment}
                    label="Department"
                  />
                )}
                <TextField
                  label={
                    newRole === "Supervisor" || newRole === "MasterAdmin"
                      ? "PIN / Password (required)"
                      : "PIN Code (optional)"
                  }
                  value={newPin}
                  onChange={setNewPin}
                  placeholder={
                    newRole === "Supervisor" || newRole === "MasterAdmin"
                      ? "e.g. 6-digit temp PIN"
                      : "Optional"
                  }
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAdding(false)}
                    className="flex min-h-12 items-center justify-center rounded-xl border border-zinc-700 text-sm font-semibold text-zinc-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleAdd()}
                    className="flex min-h-12 items-center justify-center btn-primary-glow rounded-xl text-sm disabled:opacity-40"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl border border-accent/40 text-sm font-semibold text-accent"
              >
                + Add Team Member
              </button>
            )}

            {error && (
              <p className="mt-2 text-center text-sm text-red-400">{error}</p>
            )}

            <button
              type="button"
              onClick={onClose}
              className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl border border-zinc-700 text-sm font-semibold text-zinc-300"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
