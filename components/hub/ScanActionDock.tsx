"use client";

/**
 * Cycle Audit / department scan primary actions — docks above BottomNav.
 * Presentation only; form submit ownership stays on the scan section.
 */

import type { ReactNode } from "react";

export function ScanActionDock({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`hub-scan-dock ${className}`.trim()}>{children}</div>
  );
}
