"use client";

import { useEffect, useState } from "react";
import {
  dedupeRoster,
  fetchSpecialists,
  isDefaultPin,
  roleBadge,
} from "@/lib/specialists";
import { DepartmentIcon } from "@/components/hub/NavIcons";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  open: boolean;
  active: StoreSpecialist | null;
  onClose: () => void;
  onSelect: (specialist: StoreSpecialist, meta?: { usedDefaultPin: boolean }) => void;
};

/**
 * Session specialist picker. Does not create roster rows —
 * Add Team Member lives on the Roster tab (store_specialists insert).
 */
export function SpecialistModal({ open, active, onClose, onSelect }: Props) {
  const [team, setTeam] = useState<StoreSpecialist[] | null>(null);

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

            <p className="mt-4 text-center text-xs text-zinc-500">
              Add team members from the Roster tab.
            </p>

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
