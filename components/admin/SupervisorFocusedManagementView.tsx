"use client";

/**
 * DEPTSYNC-SECTION-OWNERSHIP-005 — focused More management shell.
 * Back returns to the supervisor hub; Open never scrolls to an anchor.
 */

import type { ReactNode } from "react";
import {
  supervisorManageSubtitle,
  supervisorManageTitle,
  type SupervisorManageView,
} from "@/lib/store-ops/supervisor-management-nav";

type Props = {
  view: SupervisorManageView;
  onBack: () => void;
  children: ReactNode;
};

export function SupervisorFocusedManagementView({
  view,
  onBack,
  children,
}: Props) {
  const title = supervisorManageTitle(view);
  const subtitle = supervisorManageSubtitle(view);

  return (
    <section
      data-testid={`supervisor-manage-${view}`}
      data-supervisor-manage-view={view}
      className="space-y-3"
    >
      <header className="space-y-2">
        <button
          type="button"
          data-testid="supervisor-manage-back"
          onClick={onBack}
          className="flex min-h-11 items-center gap-2 rounded-xl border border-zinc-700/80 bg-zinc-950/70 px-3 text-sm font-semibold text-zinc-100"
        >
          <span aria-hidden>←</span>
          Back to More
        </button>
        <div className="px-0.5">
          <h1 className="text-lg font-bold tracking-tight text-zinc-50">
            {title}
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p>
        </div>
      </header>
      <div data-testid="supervisor-manage-body" className="space-y-3">
        {children}
      </div>
    </section>
  );
}
