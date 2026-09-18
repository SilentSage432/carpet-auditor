"use client";

/**
 * Compact People row — presentation only.
 * Derived availability is schedule + store-local time.
 * Call-out is an explicit exception action, not a presence toggle.
 */

import { SlidersHorizontal } from "lucide-react";
import {
  formatKnownShiftClockRange,
  isScheduledShiftDay,
  type AssociateShiftDay,
} from "@/lib/store-ops/shift-status";
import type { CurrentAvailability } from "@/lib/store-ops/current-availability";
import { rosterAvailabilityToneClass } from "@/lib/store-ops/roster-people-presentation";
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
  /** Persisted scheduled today (not called out / not OFF). Exception action only. */
  callOutArmed: boolean;
  nextCaption?: string | null;
  ownedBayCaption?: string | null;
  onToggleDuty: () => void;
  onReassign?: () => void;
  onManage: () => void;
}) {
  const showDuty = canShift && member.role !== "MasterAdmin";
  const calledOut = availability.reason === "CALLED_OUT";
  const availabilityTone = rosterAvailabilityToneClass(availability);

  return (
    <li
      className={`flex min-h-12 items-center gap-2 rounded-xl border px-2.5 py-1.5 ${
        calledOut
          ? "border-amber-500/35 bg-amber-950/20"
          : "border-zinc-800 bg-zinc-950/50"
      }`}
      data-testid="roster-person-row"
      data-availability={availability.reason}
    >
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
          <span
            className={`mt-0.5 block font-mono text-[11px] font-semibold tracking-tight ${availabilityTone}`}
          >
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

      {showDuty && calledOut ? (
        <button
          type="button"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onToggleDuty();
          }}
          className="shrink-0 rounded-lg border border-zinc-700/80 px-2 py-1.5 font-mono text-[10px] font-semibold text-zinc-300"
          data-testid="roster-clear-call-out"
        >
          Clear call-out
        </button>
      ) : null}

      {showDuty && !calledOut && callOutArmed ? (
        <button
          type="button"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onToggleDuty();
          }}
          className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-950/25 px-2 py-1.5 font-mono text-[10px] font-semibold text-amber-100"
          data-testid="roster-mark-called-out"
        >
          Mark called out
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
          className="shrink-0 rounded-lg px-1.5 py-1 font-mono text-[10px] font-medium text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
          data-testid="roster-reassign-recovery"
        >
          Reassign
        </button>
      ) : null}

      {canManageCard ? (
        <button
          type="button"
          onClick={onManage}
          className="btn-icon-touch text-zinc-300"
          aria-label={`Open ${member.name}`}
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
