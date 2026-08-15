"use client";

import { useEffect, useState } from "react";
import {
  composeViewSpecialist,
  DEV_SANDBOX_EVENT,
  isDevSandboxActive,
  readDevSandbox,
  type DevSandboxState,
} from "@/lib/dev-sandbox";
import { isMasterAdmin } from "@/lib/rbac";
import type { StoreSpecialist } from "@/lib/types";

export function useDevSandbox(real: StoreSpecialist | null | undefined) {
  const [sandbox, setSandbox] = useState<DevSandboxState>(() =>
    typeof window === "undefined" ? { previewRole: null, previewDepartment: null } : readDevSandbox()
  );

  useEffect(() => {
    setSandbox(readDevSandbox());
    function onChange() {
      setSandbox(readDevSandbox());
    }
    window.addEventListener(DEV_SANDBOX_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(DEV_SANDBOX_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const canOpen = isMasterAdmin(real);
  const active = canOpen && isDevSandboxActive(sandbox);
  const viewSpecialist =
    real && active ? composeViewSpecialist(real, sandbox) : real ?? null;

  return {
    sandbox,
    canOpen,
    active,
    realSpecialist: real ?? null,
    viewSpecialist,
  };
}
