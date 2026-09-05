"use client";

/**
 * FS-002B Floor fiscal + declared seasonal context strip.
 * Presentation only — non-blocking; omits itself on empty/failure.
 */

import { useEffect, useMemo, useState } from "react";
import {
  fetchFiscalCalendar,
  fetchOperationalContextsResolve,
  type FiscalCalendarClient,
  type OperationalContextsResolveClient,
} from "@/lib/store-ops/client";
import {
  composeFloorOperationalContextView,
  type FloorContextItem,
  type FloorFiscalSnippet,
  type FloorFiscalUnavailable,
} from "@/lib/store-ops/floor-operational-context";
import { toStoreOpsDepartmentCode } from "@/lib/store-ops/department-codes";
import { departmentMeta } from "@/lib/types";
import type { DepartmentScope, StoreSpecialist } from "@/lib/types";
import { isSupervisor } from "@/lib/specialists";

type Props = {
  specialist: StoreSpecialist;
  /** Current working department pin (hub scope). */
  workingDepartment: DepartmentScope;
  /** Live departments.code when Floor has resolved active dept. */
  departmentCode?: string | null;
  departmentLabel?: string | null;
  refreshKey?: number | string;
};

function mapFiscal(
  raw: FiscalCalendarClient | null
): FloorFiscalSnippet | FloorFiscalUnavailable | null {
  if (!raw) return null;
  if (raw.status === "calendar_unavailable") {
    return {
      status: "calendar_unavailable",
      operational_date: raw.operational_date,
      reason: raw.reason,
    };
  }
  if (raw.status !== "ok") return null;
  return {
    status: "ok",
    fiscal_year: raw.fiscal_year,
    fiscal_week: raw.fiscal_week,
    fiscal_period: raw.fiscal_period,
    fiscal_quarter: raw.fiscal_quarter,
    operational_date: raw.operational_date,
  };
}

function mapItems(
  rows: OperationalContextsResolveClient["active_seasons"]
): FloorContextItem[] {
  return (rows ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    start_date: row.start_date,
    end_date: row.end_date,
    source_type: row.source_type,
    department_relevance: row.department_relevance ?? null,
  }));
}

export function FloorOperationalContextStrip({
  specialist,
  workingDepartment,
  departmentCode,
  departmentLabel,
  refreshKey,
}: Props) {
  const canRead = isSupervisor(specialist);

  const resolvedCode = useMemo(() => {
    if (departmentCode && departmentCode.trim()) return departmentCode.trim();
    if (workingDepartment === "all") return null;
    return toStoreOpsDepartmentCode(workingDepartment);
  }, [departmentCode, workingDepartment]);

  const resolvedLabel = useMemo(() => {
    if (departmentLabel && departmentLabel.trim()) {
      return departmentLabel.trim();
    }
    if (workingDepartment === "all") return null;
    return departmentMeta(workingDepartment).shortLabel;
  }, [departmentLabel, workingDepartment]);

  const [fiscal, setFiscal] = useState<FiscalCalendarClient | null>(null);
  const [contexts, setContexts] =
    useState<OperationalContextsResolveClient | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;

    async function load() {
      const [fiscalResult, contextResult] = await Promise.allSettled([
        fetchFiscalCalendar(specialist),
        fetchOperationalContextsResolve(specialist, {
          department_code: resolvedCode,
        }),
      ]);

      if (cancelled) return;

      let anyOk = false;
      if (fiscalResult.status === "fulfilled") {
        setFiscal(fiscalResult.value);
        anyOk = true;
      } else {
        setFiscal(null);
        console.error(
          "[FloorOperationalContextStrip] fiscal read failed",
          fiscalResult.reason
        );
      }

      if (contextResult.status === "fulfilled") {
        setContexts(contextResult.value);
        anyOk = true;
      } else {
        setContexts(null);
        console.error(
          "[FloorOperationalContextStrip] context read failed",
          contextResult.reason
        );
      }

      setFailed(!anyOk);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [canRead, specialist, resolvedCode, refreshKey]);

  const view = useMemo(() => {
    if (!canRead || failed) {
      return composeFloorOperationalContextView({
        fiscal: null,
        active_seasons: [],
        active_events: [],
        department_code: resolvedCode,
        department_label: resolvedLabel,
      });
    }
    return composeFloorOperationalContextView({
      fiscal: mapFiscal(fiscal),
      active_seasons: mapItems(contexts?.active_seasons ?? []),
      active_events: mapItems(contexts?.active_events ?? []),
      department_code: resolvedCode,
      department_label: resolvedLabel,
    });
  }, [canRead, failed, fiscal, contexts, resolvedCode, resolvedLabel]);

  if (!canRead || !view.visible) return null;

  return (
    <div
      className="mt-1 space-y-0.5"
      data-testid="floor-operational-context-strip"
      data-method={view.method}
    >
      {view.lines.map((line, index) => (
        <p
          key={`${index}-${line}`}
          className={
            index === 0
              ? "font-mono text-[11px] leading-snug text-slate-400"
              : "text-[11px] leading-snug text-slate-500"
          }
        >
          {line}
        </p>
      ))}
    </div>
  );
}
