"use client";

import { useState } from "react";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { SessionGate } from "@/components/hub/SessionGate";
import { ExecutiveFloorPad } from "@/components/manager-notes";
import { actorFromSpecialist } from "@/lib/store-ops/auth";
import { isMasterAdmin } from "@/lib/rbac";
import type { StoreSpecialist } from "@/lib/types";

/**
 * Executive Floor Pad — hub route for supervisors + Master Admin.
 * Presentation opens full-screen rich-text pad; Gemini via Server Action.
 */
export default function ManagerNotesPage() {
  return (
    <SessionGate
      allow={(m) =>
        Boolean(actorFromSpecialist(m)) &&
        (isMasterAdmin(m) || m.role === "Supervisor")
      }
      denyMessage="Executive Floor Pad is for department supervisors and Master Admin."
    >
      {({ specialist, storeNumber, logout }) => (
        <ManagerNotesBody
          specialist={specialist}
          storeNumber={storeNumber}
          logout={logout}
        />
      )}
    </SessionGate>
  );
}

function ManagerNotesBody({
  specialist,
  storeNumber,
  logout,
}: {
  specialist: StoreSpecialist;
  storeNumber: string;
  logout: () => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="flex min-h-dvh flex-col">
      <NavigationHub
        title="Executive Floor Pad"
        subtitle="Rich notes · Gemini Copilot · archive"
        specialist={specialist}
        storeNumber={storeNumber}
        onLogout={logout}
      />

      <main className="mx-auto w-full max-w-lg flex-1 px-3 pb-28 pt-4">
        <section className="glass-card border-cyan-500/30 p-4 shadow-[0_0_40px_-12px_rgba(34,211,238,0.4)]">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300">
            Floor workspace
          </p>
          <h1 className="mt-1 text-xl font-bold text-zinc-50">
            Executive Floor Pad
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Full-screen rich-text notes with Dept / Aisle / Bay pills, Gemini
            task extraction, debounced autosave, and durable archive.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn-primary-glow mt-4 flex min-h-14 w-full items-center justify-center rounded-xl text-base"
          >
            Open Floor Pad
          </button>
        </section>
      </main>

      <ExecutiveFloorPad
        open={open}
        onClose={() => setOpen(false)}
        specialist={specialist}
        storeNumber={storeNumber}
      />
    </div>
  );
}
