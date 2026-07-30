"use client";

import { useEffect, useMemo, useState } from "react";
import { TextField } from "@/components/ui/NumberField";
import { ConfirmModal } from "@/components/hub/ConfirmModal";
import {
  canManageTeamRoster,
  suggestUsername,
} from "@/lib/rbac";
import {
  DEFAULT_TEMP_PASSWORD,
  dedupeRoster,
  deleteSpecialist,
  fetchSpecialists,
  isDefaultPin,
  needsCredentialSetup,
  resetSpecialistCredentials,
  roleBadge,
  saveSpecialist,
  updateSpecialistScope,
} from "@/lib/specialists";
import {
  DEPARTMENT_META,
  OPERATIONAL_DEPARTMENTS,
  departmentMeta,
  type DepartmentScope,
  type SpecialistRole,
  type StoreSpecialist,
} from "@/lib/types";
import { formatStoreLabel } from "@/lib/store";

type Props = {
  activeSpecialist: StoreSpecialist | null;
  storeNumber: string;
  roster: StoreSpecialist[];
  onRosterChange: (roster: StoreSpecialist[]) => void;
};

type IssuedCredentials = {
  name: string;
  username: string;
  password: string;
};

function credentialsStatus(member: StoreSpecialist): {
  label: string;
  tone: "ok" | "temp";
} {
  if (needsCredentialSetup(member) || isDefaultPin(member)) {
    return { label: "🟡 Temporary Credentials Active", tone: "temp" };
  }
  return { label: "🟢 First-Time Password Set", tone: "ok" };
}

function displayName(member: StoreSpecialist): string {
  const dept = member.assigned_department;
  if (member.role === "MasterAdmin") return `${member.name} (Full Store)`;
  if (dept && dept !== "all") {
    return `${member.name} (${departmentMeta(dept).label})`;
  }
  return member.name;
}

