"use client";

/**
 * Compatibility shim — Manager Notes workspace moved to Executive Floor Pad.
 * Prefer `@/components/manager-notes`.
 * Default export exists so next/dynamic(() => import(...)) resolves (React #306).
 */

export {
  ExecutiveFloorPad,
  ManagerNotesWorkspace,
} from "@/components/manager-notes/ExecutiveFloorPad";
export { ManagerNotesWorkspace as default } from "@/components/manager-notes/ExecutiveFloorPad";
