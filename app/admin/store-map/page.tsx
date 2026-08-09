"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BulkLocationGenerator } from "@/components/admin/BulkLocationGenerator";
import { StoreLocationGrid } from "@/components/admin/StoreLocationGrid";
import { NavigationHub } from "@/components/hub/NavigationHub";
import { SessionGate } from "@/components/hub/SessionGate";
import { SuperAdminQuickActions } from "@/components/hub/SuperAdminQuickActions";
import { isMasterAdmin } from "@/lib/rbac";
import {
  fetchDepartments,
  fetchStoreLocations,
  generateRotations,
} from "@/lib/store-ops/client";
import type { Department, StoreLocation } from "@/lib/store-ops/types";
import type { StoreSpecialist } from "@/lib/types";

export default function StoreMapAdminPage() {
  return (
    <SessionGate
      allow={isMasterAdmin}
      denyMessage="Store Map is restricted to Super Admin / Master Admin."
      denyHref="/dashboard"
      denyLinkLabel="Open Zebra dashboard"
    >
      {({ specialist, storeNumber, logout }) => (
        <StoreMapBody
          specialist={specialist}
          storeNumber={storeNumber}
          logout={logout}
        />
      )}
    </SessionGate>
  );
}

function StoreMapBody({
  specialist,
  storeNumber,
  logout,
}: {
  specialist: StoreSpecialist;
  storeNumber: string;
  logout: () => void;
}) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [locations, setLocations] = useState<StoreLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [genDept, setGenDept] = useState("");
  const [genCount, setGenCount] = useState("10");
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const bulkRef = useRef<HTMLElement>(null);
  const weekRef = useRef<HTMLElement>(null);

  const reload = useCallback(async (member: StoreSpecialist) => {
    setLoading(true);
    setError(null);
    try {
      const [depts, locs] = await Promise.all([
        fetchDepartments(member),
        fetchStoreLocations(member),
      ]);
      setDepartments(depts);
      setLocations(locs);
      setGenDept((current) => current || depts[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load store map");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload(specialist);
  }, [specialist, reload]);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash === "#bulk-generate") {
      bulkRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (hash === "#weekly-rotation") {
      weekRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [loading]);

  async function handleGenerateWeek() {
    if (!genDept) return;
    setGenBusy(true);
    setGenMsg(null);
    try {
      const result = await generateRotations(
        specialist,
        genDept,
        Number(genCount)
      );
      setGenMsg(
        `Week ${result.assigned_week}: assigned ${result.created} bay${
          result.created === 1 ? "" : "s"
        }${result.cycle_reset ? " (new cycle started)" : ""}.`
      );
      await reload(specialist);
    } catch (err) {
      setGenMsg(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setGenBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <NavigationHub
        title="Store Map"
        specialist={specialist}
        storeNumber={storeNumber}
        onLogout={logout}
      />

      <main className="mx-auto w-full max-w-lg flex-1 px-3 pb-28 pt-4">
        <SuperAdminQuickActions
          specialist={specialist}
          onBulkGenerate={() =>
            bulkRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          onTriggerRotation={() =>
            weekRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        />

        {error ? (
          <p className="mb-4 rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
            <span className="mt-1 block text-red-200/70">
              Check <code className="font-mono text-xs">.env.local</code> has
              real Supabase URL + service role key (not placeholders), restart{" "}
              <code className="font-mono text-xs">npm run dev</code>, and confirm
              the store-ops migration ran on that same project.
            </span>
          </p>
        ) : null}

        <div className="space-y-8">
          <section id="bulk-generate" ref={bulkRef}>
            <BulkLocationGenerator
              specialist={specialist}
              departments={departments}
              onGenerated={() => void reload(specialist)}
            />
          </section>

          <section
            id="weekly-rotation"
            ref={weekRef}
            className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4"
          >
            <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-emerald-400">
              Weekly Rotation Engine
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Randomly assign PENDING bays for this ISO week. Auto-resets the cycle when all bays are COMPLETED.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_6rem_auto]">
              <select
                value={genDept}
                onChange={(e) => setGenDept(e.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-slate-100"
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={genCount}
                onChange={(e) => setGenCount(e.target.value)}
                aria-label="Bay count"
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 font-mono text-slate-100"
              />
              <button
                type="button"
                disabled={genBusy || !genDept}
                onClick={handleGenerateWeek}
                className="min-h-12 rounded-xl bg-amber-500 px-4 font-bold text-slate-950 disabled:opacity-50"
              >
                {genBusy ? "…" : "Generate Week"}
              </button>
            </div>
            {genMsg ? (
              <p className="mt-2 text-sm text-amber-200" role="status">
                {genMsg}
              </p>
            ) : null}
          </section>

          {loading ? (
            <p className="text-sm text-slate-400">Loading locations…</p>
          ) : (
            <StoreLocationGrid
              specialist={specialist}
              departments={departments}
              locations={locations}
              onChanged={() => void reload(specialist)}
            />
          )}
        </div>
      </main>
    </div>
  );
}
