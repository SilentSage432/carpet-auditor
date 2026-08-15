import { Suspense } from "react";
import { AccessGate } from "@/components/auth/AccessGate";
import { DeptSyncSplash } from "@/components/hub/DeptSyncSplash";

export const metadata = {
  title: "DeptSync · Sign in",
  robots: { index: false, follow: false, nocache: true },
};

export default function LoginPage() {
  return (
    <Suspense fallback={<DeptSyncSplash message="Loading DeptSync secure session…" />}>
      <AccessGate />
    </Suspense>
  );
}
