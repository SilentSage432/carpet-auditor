"use client";

/**
 * DEPTSYNC-TOPOLOGY-REGISTRY-003 — Create Location (empty aisle / named zone).
 * Persists store_aisles only — no bay numbers required.
 */

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  formatAisleDisplayLabel,
  formatAisleInput,
  isNumericAisleCode,
} from "@/lib/store-ops/aisle";
import { createStoreAisle } from "@/lib/store-ops/client";
import { validateStoreAisleIdentifier } from "@/lib/store-ops/store-aisles";
import type { Department } from "@/lib/store-ops/types";
import { toastError, toastSuccess } from "@/lib/toast";
import type { StoreSpecialist } from "@/lib/types";
import { HubPortal } from "@/components/hub/HubPortal";

type Props = {
  open: boolean;
  specialist: StoreSpecialist;
  departments: Department[];
  defaultDepartmentId?: string;
  onClose: () => void;
  onCreated: () => void;
};

export function CreateLocationSheet({
  open,
  specialist,
  departments,
  defaultDepartmentId,
  onClose,
  onCreated,
}: Props) {
  const [departmentId, setDepartmentId] = useState(
    defaultDepartmentId || departments[0]?.id || ""
  );
  const [aisle, setAisle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => {
    const validated = validateStoreAisleIdentifier({
      aisle,
      display_name: displayName,
    });
    if (!validated.ok) return null;
    const label =
      validated.display_name || formatAisleDisplayLabel(validated.aisle);
    return {
      aisle: validated.aisle,
      label,
      kind: isNumericAisleCode(validated.aisle) ? "aisle" : "zone",
    };
  }, [aisle, displayName]);

  if (!open) return null;

  async function handleSave() {
    const validated = validateStoreAisleIdentifier({
      aisle,
      display_name: displayName,
    });
    if (!validated.ok) {
      setError(validated.error);
      return;
    }
    if (!departmentId) {
      setError("Select a department");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createStoreAisle(specialist, {
        department_id: departmentId,
        aisle: validated.aisle,
        display_name: validated.display_name,
      });
      const label =
        created.display_name?.trim() ||
        formatAisleDisplayLabel(created.aisle);
      toastSuccess(`${label} saved · 0 documented bays`);
      setAisle("");
      setDisplayName("");
      onCreated();
      onClose();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not create location";
      setError(msg);
      toastError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <HubPortal>
      <div
        className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-3 sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-location-title"
        data-testid="create-location-sheet"
      >
        <div className="w-full max-w-md rounded-2xl border border-zinc-700/80 bg-zinc-950 p-4 shadow-xl">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h2
                id="create-location-title"
                className="text-base font-bold text-white"
              >
                Create Location
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                Save an aisle or named zone without bay numbers. Add bays later.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-zinc-700 text-zinc-300"
              aria-label="Close"
            >
              <X className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </div>

          <label className="mb-3 block">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
              Department
            </span>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="mt-1 min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm text-white"
              data-testid="create-location-department"
            >
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          <label className="mb-3 block">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
              Identifier
            </span>
            <input
              value={aisle}
              onChange={(e) => setAisle(formatAisleInput(e.target.value))}
              placeholder="41, SHOW-L, CARPET-WALL…"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="mt-1 min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 font-mono text-sm uppercase text-white"
              data-testid="create-location-aisle"
            />
          </label>

          <label className="mb-3 block">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
              Display name (optional)
            </span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Carpet Wall"
              className="mt-1 min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm text-white"
              data-testid="create-location-display-name"
            />
          </label>

          {preview ? (
            <p
              className="mb-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 font-mono text-[11px] text-zinc-400"
              data-testid="create-location-preview"
            >
              {preview.label} · 0 documented bays
              {preview.kind === "zone" ? " · named zone" : ""}
            </p>
          ) : null}

          {error ? (
            <p className="mb-3 text-sm text-rose-300" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            disabled={busy || !preview}
            onClick={() => void handleSave()}
            className="btn-primary-glow flex min-h-12 w-full items-center justify-center rounded-xl text-sm font-bold disabled:opacity-40"
            data-testid="create-location-save"
          >
            {busy ? "Saving…" : "Save location"}
          </button>
        </div>
      </div>
    </HubPortal>
  );
}
