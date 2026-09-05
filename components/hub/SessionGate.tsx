"use client";

/**
 * Shared auth gate for Store Ops / Navigation Hub route pages.
 * Single-session rule: admit when a valid auth session exists.
 * Never prompts for PIN/biometrics — that only happens on Hub cold start / login.
 */

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { DeptSyncSplash } from "@/components/hub/DeptSyncSplash";
import {
  clearAuthSession,
  isAuthSessionExpired,
  readAuthSession,
  touchAuthSession,
} from "@/lib/auth-session";
import {
  adoptStoreNumberFromSpecialist,
  resolveActiveStoreNumber,
} from "@/lib/store";
import type { StoreSpecialist } from "@/lib/types";

type SessionGateProps = {
  children: (ctx: {
    specialist: StoreSpecialist;
    storeNumber: string;
    logout: () => void;
  }) => ReactNode;
  /** Optional extra gate after session is valid. */
  allow?: (member: StoreSpecialist) => boolean;
  denyMessage?: string;
  denyHref?: string;
  denyLinkLabel?: string;
};

export function SessionGate({
  children,
  allow,
  denyMessage,
  denyHref = "/",
  denyLinkLabel = "Back to Hub",
}: SessionGateProps) {
  const [specialist, setSpecialist] = useState<StoreSpecialist | null>(null);
  const [ready, setReady] = useState(false);
  const [storeNumber, setStoreNumber] = useState("");

  useEffect(() => {
    const session = readAuthSession();

    if (session && isAuthSessionExpired(session)) {
      clearAuthSession();
      setSpecialist(null);
      setStoreNumber(resolveActiveStoreNumber());
      setReady(true);
      window.location.replace("/login");
      return;
    }
    if (session) {
      const touched = touchAuthSession() ?? session;
      const store = adoptStoreNumberFromSpecialist(
        touched.specialist.store_number
      );
      setSpecialist({
        ...touched.specialist,
        store_number: store || touched.specialist.store_number,
      });
      setStoreNumber(store || resolveActiveStoreNumber(touched.specialist.store_number));
      setReady(true);
      return;
    }
    setSpecialist(null);
    setStoreNumber(resolveActiveStoreNumber());
    setReady(true);
    window.location.replace("/login");
  }, []);

  function logout() {
    clearAuthSession();
    setSpecialist(null);
    window.location.replace("/login");
  }

  if (!ready) {
    return <DeptSyncSplash message="Loading secure session…" />;
  }

  if (!specialist) {
    return <DeptSyncSplash message="Redirecting to sign in…" />;
  }

  if (allow && !allow(specialist)) {
    return (
      <GateMessage title="Access restricted">
        <p className="text-slate-300">
          {denyMessage ?? "Your role cannot open this page."}
        </p>
        <Link
          href={denyHref}
          className="mt-4 inline-block text-emerald-400 underline"
        >
          {denyLinkLabel}
        </Link>
      </GateMessage>
    );
  }

  return <>{children({ specialist, storeNumber, logout })}</>;
}

function GateMessage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400">
        DeptSync
      </p>
      <h1 className="mt-2 text-2xl font-bold text-slate-50">{title}</h1>
      <div className="mt-4">{children}</div>
    </div>
  );
}
