"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { isMasterAdmin } from "@/lib/rbac";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  specialist: StoreSpecialist | null;
  onBulkGenerate?: () => void;
  onTriggerRotation?: () => void;
};

/**
 * Super Admin Quick-Actions — high-visibility shortcuts on Store Map & Dashboard.
 */
export function SuperAdminQuickActions({
  specialist,
  onBulkGenerate,
  onTriggerRotation,
}: Props) {
  if (!isMasterAdmin(specialist)) return null;

  return (
    <section
      aria-label="Super Admin quick actions"
      className="mb-5 overflow-hidden rounded-2xl border-2 border-amber-400/60 bg-amber-950/40"
    >
      <div className="border-b border-amber-500/30 bg-amber-500/15 px-3 py-2">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
          Super Admin · Quick Actions
        </p>
      </div>
      <div className="grid gap-2 p-3 sm:grid-cols-3">
        {onBulkGenerate ? (
          <QuickButton onClick={onBulkGenerate}>
            + Bulk Generate Aisles
          </QuickButton>
        ) : (
          <QuickLink href="/admin/store-map#bulk-generate">
            + Bulk Generate Aisles
          </QuickLink>
        )}
        {onTriggerRotation ? (
          <QuickButton onClick={onTriggerRotation}>
            ⚡ Trigger Weekly Rotation
          </QuickButton>
        ) : (
          <QuickLink href="/admin/store-map#weekly-rotation">
            ⚡ Trigger Weekly Rotation
          </QuickLink>
        )}
        <QuickLink href="/admin/supervisors">
          👥 Manage Supervisor Logins
        </QuickLink>
      </div>
    </section>
  );
}

function QuickButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 items-center justify-center rounded-xl border-2 border-amber-400/50 bg-slate-950 px-3 text-center text-sm font-bold text-amber-100 transition active:scale-[0.98]"
    >
      {children}
    </button>
  );
}

function QuickLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-14 items-center justify-center rounded-xl border-2 border-amber-400/50 bg-slate-950 px-3 text-center text-sm font-bold text-amber-100 transition active:scale-[0.98]"
    >
      {children}
    </Link>
  );
}
