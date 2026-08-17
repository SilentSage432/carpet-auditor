"use client";

/**
 * In-page Specialty Tools shortcuts — appliance scanner & remnant calculator.
 */

import Link from "next/link";
import { NavIcon } from "@/components/hub/NavIcons";
import { visibleSpecialtyTools } from "@/lib/specialty-tools";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  specialist: StoreSpecialist | null;
};

export function SpecialtyToolsPanel({ specialist }: Props) {
  const tools = visibleSpecialtyTools(specialist);
  if (tools.length === 0) return null;

  return (
    <section
      aria-label="Specialty Tools"
      className="mb-3 overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/50"
    >
      <p className="border-b border-zinc-800/80 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-500">
        Specialty Tools
      </p>
      <ul className="divide-y divide-zinc-800/60">
        {tools.map((tool) => (
          <li key={tool.id}>
            <Link
              href={tool.href}
              className="flex min-h-11 items-center gap-2.5 px-3 text-sm font-semibold text-zinc-200 active:bg-zinc-800/50"
            >
              <NavIcon id={tool.icon} className="h-4 w-4 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate">{tool.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
