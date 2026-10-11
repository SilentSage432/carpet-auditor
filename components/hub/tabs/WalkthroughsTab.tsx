"use client";

/**
 * RD-1 Walkthroughs shell — intentional placeholder.
 * No persistence until FLOORPAD-001 / walkthrough domain tranche.
 */

import Link from "next/link";
import { HubIcon } from "@/components/hub/NavIcons";
import type { WorkflowTabProps } from "@/components/hub/tabs/tab-props";
import { buildExecutiveFloorPadHref } from "@/lib/specialty-tools";
import { isSupervisor } from "@/lib/specialists";

export function WalkthroughsTab({ specialist }: WorkflowTabProps) {
  const canOpenFloorPad = isSupervisor(specialist);

  return (
    <main className="hub-main hub-floor-command">
      <div className="mx-auto flex max-w-lg flex-col gap-4 px-3 pb-28 pt-4 sm:px-4">
        <header>
          <h2 className="text-lg font-bold tracking-tight text-zinc-50">
            Walkthroughs
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Collaborative floor conversations — not scoring or surveillance.
          </p>
        </header>

        <section
          aria-label="Walkthroughs not ready"
          className="rounded-2xl border border-dashed border-zinc-700/80 bg-zinc-950/50 px-4 py-6"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-700/60 bg-zinc-900/80">
            <HubIcon id="notes" className="h-6 w-6 text-accent" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-zinc-100">
            Walkthrough capture is coming next
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            This tab is the future home for walking an area with a team member,
            recording what is working, opportunities, agreed actions, and
            follow-ups. No walkthrough records are invented here.
          </p>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-zinc-500">
            <li>Start a walkthrough with a teammate</li>
            <li>Bind observations to aisles, bays, or sections</li>
            <li>Close follow-ups with completion evidence</li>
          </ul>
        </section>

        <div className="grid grid-cols-1 gap-2">
          {canOpenFloorPad ? (
            <Link
              href={buildExecutiveFloorPadHref()}
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-violet-500/35 bg-violet-950/25 px-3 text-sm font-semibold text-violet-100"
            >
              <HubIcon id="notes" className="h-4 w-4" />
              Open Floor Pad (current capture)
            </Link>
          ) : null}
          <Link
            href="/overview"
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-zinc-700/80 bg-zinc-900/70 px-3 text-sm font-semibold text-zinc-100"
          >
            Back to Overview
          </Link>
        </div>
      </div>
    </main>
  );
}
