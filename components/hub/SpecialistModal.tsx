"use client";

import { useEffect, useState } from "react";
import { PinKeypadModal } from "@/components/hub/PinKeypadModal";
import { NumberField, TextField } from "@/components/ui/NumberField";
import {
  dedupeRoster,
  fetchSpecialists,
  isDefaultPin,
  requiresPin,
  roleBadge,
  saveSpecialist,
  verifyPin,
} from "@/lib/specialists";
import type { SpecialistRole, StoreSpecialist } from "@/lib/types";

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPinMember, setPendingPinMember] = useState<StoreSpecialist | null>(
    null
  );

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

  if (!open && !pendingPinMember) return null;

  const loading = team === null;
  const roster = team ?? [];

  function requestSelect(member: StoreSpecialist) {
    if (requiresPin(member)) {
      setPendingPinMember(member);
      return;
    }
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
      const { record } = await saveSpecialist({
        name: newName.trim(),
        role: newRole,
        pin_code: newPin.trim() || null,
      });
      setTeam((prev) => dedupeRoster([record, ...(prev ?? [])]));
      setNewName("");
      setNewRole("Associate");
      setNewPin("");
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
            className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm"
            aria-label="Close specialist picker"
            onClick={onClose}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="specialist-title"
            className="relative z-[61] max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl sm:rounded-2xl"
          >
            <h2 id="specialist-title" className="text-lg font-bold text-slate-50">
              Select Active Specialist
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Supervisor profiles require a PIN. Associates switch instantly.
            </p>

            {loading ? (
              <p className="mt-6 text-center text-sm text-slate-500">Loading team…</p>
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
                            ? "bg-emerald-500/20 ring-1 ring-emerald-500/50"
                            : "bg-slate-950/70 hover:bg-slate-800"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-slate-50">
                            {member.name}
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-400">
                            {roleBadge(member)}
                            {requiresPin(member) ? " · PIN protected" : ""}
                          </span>
                        </span>
                        {selected ? (
                          <span className="shrink-0 text-xs font-bold text-emerald-400">
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
              <div className="mt-4 space-y-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <TextField
                  label="Name"
                  value={newName}
                  onChange={setNewName}
                  placeholder='e.g. Alex'
                />
                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium text-slate-200">
                    Role
                  </legend>
                  <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
                    {(
                      [
                        ["Associate", "👤 Associate"],
                        ["Supervisor", "🛡️ Supervisor"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setNewRole(value)}
                        className={`flex min-h-12 items-center justify-center rounded-lg text-sm font-semibold ${
                          newRole === value
                            ? "bg-emerald-500 text-slate-950"
                            : "text-slate-400"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <NumberField
                  label={
                    newRole === "Supervisor"
                      ? "PIN Code (required)"
                      : "PIN Code (optional)"
                  }
                  mode="digits"
                  value={newPin}
                  onChange={setNewPin}
                  placeholder={newRole === "Supervisor" ? "e.g. 1234" : "Optional"}
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAdding(false)}
                    className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleAdd()}
                    className="flex min-h-12 items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl border border-emerald-500/40 text-sm font-semibold text-emerald-300"
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
              className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-300"
            >
              Close
            </button>
          </div>
        </div>
      )}

      <PinKeypadModal
        key={pendingPinMember?.id ?? "pin-closed"}
        open={pendingPinMember != null}
        title="Enter Supervisor PIN / Password"
        subtitle={
          pendingPinMember
            ? `Unlock ${pendingPinMember.name}`
            : undefined
        }
        verify={(pin) =>
          pendingPinMember ? verifyPin(pendingPinMember, pin) : false
        }
        onClose={() => setPendingPinMember(null)}
        onSuccess={() => {
          if (!pendingPinMember) return;
          const member = pendingPinMember;
          setPendingPinMember(null);
          onSelect(member, { usedDefaultPin: isDefaultPin(member) });
          onClose();
        }}
      />
    </>
  );
}
