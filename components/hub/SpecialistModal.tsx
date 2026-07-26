"use client";

import { useEffect, useState } from "react";
import { fetchSpecialists, saveSpecialist } from "@/lib/specialists";
import type { StoreSpecialist } from "@/lib/types";
import { TextField } from "@/components/ui/NumberField";

type Props = {
  open: boolean;
  active: StoreSpecialist | null;
  onClose: () => void;
  onSelect: (specialist: StoreSpecialist) => void;
};

export function SpecialistModal({ open, active, onClose, onSelect }: Props) {
  const [team, setTeam] = useState<StoreSpecialist[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void fetchSpecialists().then((rows) => {
      if (!cancelled) {
        setTeam(rows);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  async function handleAdd() {
    if (!newName.trim()) {
      setError("Enter an associate name");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { record } = await saveSpecialist({ name: newName.trim() });
      setTeam((prev) =>
        [record, ...prev.filter((p) => p.id !== record.id)].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      );
      setNewName("");
      setAdding(false);
      onSelect(record);
      onClose();
    } catch {
      setError("Could not add associate");
    } finally {
      setSaving(false);
    }
  }

  return (
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
          Audits and remnants will be stamped with this name.
        </p>

        {loading ? (
          <p className="mt-6 text-center text-sm text-slate-500">Loading team…</p>
        ) : (
          <ul className="mt-4 max-h-64 space-y-1 overflow-y-auto">
            {team.map((member) => {
              const selected = active?.id === member.id || active?.name === member.name;
              return (
                <li key={member.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(member);
                      onClose();
                    }}
                    className={`flex min-h-12 w-full items-center justify-between rounded-xl px-3 text-left ${
                      selected
                        ? "bg-emerald-500/20 ring-1 ring-emerald-500/50"
                        : "bg-slate-950/70 hover:bg-slate-800"
                    }`}
                  >
                    <span>
                      <span className="block font-semibold text-slate-50">
                        👤 {member.name}
                      </span>
                      <span className="text-xs text-slate-400">{member.role}</span>
                    </span>
                    {selected ? (
                      <span className="text-xs font-bold text-emerald-400">Active</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {adding ? (
          <div className="mt-4 space-y-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <TextField
              label="Associate name"
              value={newName}
              onChange={setNewName}
              placeholder="e.g. Jordan"
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
            + Add Associate
          </button>
        )}

        {error && <p className="mt-2 text-center text-sm text-red-400">{error}</p>}

        <button
          type="button"
          onClick={onClose}
          className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-300"
        >
          Close
        </button>
      </div>
    </div>
  );
}
