"use client";

import type { ReactNode } from "react";
import { SessionGate } from "@/components/hub/SessionGate";
import { WorkflowTabShell } from "@/components/hub/WorkflowTabShell";
import { actorFromSpecialist } from "@/lib/store-ops/auth";

export default function WorkflowLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <SessionGate
      allow={(m) => Boolean(actorFromSpecialist(m))}
      denyMessage="This workspace is for department associates, supervisors, and Master Admin."
    >
      {({ specialist, storeNumber, logout }) => (
        <>
          <WorkflowTabShell
            specialist={specialist}
            storeNumber={storeNumber}
            logout={logout}
          />
          {children}
        </>
      )}
    </SessionGate>
  );
}
