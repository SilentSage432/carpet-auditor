"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { BulkLocationGenerator } from "@/components/admin/BulkLocationGenerator";
import { StoreLocationGrid } from "@/components/admin/StoreLocationGrid";
import { readAuthSession } from "@/lib/auth-session";
import { isMasterAdmin } from "@/lib/rbac";
import {
  fetchDepartments,
  fetchStoreLocations,
  generateRotations,
} from "@/lib/store-ops/client";
import type { Department, StoreLocation } from "@/lib/store-ops/types";
import type { StoreSpecialist } from "@/lib/types";

export default function StoreMapAdminPage() {
  const [specialist, setSpecialist] = useState<StoreSpecialist | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [locations, setLocations] = useState<StoreLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [genDept, setGenDept] = useState("");
  const [genCount, setGenCount] = useState("10");
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);

  useEffect(() => {
    const session = readAuthSession();
    setSpecialist(session?.specialist ?? null);
  }, []);

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
    if (specialist && isMasterAdmin(specialist)) {
      void reload(specialist);
    } else {
      setLoading(false);
    }
  }, [specialist, reload]);

  if (!specialist) {
    return (
      <GateShell>
        <p className="text-slate-300">
          Sign in to DeptSync Hub as Master Admin, then open Store Map.
        </p>
        <Link href="/" className="mt-4 inline-block text-emerald-400 underline">
          Go to Hub login
        </Link>
      </GateShell>
    );
  }

  if (!isMasterAdmin(specialist)) {
    return (
      <GateShell>
        <p className="text-slate-300">
          Store Map is restricted to Super Admin / Master Admin.
        </p>
        <Link href="/dashboard" className="mt-4 inline-block text-emerald-400 underline">
          Open supervisor dashboard
        </Link>
      </GateShell>
    );
  }

  async function handleGenerateWeek() {
    if (!specialist || !genDept) return;
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
    <div className="mx-auto min-h-dvh max-w-3xl px-4 pb-16 pt-6">
      <header className="mb-6">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400">
          DeptSync · Store Operations
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-50">
          Store Map
        </h1>
        <p className="mt-2 max-w-xl text-sm text-slate-400">
          Rapid aisle/bay mapping for multi-department maintenance rotations.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link href="/" className="text-slate-400 underline-offset-2 hover:text-emerald-300 hover:underline">
            ← Hub
          </Link>
          <Link href="/dashboard" className="text-slate-400 underline-offset-2 hover:text-emerald-300 hover:underline">
            Supervisor Dashboard
          </Link>
        </div>
      </header>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
          <span className="mt-1 block text-red-200/70">
            Apply{" "}
            <code className="font-mono text-xs">
              supabase/migrations/20260809_store_operations_rbac.sql
            </code>{" "}
            and set{" "}
            <code className="font-mono text-xs">SUPABASE_SERVICE_ROLE_KEY</code>.
          </span>
        </p>
      ) : null}

      <div className="space-y-8">
        <BulkLocationGenerator
          specialist={specialist}
          departments={departments}
          onGenerated={() => void reload(specialist)}
        />

        <section className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
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
    </div>
  );
}

function GateShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400">
        DeptSync
      </p>
      <h1 className="mt-2 text-2xl font-bold text-slate-50">Store Map</h1>
      <div className="mt-4">{children}</div>
    </div>
  );
}
