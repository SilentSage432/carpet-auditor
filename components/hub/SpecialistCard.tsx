"use client";

/**
 * Compact roster row — presentation only.
 * Derived availability is schedule + store-local time.
 * The switch remains the call-out exception action, not On now.
 */

import { SlidersHorizontal } from "lucide-react";
import {
  formatKnownShiftClockRange,
  isScheduledShiftDay,
  type AssociateShiftDay,
} from "@/lib/store-ops/shift-status";
import type { CurrentAvailability } from "@/lib/store-ops/current-availability";
import {
  appAccessLabel,
  appAccessStatus,
} from "@/lib/specialists";
import {
  rosterFloorBadgeLabel,
  type StoreSpecialist,
} from "@/lib/types";

const ICON_STROKE = 1.75;

export function FloorTitleBadge({ member }: { member: StoreSpecialist }) {
  const label = rosterFloorBadgeLabel(member);
  const tone =
    label === "Supervisor" || label === "Master"
      ? "border-amber-400/40 bg-amber-500/15 text-amber-200"
      : label === "CSA"
        ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-200"
        : label === "Specialist"
          ? "border-violet-400/40 bg-violet-500/15 text-violet-200"
          : "border-zinc-500/40 bg-zinc-500/15 text-zinc-300";
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide ${tone}`}
    >
      {label}
    </span>
  );
}

export function AppAccessBadge({ member }: { member: StoreSpecialist }) {
  const access = appAccessStatus(member);
  const tone =
    access === "invited"
      ? "border-amber-500/40 bg-amber-950/40 text-amber-100"
      : access === "active"
        ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-100"
        : "border-zinc-600 bg-zinc-900 text-zinc-300";
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide ${tone}`}
    >
      {appAccessLabel(access)}
    </span>
  );
}

function availabilityCaption(
  availability: CurrentAvailability,
  day: AssociateShiftDay | null | undefined
): string {
  const clocks =
    isScheduledShiftDay(day) && availability.reason !== "CALLED_OUT"
      ? formatKnownShiftClockRange(day?.start_time, day?.end_time)
      : null;
  if (clocks) return `${availability.label} · ${clocks}`;
  return availability.label;
}

export function SpecialistCard({
  member,
  day,
  availability,
  busy,
  canShift,
  canManageCard,
  callOutArmed,
  nextCaption,
  ownedBayCaption,
  onToggleDuty,
  onReassign,
  onManage,
}: {
  member: StoreSpecialist;
  day: AssociateShiftDay | null | undefined;
  availability: CurrentAvailability;
  busy: boolean;
  canShift: boolean;
  canManageCard: boolean;
  /** Persisted ON_DUTY (not called out / not OFF). Exception switch only. */
  callOutArmed: boolean;
  nextCaption?: string | null;
  ownedBayCaption?: string | null;
  onToggleDuty: () => void;
  onReassign?: () => void;
  onManage: () => void;
}) {
  const showDuty = canShift && member.role !== "MasterAdmin";
  const calledOut = availability.reason === "CALLED_OUT";

  return (
    <li className="flex min-h-12 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/50 px-2.5 py-1.5">
      <button
        type="button"
        onClick={onManage}
        disabled={!canManageCard}
        className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left disabled:opacity-80"
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-bold text-white">
              {member.name}
            </span>
            <FloorTitleBadge member={member} />
          </span>
          <span className="mt-0.5 block font-mono text-[11px] font-semibold tracking-tight text-zinc-400">
            {availabilityCaption(availability, day)}
          </span>
          {calledOut && nextCaption ? (
            <span className="mt-0.5 block font-mono text-[11px] font-medium tracking-tight text-zinc-500">
              {nextCaption}
            </span>
          ) : null}
          {calledOut && ownedBayCaption ? (
            <span className="mt-0.5 block font-mono text-[11px] font-medium tracking-tight text-zinc-500">
              {ownedBayCaption}
            </span>
          ) : null}
        </span>
      </button>

      {showDuty ? (
        <button
          type="button"
          role="switch"
          aria-checked={callOutArmed}
          aria-label={
            callOutArmed
              ? `Call out ${member.name}`
              : `Clear call-out for ${member.name}`
          }
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onToggleDuty();
          }}
          className={`relative h-7 w-12 shrink-0 rounded-full transition ${
            callOutArmed ? "bg-emerald-500" : "bg-zinc-600"
          } disabled:opacity-40`}
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${
              callOutArmed ? "left-[1.35rem]" : "left-0.5"
            }`}
          />
        </button>
      ) : null}

      {calledOut && onReassign ? (
        <button
          type="button"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onReassign();
          }}
          className="shrink-0 rounded-lg px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wide text-amber-200/90"
        >
          Reassign bays
        </button>
      ) : null}

      {canManageCard ? (
        <button
          type="button"
          onClick={onManage}
          className="btn-icon-touch text-zinc-300"
          aria-label={`Manage ${member.name}`}
        >
          <SlidersHorizontal
            className="w-4 h-4"
            strokeWidth={ICON_STROKE}
            aria-hidden
          />
        </button>
      ) : null}
    </li>
  );
}
