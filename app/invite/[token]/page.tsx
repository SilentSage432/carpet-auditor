"use client";

/**
 * Legacy /invite/[token] → /auth/verify/[token]
 */

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

export default function LegacyInviteTokenPage() {
  return (
    <Suspense fallback={null}>
      <Redirect />
    </Suspense>
  );
}

function Redirect() {
  const params = useParams<{ token: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const token = String(params.token ?? "").trim();
  const test = search.get("test");

  useEffect(() => {
    if (!token) return;
    const qs = test ? `?test=${encodeURIComponent(test)}` : "";
    router.replace(`/auth/verify/${encodeURIComponent(token)}${qs}`);
  }, [token, test, router]);

  return (
    <p className="p-6 text-center text-sm text-slate-400">Opening setup…</p>
  );
}