export function AdminRosterManager({
  activeSpecialist,
  storeNumber,
  roster,
  onRosterChange,
}: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<StoreSpecialist | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoreSpecialist | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<"ok" | "err">("ok");
  const [issued, setIssued] = useState<IssuedCredentials | null>(null);

  const canManage = canManageTeamRoster(activeSpecialist);

  const sorted = useMemo(
    () =>
      [...roster]
        .filter((m) => m.is_active !== false)
        .sort((a, b) => {
        const rank = (m: StoreSpecialist) =>
          m.role === "MasterAdmin" ? 0 : m.role === "Supervisor" ? 1 : 2;
        const d = rank(a) - rank(b);
        if (d !== 0) return d;
        return a.name.localeCompare(b.name);
      }),
    [roster]
  );

  if (!canManage) return null;

  function flash(msg: string, tone: "ok" | "err" = "ok") {
    setToastTone(tone);
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }

  async function refreshRoster(nextMember?: StoreSpecialist) {
    const team = await fetchSpecialists();
    const next = dedupeRoster(
      nextMember ? [nextMember, ...team] : team
    );
    onRosterChange(next);
  }

  async function handleReset(member: StoreSpecialist) {
    setBusyId(member.id);
    try {
      const { record } = await resetSpecialistCredentials(member);
      await refreshRoster(record);
      setIssued({
        name: record.name,
        username: record.username || suggestUsername(record.name, record.assigned_department ?? "flooring"),
        password: DEFAULT_TEMP_PASSWORD,
      });
      flash(`🔑 Credentials reset for ${record.name}`);
    } catch {
      flash("Could not reset credentials");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setBusyId(target.id);
    try {
      // Optimistic UI — remove immediately (strict string id match).
      onRosterChange(
        roster.filter((s) => String(s.id) !== String(target.id))
      );
      await deleteSpecialist(target);
      const team = await fetchSpecialists();
      onRosterChange(
        dedupeRoster(team).filter(
          (s) =>
            String(s.id) !== String(target.id) && s.is_active !== false
        )
      );
      flash(`User ${target.name} has been removed from the roster.`, "ok");
    } catch (err) {
      await refreshRoster();
      flash(
        err instanceof Error
          ? err.message
          : `Could not remove ${target.name} from the roster`,
        "err"
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-emerald-500/25 bg-slate-900/90 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
            👥 Team & Department Roster Manager
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Master Admin console for {formatStoreLabel(storeNumber)}. Issue
            department supervisors, reset credentials, and edit access scope.
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {sorted.map((member) => {
          const status = credentialsStatus(member);
          const dept = member.assigned_department;
          const deptBadge =
            member.role === "MasterAdmin"
              ? DEPARTMENT_META.all
              : departmentMeta(dept);
          return (
            <li
              key={member.id}
              className="rounded-xl border border-slate-800 bg-slate-950/70 p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-50">
                  {displayName(member)}
                </p>
                <p className="mt-1 text-xs text-slate-400">{roleBadge(member)}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {deptBadge.icon} {deptBadge.label}
                  {deptBadge.description ? ` · ${deptBadge.description}` : ""}
                </p>
                <p className="mt-1 truncate font-mono text-[11px] text-slate-500">
                  {member.username ? `@${member.username}` : "No username"}
                </p>
                <p
                  className={`mt-1 text-xs font-semibold ${
                    status.tone === "ok" ? "text-emerald-400" : "text-amber-300"
                  }`}
                >
                  {status.label}
                </p>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  disabled={busyId === member.id}
                  onClick={() => void handleReset(member)}
                  className="flex min-h-11 items-center justify-center rounded-lg border border-amber-500/30 text-[11px] font-semibold text-amber-200 disabled:opacity-40"
                >
                  🔑 Reset
                </button>
                <button
                  type="button"
                  disabled={busyId === member.id}
                  onClick={() => setEditTarget(member)}
                  className="flex min-h-11 items-center justify-center rounded-lg border border-slate-600 text-[11px] font-semibold text-slate-200 disabled:opacity-40"
                >
                  ✏️ Edit
                </button>
                <button
                  type="button"
                  disabled={
                    busyId === member.id ||
                    (member.role === "MasterAdmin" &&
                      activeSpecialist?.id === member.id)
                  }
                  onClick={() => setDeleteTarget(member)}
                  className="flex min-h-11 items-center justify-center rounded-lg border border-red-500/30 text-[11px] font-semibold text-red-300 disabled:opacity-40"
                >
                  🗑️ Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => setAddOpen(true)}
        className="flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950"
      >
        + Add Department Supervisor / Specialist
      </button>

      {toast ? (
        <p
          className={`rounded-xl border px-3 py-2 text-center text-sm font-semibold ${
            toastTone === "err"
              ? "border-red-500/40 bg-red-950/50 text-red-200"
              : "border-emerald-500/40 bg-emerald-950/50 text-emerald-200"
          }`}
          role="status"
        >
          {toastTone === "ok" ? "✅ " : "⚠️ "}
          {toast}
        </p>
      ) : null}

      <AdminAddMemberModal
        open={addOpen}
        storeNumber={storeNumber}
        onClose={() => setAddOpen(false)}
        onCreated={async (record, creds) => {
          await refreshRoster(record);
          setIssued(creds);
          setAddOpen(false);
        }}
      />

      <AdminEditScopeModal
        open={editTarget != null}
        member={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={async (record) => {
          await refreshRoster(record);
          setEditTarget(null);
          flash(`✏️ Updated ${record.name}`);
        }}
      />

      <ConfirmModal
        open={deleteTarget != null}
        title="Remove team access?"
        message={
          deleteTarget
            ? `Deactivate ${deleteTarget.name}? They will no longer appear in the store roster.`
            : ""
        }
        confirmLabel="Deactivate"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />

      {issued ? (
        <IssuedCredentialsCard
          issued={issued}
          onDismiss={() => setIssued(null)}
        />
      ) : null}
    </section>
  );
}

function IssuedCredentialsCard({
  issued,
  onDismiss,
}: {
  issued: IssuedCredentials;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-3">
      <p className="text-sm font-bold text-emerald-200">Account Ready!</p>
      <p className="mt-1 text-sm leading-relaxed text-emerald-100/90">
        Share these credentials with{" "}
        <span className="font-semibold">{issued.name}</span>:
      </p>
      <p className="mt-2 rounded-lg bg-slate-950/60 px-3 py-2 font-mono text-xs text-slate-100">
        Username: {issued.username}
        <br />
        Temp Pass: {issued.password}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-emerald-500/30 text-sm font-semibold text-emerald-200"
      >
        Done
      </button>
    </div>
  );
}

type AddProps = {
  open: boolean;
  storeNumber: string;
  onClose: () => void;
  onCreated: (record: StoreSpecialist, creds: IssuedCredentials) => void;
};

function AdminAddMemberModal({ open, storeNumber, onClose, onCreated }: AddProps) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<SpecialistRole>("Supervisor");
  const [department, setDepartment] =
    useState<DepartmentScope>("plumbing");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState(DEFAULT_TEMP_PASSWORD);
  const [requireReset, setRequireReset] = useState(true);
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setRole("Supervisor");
    setDepartment("plumbing");
    setUsername("");
    setPassword(DEFAULT_TEMP_PASSWORD);
    setRequireReset(true);
    setUsernameTouched(false);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open || usernameTouched) return;
    const dept = role === "MasterAdmin" ? "all" : department;
    if (name.trim()) {
      setUsername(suggestUsername(name, dept));
    }
  }, [name, department, role, open, usernameTouched]);

  if (!open) return null;

  async function handleSave() {
    if (!name.trim()) {
      setError("Enter a full name / name badge");
      return;
    }
    if (!username.trim()) {
      setError("Enter an initial username");
      return;
    }
    if (password.trim().length < 6) {
      setError("Temporary password must be at least 6 characters");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const assigned = role === "MasterAdmin" ? "all" : department;
      const { record } = await saveSpecialist({
        name: name.trim(),
        role,
        username: username.trim(),
        pin_code: password.trim(),
        assigned_department: assigned,
        must_change_credentials: requireReset,
        store_number: storeNumber,
      });
      onCreated(record, {
        name: record.name,
        username: record.username || username.trim(),
        password: password.trim(),
      });
    } catch {
      setError("Could not create account. Try a different name/username.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[78] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
        aria-label="Close add member modal"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-member-title"
        className="relative z-[79] max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl sm:rounded-2xl"
      >
        <h2 id="add-member-title" className="text-lg font-bold text-slate-50">
          Add Department Supervisor / Specialist
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Issues a login for {formatStoreLabel(storeNumber)}.
        </p>

        <div className="mt-4 space-y-3">
          <TextField
            label="Full Name / Name Badge"
            value={name}
            onChange={setName}
            placeholder='e.g. Dave (Plumbing Supervisor)'
          />

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-200">
              Role
            </legend>
            <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
              {(
                [
                  ["Supervisor", "🛡️ Department Supervisor"],
                  ["Associate", "👤 Floor Associate"],
                  ["MasterAdmin", "👑 Master Admin"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRole(value)}
                  className={`flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-semibold ${
                    role === value
                      ? "bg-emerald-500 text-slate-950"
                      : "text-slate-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          {role !== "MasterAdmin" ? (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-200">
                Assigned Department
              </span>
              <select
                value={department}
                onChange={(e) =>
                  setDepartment(e.target.value as DepartmentScope)
                }
                className="min-h-12 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-base text-slate-100"
              >
                {OPERATIONAL_DEPARTMENTS.map((id) => {
                  const meta = DEPARTMENT_META[id];
                  return (
                    <option key={id} value={id}>
                      {meta.icon} {meta.label} — {meta.description}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : null}

          <TextField
            label="Initial Username"
            value={username}
            onChange={(v) => {
              setUsernameTouched(true);
              setUsername(v);
            }}
            placeholder="e.g. dave_plumbing"
          />
          <TextField
            label="Temporary Password"
            value={password}
            onChange={setPassword}
            placeholder={DEFAULT_TEMP_PASSWORD}
          />

          <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/70 px-3">
            <input
              type="checkbox"
              checked={requireReset}
              onChange={(e) => setRequireReset(e.target.checked)}
              className="h-5 w-5 accent-emerald-500"
            />
            <span className="text-sm font-medium text-slate-200">
              Require Password Reset on First Login
            </span>
          </label>

          <p className="text-xs text-slate-500">
            Store Number:{" "}
            <span className="font-mono text-emerald-400">{storeNumber}</span>{" "}
            (auto-attached)
          </p>
        </div>

        {error ? (
          <p className="mt-3 text-center text-sm font-semibold text-red-400" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-300"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="flex min-h-12 items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save & Issue Login"}
          </button>
        </div>
      </div>
    </div>
  );
}

type EditProps = {
  open: boolean;
  member: StoreSpecialist | null;
  onClose: () => void;
  onSaved: (record: StoreSpecialist) => void;
};

function AdminEditScopeModal({ open, member, onClose, onSaved }: EditProps) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<SpecialistRole>("Supervisor");
  const [department, setDepartment] =
    useState<DepartmentScope>("flooring");
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !member) return;
    setName(member.name);
    setRole(member.role);
    setDepartment(member.assigned_department ?? "flooring");
    setUsername(member.username ?? "");
    setError(null);
  }, [open, member]);

  if (!open || !member) return null;

  async function handleSave() {
    if (!member) return;
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { record } = await updateSpecialistScope(member, {
        name: name.trim(),
        role,
        assigned_department: role === "MasterAdmin" ? "all" : department,
        username: username.trim() || null,
      });
      onSaved(record);
    } catch {
      setError("Could not update scope");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[78] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
        aria-label="Close edit scope modal"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-scope-title"
        className="relative z-[79] w-full max-w-md rounded-t-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl sm:rounded-2xl"
      >
        <h2 id="edit-scope-title" className="text-lg font-bold text-slate-50">
          Edit Scope
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Change role or assigned department for {member.name}.
        </p>

        <div className="mt-4 space-y-3">
          <TextField label="Name" value={name} onChange={setName} />
          <TextField
            label="Username"
            value={username}
            onChange={setUsername}
            placeholder="optional"
          />
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-200">
              Role
            </legend>
            <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
              {(
                [
                  ["Associate", "👤"],
                  ["Supervisor", "🛡️"],
                  ["MasterAdmin", "👑"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRole(value)}
                  className={`flex min-h-11 items-center justify-center rounded-lg text-sm font-semibold ${
                    role === value
                      ? "bg-emerald-500 text-slate-950"
                      : "text-slate-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          {role !== "MasterAdmin" ? (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-200">
                Department
              </span>
              <select
                value={department === "all" ? "flooring" : department}
                onChange={(e) =>
                  setDepartment(e.target.value as DepartmentScope)
                }
                className="min-h-12 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-base text-slate-100"
              >
                {OPERATIONAL_DEPARTMENTS.map((id) => {
                  const meta = DEPARTMENT_META[id];
                  return (
                    <option key={id} value={id}>
                      {meta.icon} {meta.label}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : null}
        </div>

        {error ? (
          <p className="mt-3 text-center text-sm font-semibold text-red-400">{error}</p>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-300"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="flex min-h-12 items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save Scope"}
          </button>
        </div>
      </div>
    </div>
  );
}
