"use client";

/**
 * React subscription to working-department pin.
 * Owner remains lib/admin-department-context.ts (localStorage + event).
 * This hook does not store a second copy of department knowledge.
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  ADMIN_DEPT_CONTEXT_EVENT,
  workingDepartment,
} from "@/lib/admin-department-context";
import type { DepartmentScope, StoreSpecialist } from "@/lib/types";

function subscribeDeptPin(onStoreChange: () => void) {
  window.addEventListener(ADMIN_DEPT_CONTEXT_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(ADMIN_DEPT_CONTEXT_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

export function useWorkingDepartment(
  member: StoreSpecialist | null | undefined
): DepartmentScope {
  const getSnapshot = useCallback(
    () => workingDepartment(member),
    [member]
  );
  return useSyncExternalStore(subscribeDeptPin, getSnapshot, getSnapshot);
}
