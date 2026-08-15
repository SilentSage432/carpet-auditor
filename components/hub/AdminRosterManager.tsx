"use client";

import { useEffect, useMemo, useState } from "react";
import { TextField } from "@/components/ui/NumberField";
import { ConfirmModal } from "@/components/hub/ConfirmModal";
import {
  canManageTeamRoster,
  suggestUsername,
} from "@/lib/rbac";
import {
  dedupeRoster,
  deleteSpecialist,
  fetchSpecialists,
  roleBadge,
  updateSpecialistScope,
} from "@/lib/specialists";
import { inviteSupervisor } from "@/lib/store-ops/client";
import {
  DEPARTMENT_META,
  OPERATIONAL_DEPARTMENTS,
  associateFloorTitle,
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

type InviteResult = {
  name: string;
  username: string;
  temporary_pin: string;
  invite_url: string;
  sms_link: string;
  sms_body: string;
  sms_status: string;
  test_mode?: boolean;
};

function toInviteResult(data: {
  name: string;
  username: string;
  temporary_pin: string;
  invite_url: string;
  sms_preview: { body: string; sms_link: string };
  sms:
    | { ok: true; sid: string }
    | { ok: false; skipped: true; reason: string }
    | { ok: false; skipped: false; reason: string };
  test_mode?: boolean;
}): InviteResult {
  return {
    name: data.name,
    username: data.username,
    temporary_pin: data.temporary_pin,
    invite_url: data.invite_url,
    sms_link: data.sms_preview.sms_link,
    sms_body: data.sms_preview.body,
    sms_status: data.sms.ok
      ? `SMS sent (${data.sms.sid})`
      : data.sms.skipped
        ? data.sms.reason
        : `SMS failed: ${data.sms.reason}`,
    test_mode: Boolean(data.test_mode),
  };
}

function credentialsStatus(member: StoreSpecialist): {
  label: string;
  tone: "ok" | "temp";
} {
  // Driven only by DB flags — never by seed account identity / default PIN guess.
  if (member.must_change_credentials || member.must_change_pin) {
    return { label: "🟡 Temporary Credentials Active", tone: "temp" };
  }
  return { label: "🟢 Credentials Set", tone: "ok" };
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
  const [inviteTarget, setInviteTarget] = useState<StoreSpecialist | null>(null);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [testBusyId, setTestBusyId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<"ok" | "err">("ok");

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

  async function handleTestInviteFlow(member: StoreSpecialist) {
    if (!activeSpecialist) return;
    setTestBusyId(member.id);
    try {
      const data = await inviteSupervisor(activeSpecialist, {
        specialist_id: member.id,
        test_mode: true,
      });
      await refreshRoster();
      setInviteResult(toInviteResult({ ...data, test_mode: true }));
      flash(`🧪 Test invite ready for ${data.name}`);
    } catch (err) {
      flash(
        err instanceof Error ? err.message : "Could not generate test invite",
        "err"
      );
    } finally {
      setTestBusyId(null);
    }
  }

  async function handleReset(member: StoreSpecialist) {
    if (!activeSpecialist) return;
    setBusyId(member.id);
    try {
      const data = await inviteSupervisor(activeSpecialist, {
        specialist_id: member.id,
      });
      await refreshRoster();
      setInviteResult(toInviteResult(data));
      flash(`🔑 New temp PIN issued for ${data.name}`);
    } catch (err) {
      flash(
        err instanceof Error ? err.message : "Could not reset credentials",
        "err"
      );
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
        {sorted.length === 0 ? (
          <li className="rounded-xl border border-dashed border-slate-700 bg-slate-950/50 px-4 py-6 text-center text-sm text-slate-400">
            No active roster profiles in the database for this store. Add a
            supervisor or invite from Admin Tools.
          </li>
        ) : null}
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
              className="glass-card !rounded-xl p-3"
            >
              <div className="min-w-0">
                <p className="glass-title truncate text-sm">
                  {displayName(member)}
                </p>
                <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300/90">
                  {roleBadge(member)}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  {deptBadge.label}
                  {deptBadge.description ? ` · ${deptBadge.description}` : ""}
                </p>
                <p className="mt-1 truncate font-mono text-[11px] text-zinc-500">
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
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={busyId === member.id}
                  onClick={() => setInviteTarget(member)}
                  className="btn-grid-action-emerald"
                >
                  Invite
                </button>
                <button
                  type="button"
                  disabled={
                    busyId === member.id || testBusyId === member.id
                  }
                  onClick={() => void handleTestInviteFlow(member)}
                  className="btn-grid-action-amber"
                >
                  {testBusyId === member.id ? "…" : "Test Invite"}
                </button>
                <button
                  type="button"
                  disabled={busyId === member.id}
                  onClick={() => void handleReset(member)}
                  className="btn-grid-action-amber"
                >
                  Reset
                </button>
                <button
                  type="button"
                  disabled={busyId === member.id}
                  onClick={() => setEditTarget(member)}
                  className="btn-grid-action-neutral"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={
                    busyId === member.id ||
                    (member.role === "MasterAdmin" &&
                      activeSpecialist?.id === member.id)
                  }
                  onClick={() => setDeleteTarget(member)}
                  className="btn-grid-action-danger col-span-2"
                >
                  Delete User
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => setAddOpen(true)}
        className="btn-primary-glow flex w-full items-center justify-center text-sm font-bold"
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
        actor={activeSpecialist}
        onClose={() => setAddOpen(false)}
        onCreated={async (result) => {
          await refreshRoster();
          setAddOpen(false);
          setInviteResult(result);
          flash(`Account ready for ${result.name}`);
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
        title="Delete user?"
        message={
          deleteTarget
            ? `Remove ${deleteTarget.name} from the store roster? Temporary / seed profiles are purged; database profiles are deactivated.`
            : ""
        }
        confirmLabel="Delete User"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />

      <AdminInviteModal
        open={inviteTarget != null}
        member={inviteTarget}
        actor={activeSpecialist}
        onClose={() => setInviteTarget(null)}
        onInvited={async (result) => {
          await refreshRoster();
          setInviteTarget(null);
          setInviteResult(result);
          flash(`📨 Invite ready for ${result.name}`);
        }}
      />

      {inviteResult ? (
        <TestInviteHarnessModal
          result={inviteResult}
          onClose={() => setInviteResult(null)}
        />
      ) : null}
    </section>
  );
}

function TestInviteHarnessModal({
  result,
  onClose,
}: {
  result: InviteResult;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const isTest = Boolean(result.test_mode);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[85]" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/75"
        aria-label="Close invite preview"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 mx-auto max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border-2 border-amber-400/50 bg-slate-900 p-5 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
              {isTest ? "Admin testing harness" : "Supervisor invite"}
            </p>
            <h2 className="mt-1 text-lg font-bold text-slate-50">
              {isTest ? "Test Invite Flow" : "Invite ready"}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {result.name} · @{result.username}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-600 text-slate-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {isTest ? (
          <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
            Dry-run link includes <code className="font-mono">test=1</code>.
            Completing PIN reset on that URL will not burn the invite token —
            reopen it to rehearse again.
          </p>
        ) : null}

        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Temporary PIN (6-digit)
            </p>
            <p className="mt-1 font-mono text-2xl font-bold tracking-widest text-amber-200">
              {result.temporary_pin}
            </p>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Full SMS text preview
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
              {result.sms_body}
            </p>
          </div>

          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => void copy("link", result.invite_url)}
              className="flex min-h-12 items-center justify-center rounded-xl border-2 border-emerald-500/50 bg-emerald-950/40 text-sm font-bold text-emerald-100"
            >
              {copied === "link" ? "Copied invite link" : "Copy Invite Link"}
            </button>
            <button
              type="button"
              onClick={() => void copy("sms", result.sms_body)}
              className="flex min-h-12 items-center justify-center rounded-xl border-2 border-amber-400/50 bg-amber-950/30 text-sm font-bold text-amber-100"
            >
              {copied === "sms" ? "Copied SMS text" : "Copy Full SMS Text"}
            </button>
            <a
              href={result.invite_url}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-12 items-center justify-center rounded-xl border border-slate-600 text-sm font-semibold text-slate-100"
            >
              Open invite page
            </a>
            <a
              href={result.sms_link}
              className="flex min-h-11 items-center justify-center text-sm font-semibold text-slate-400 underline-offset-2 hover:underline"
            >
              Open SMS app with draft
            </a>
          </div>

          <p className="break-all font-mono text-[10px] text-slate-500">
            {result.invite_url}
          </p>
          <p className="text-xs text-slate-500">{result.sms_status}</p>
        </div>
      </div>
    </div>
  );
}

function AdminInviteModal({
  open,
  member,
  actor,
  onClose,
  onInvited,
}: {
  open: boolean;
  member: StoreSpecialist | null;
  actor: StoreSpecialist | null;
  onClose: () => void;
  onInvited: (result: InviteResult) => Promise<void>;
}) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !member) return;
    setPhone(member.phone_number ?? "");
    setError(null);
  }, [open, member]);

  if (!open || !member || !actor) return null;

  const inviteActor = actor;
  const inviteMember = member;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const data = await inviteSupervisor(inviteActor, {
        specialist_id: inviteMember.id,
        phone: phone.trim() || undefined,
      });
      await onInvited(toInviteResult(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/70"
        aria-label="Close invite"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 mx-auto max-w-md rounded-t-2xl border border-emerald-500/30 bg-slate-900 p-5 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
        <h2 className="text-lg font-bold text-slate-50">
          Invite {inviteMember.name}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Issues a 6-digit temp PIN + /invite link (48h). Optionally SMS via
          Twilio when configured.
        </p>
        <label className="mt-4 block space-y-1.5">
          <span className="text-sm font-medium text-slate-200">
            Mobile number (optional)
          </span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 123 4567"
            className="min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100"
          />
        </label>
        {error ? (
          <p className="mt-3 text-sm text-red-300" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 rounded-xl border border-slate-600 text-sm font-semibold text-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="min-h-12 rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
          >
            {busy ? "Sending…" : "Generate Invite"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminAddMemberModal({
  open,
  storeNumber,
  actor,
  onClose,
  onCreated,
}: {
  open: boolean;
  storeNumber: string;
  actor: StoreSpecialist | null;
  onClose: () => void;
  onCreated: (result: InviteResult) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<SpecialistRole>("Supervisor");
  const [department, setDepartment] =
    useState<DepartmentScope>("plumbing");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setRole("Supervisor");
    setDepartment("plumbing");
    setUsername("");
    setPhone("");
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
    if (!actor) {
      setError("Sign in as Super Admin to issue invites");
      return;
    }
    if (!name.trim()) {
      setError("Enter a full name / name badge");
      return;
    }
    if (!username.trim()) {
      setError("Enter an initial username");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const assigned = role === "MasterAdmin" ? "all" : department;
      const data = await inviteSupervisor(actor, {
        name: name.trim(),
        username: username.trim(),
        department: assigned,
        phone: phone.trim() || undefined,
        role:
          role === "Associate"
            ? "Associate"
            : role === "MasterAdmin"
              ? "MasterAdmin"
              : "Supervisor",
      });
      await onCreated(toInviteResult(data));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not create account. Try a different name/username."
      );
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
          Issues a login for {formatStoreLabel(storeNumber)}. A secure temp PIN
          and /invite link are generated on save.
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
                  ["Associate", "👤 Specialist / CSA"],
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
                      {meta.icon} {meta.label} — {associateFloorTitle(id)}
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

          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-3 py-3">
            <span className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100">
              🎲 Auto-Generated 6-Digit PIN
            </span>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              A cryptographically secure temporary PIN is created on save. You
              will see that PIN in the invite / SMS preview — it is never typed
              by an admin.
            </p>
          </div>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-200">
              Mobile number (optional)
            </span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 123 4567"
              className="min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100"
            />
          </label>

          <p className="text-xs text-slate-500">
            Store Number:{" "}
            <span className="font-mono text-emerald-400">{storeNumber}</span>{" "}
            (auto-attached) · First login requires PIN reset via /invite
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
            disabled={saving || !actor}
            onClick={() => void handleSave()}
            className="flex min-h-12 items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
          >
            {saving ? "Issuing…" : "Save & Issue Invite"}
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
                      {meta.icon} {meta.label} — {associateFloorTitle(id)}
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
