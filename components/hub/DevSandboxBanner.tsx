"use client";

import { clearDevSandbox, sandboxPreviewLabel } from "@/lib/dev-sandbox";
import type { DevSandboxState } from "@/lib/dev-sandbox";

type Props = {
  sandbox: DevSandboxState;
};

export function DevSandboxBanner({ sandbox }: Props) {
  if (!sandbox.previewRole) return null;
  return (
    <button
      type="button"
      onClick={() => clearDevSandbox()}
      className="flex min-h-10 w-full items-center justify-center bg-amber-500 px-3 text-center font-mono text-[11px] font-bold tracking-tight text-zinc-950"
    >
      ⚡ Simulating: {sandboxPreviewLabel(sandbox)} — Tap to Exit
    </button>
  );
}
