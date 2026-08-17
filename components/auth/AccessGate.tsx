"use client";

/**
 * Public access gate — roster boot + AuthWall only.
 * Does not mount Floor/Map/dashboard chrome.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthWall, type AuthWallMode } from "@/components/auth/AuthWall";
import { DeptSyncSplash } from "@/components/hub/DeptSyncSplash";
import {
  isAuthSessionExpired,
  readAuthSession,
  startAuthSession,
  updateAuthSessionSpecialist,
} from "@/lib/auth-session";
import { safeInternalNext } from "@/lib/auth-gate";
import { syncHubGateCookie } from "@/lib/auth-gate-client";
import {
  needsCredentialSetup,
  fetchSpecialists,
  dedupeRoster,
  syncActiveSpecialistFromRoster,
} from "@/lib/specialists";
import { getStoreNumber, setStoreNumber } from "@/lib/store";
import { getSupabase } from "@/lib/supabase";
import type { StoreSpecialist } from "@/lib/types";

export function AccessGate() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<AuthWallMode | "booting">("booting");
  const [roster, setRoster] = useState<StoreSpecialist[]>([]);
  const [member, setMember] = useState<StoreSpecialist | null>(null);

  const destination = safeInternalNext(searchParams.get("next")) || "/dashboard";

  const enterWorkspace = useCallback(
    async (nextMember: StoreSpecialist) => {
      startAuthSession(nextMember);
      await syncHubGateCookie();
      router.replace(destination);
    },
    [destination, router]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = readAuthSession();
      if (!session || isAuthSessionExpired(session)) {
        if (cancelled) return;
        // Anon cannot SELECT store_specialists — login uses Hub-bridge.
        setRoster([]);
        setMember(null);
        setMode("login");
        return;
      }

      const supabase = getSupabase();
      const { data } = supabase
        ? await supabase.auth.getSession()
        : { data: { session: null } };
      const hasJwt = Boolean(data.session?.access_token);

      let team: StoreSpecialist[] = [];
      if (hasJwt) {
        team = dedupeRoster(await fetchSpecialists());
      }
      if (cancelled) return;
      setRoster(team);

      const matched =
        (hasJwt ? syncActiveSpecialistFromRoster(team) : null) ??
        session.specialist;
      updateAuthSessionSpecialist(matched);
      setMember(matched);

      if (needsCredentialSetup(matched) || matched.must_change_credentials) {
        setMode("setup");
        return;
      }

      if (!hasJwt) {
        setMode("unlock");
        return;
      }

      await enterWorkspace(matched);
    })();
    return () => {
      cancelled = true;
    };
  }, [enterWorkspace]);

  function handleAuthenticated(incoming: StoreSpecialist) {
    const active = getStoreNumber();
    const profileStore = String(incoming.store_number ?? "").trim();
    let nextMember = incoming;
    if (!active && profileStore) {
      const saved = setStoreNumber(profileStore);
      nextMember = { ...incoming, store_number: saved };
    } else if (active) {
      nextMember = { ...incoming, store_number: active };
    }
    setRoster((prev) => dedupeRoster([nextMember, ...prev]));
    void enterWorkspace(nextMember);
  }

  if (mode === "booting") {
    return <DeptSyncSplash message="Loading DeptSync secure session…" />;
  }

  return (
    <AuthWall
      mode={mode}
      roster={roster}
      member={member}
      onAuthenticated={handleAuthenticated}
      onRequestFullLogin={() => {
        setMember(null);
        setMode("login");
      }}
    />
  );
}
