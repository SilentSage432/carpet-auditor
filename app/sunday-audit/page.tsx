"use client";

/**
 * Legacy /sunday-audit path — opens the in-place Sunday staging drawer on Floor.
 * Avoids 404s from old hashes, PWA shortcuts, and Admin Tools mis-routes.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { requestSundayAuditDrawer } from "@/lib/store-ops/sunday-audit";

export default function SundayAuditRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    requestSundayAuditDrawer();
    router.replace("/dashboard");
  }, [router]);
  return (
    <p className="px-4 py-8 text-center text-sm text-zinc-400">
      Opening Sunday Cycle Audit Engine…
    </p>
  );
}
