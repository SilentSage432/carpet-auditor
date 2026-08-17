"use client";

/**
 * React subscription to working-department pin.
 * Owner remains lib/admin-department-context.ts (localStorage + event).
 * This hook does not store a second copy of department knowledge.
 */

import { useEffect, useState } from "react";
import {
  ADMIN_DEPT_CONTEXT_EVENT,
  workingDepartment,
} from "@/lib/admin-department-context";
import type { DepartmentScope, StoreSpecialist } from "@/lib/types";

export function useWorkingDepartment(
  member: StoreSpecialist | null | undefined
): DepartmentScope {
  const [scope, setScope] = useState<DepartmentScope>(() =>
    workingDepartment(member)
  );

  useEffect(() => {
    function sync() {
      setScope(workingDepartment(member));
    }
    sync();
    window.addEventListener(ADMIN_DEPT_CONTEXT_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ADMIN_DEPT_CONTEXT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [member]);

  return scope;
}
