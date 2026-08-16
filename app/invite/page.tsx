"use client";

/**
 * Legacy /invite?token= → /auth/verify/[token]
 */

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

export default function InviteIndexPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-slate-400">Loading…</p>}>
      <InviteIndexRedirect />
    </Suspense>
  );
}

function InviteIndexRedirect() {
  const search = useSearchParams();
  const router = useRouter();
  const token = (search.get("token") || "").trim();
  const test = search.get("test");

  useEffect(() => {
    if (!token) return;
    const qs = test ? `?test=${encodeURIComponent(test)}` : "";
    router.replace(`/auth/verify/${encodeURIComponent(token)}${qs}`);
  }, [token, test, router]);

  if (token) {
    return <p className="p-6 text-sm text-slate-400">Opening setup…</p>;
  }

  return (
    <p className="p-6 text-sm text-red-200">
      Missing invite token. Open the link from your SMS.
    </p>
  );
}
