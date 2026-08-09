"use client";

/**
 * Shared auth gate for Store Ops / Navigation Hub route pages.
 * Composes hub auth-session; does not invent credentials.
 */

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  clearAuthSession,
  isAuthSessionExpired,
  readAuthSession,
} from "@/lib/auth-session";
import { getStoreNumber } from "@/lib/store";
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
  const [storeNumber, setStoreNumber] = useState("1234");

  useEffect(() => {
    const session = readAuthSession();
    if (!session || isAuthSessionExpired(session)) {
      clearAuthSession();
      setSpecialist(null);
    } else {
      setSpecialist(session.specialist);
    }
    setStoreNumber(getStoreNumber());
    setReady(true);
  }, []);

  function logout() {
    clearAuthSession();
    setSpecialist(null);
    window.location.href = "/";
  }

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-950 px-4">
        <p className="text-sm font-semibold text-slate-400">
          Loading secure session…
        </p>
      </div>
    );
  }

  if (!specialist) {
    return (
      <GateMessage title="Sign in required">
        <p className="text-slate-300">
          Open DeptSync Hub, sign in, then return to this page.
        </p>
        <Link href="/" className="mt-4 inline-block text-emerald-400 underline">
          Go to Hub login
        </Link>
      </GateMessage>
    );
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
