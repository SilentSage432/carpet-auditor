"use client";

import { HUB_SECTIONS, type HubSection, type StoreSpecialist } from "@/lib/types";

type HubHeaderProps = {
  section: HubSection;
  menuOpen: boolean;
  onToggleMenu: () => void;
  specialist: StoreSpecialist | null;
  onOpenSpecialist: () => void;
};

export function HubHeader({
  section,
  menuOpen,
  onToggleMenu,
  specialist,
  onOpenSpecialist,
}: HubHeaderProps) {
  const meta = HUB_SECTIONS.find((s) => s.id === section);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-md items-center gap-2 px-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400">
            Carpet Hub
          </p>
          <h1 className="truncate text-base font-bold text-slate-50">
            {meta?.title ?? "Carpet Hub"}
          </h1>
        </div>
        <button
          type="button"
          onClick={onOpenSpecialist}
          className="flex h-12 max-w-[9.5rem] shrink-0 items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-2.5 text-left transition active:scale-95"
          aria-label="Select active specialist"
        >
          <span aria-hidden>👤</span>
          <span className="min-w-0 truncate text-xs font-semibold text-emerald-200">
            {specialist ? `${specialist.name}` : "Select"}
          </span>
        </button>
        <button
          type="button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={onToggleMenu}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-100 transition active:scale-95"
        >
          {menuOpen ? (
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}

type NavDrawerProps = {
  open: boolean;
  active: HubSection;
  onClose: () => void;
  onSelect: (section: HubSection) => void;
};

export function NavDrawer({ open, active, onClose, onSelect }: NavDrawerProps) {
  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-slate-950/70 transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-[min(20rem,88vw)] flex-col border-l border-slate-700/80 bg-slate-900/95 shadow-2xl backdrop-blur-md transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="flex h-14 items-center justify-between border-b border-slate-800 px-4">
          <p className="font-semibold text-slate-100">Navigate</p>
          <button
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            className="flex h-12 w-12 items-center justify-center rounded-xl text-slate-300"
          >
            ✕
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
          {HUB_SECTIONS.map((section) => {
            const isActive = section.id === active;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => {
                  onSelect(section.id);
                  onClose();
                }}
                className={`flex min-h-14 items-start gap-3 rounded-xl border px-3 py-3 text-left transition ${
                  isActive
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                    : "border-slate-800 bg-slate-950/60 text-slate-200 active:bg-slate-800"
                }`}
              >
                <span className="text-xl" aria-hidden>
                  {section.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold">{section.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-400">
                    {section.description}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
