"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { requestSundayAuditDrawer } from "@/lib/store-ops/sunday-audit";

export default function SundayRotationRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    requestSundayAuditDrawer();
    router.replace("/dashboard");
  }, [router]);
  return (
    <p className="px-4 py-8 text-center text-sm text-zinc-400">
      Opening Sunday Rotation Engine…
    </p>
  );
}
