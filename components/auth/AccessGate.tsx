"use client";

/**
 * Public access gate — roster boot + AuthWall only.
 * Does not mount Floor/Map/dashboard chrome.
 *
 * SEC-OPS-007D: bootstrap always leaves "booting" — failures fail closed to
 * login/unlock and never grant workspace entry.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthWall, type AuthWallMode } from "@/components/auth/AuthWall";
import { DeptSyncSplash } from "@/components/hub/DeptSyncSplash";
import { decideAccessGateBoot } from "@/lib/auth/access-gate-bootstrap";
import {
  clearAuthSession,
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
  const bootGenRef = useRef(0);

  const destination = safeInternalNext(searchParams.get("next")) || "/dashboard";

  const enterWorkspace = useCallback(
    async (nextMember: StoreSpecialist, bootGen: number) => {
      if (bootGenRef.current !== bootGen) return;
      startAuthSession(nextMember);
      if (bootGenRef.current !== bootGen) return;
      await syncHubGateCookie();
      if (bootGenRef.current !== bootGen) return;
      router.replace(destination);
    },
    [destination, router]
  );

  useEffect(() => {
    const bootGen = ++bootGenRef.current;
    let cancelled = false;

    const stillActive = () => !cancelled && bootGenRef.current === bootGen;

    void (async () => {
      try {
        const session = readAuthSession();
        const expired = Boolean(session && isAuthSessionExpired(session));

        if (!session || expired) {
          const outcome = decideAccessGateBoot({
            session,
            sessionExpired: expired,
            hasJwt: false,
            roster: null,
            rosterError: null,
            matched: null,
            needsSetup: false,
          });
          if (!stillActive()) return;
          if (outcome.clearHubSession) clearAuthSession();
          setRoster([]);
          setMember(null);
          setMode("login");
          return;
        }

        const supabase = getSupabase();
        let hasJwt = false;
        try {
          const { data } = supabase
            ? await supabase.auth.getSession()
            : { data: { session: null } };
          if (!stillActive()) return;
          hasJwt = Boolean(data.session?.access_token);
        } catch {
          if (!stillActive()) return;
          hasJwt = false;
        }

        let team: StoreSpecialist[] | null = null;
        let rosterError: unknown | null = null;
        if (hasJwt) {
          try {
            team = dedupeRoster(await fetchSpecialists());
          } catch (err) {
            rosterError = err;
            team = null;
          }
        } else {
          team = [];
        }
        if (!stillActive()) return;

        const matched =
          (hasJwt && team
            ? syncActiveSpecialistFromRoster(team)
            : null) ?? session.specialist;

        const outcome = decideAccessGateBoot({
          session,
          sessionExpired: false,
          hasJwt,
          roster: team,
          rosterError,
          matched,
          needsSetup:
            needsCredentialSetup(matched) ||
            Boolean(matched.must_change_credentials),
        });

        if (!stillActive()) return;

        if (outcome.clearHubSession) {
          clearAuthSession();
        }
        if (outcome.clearSupabaseLocal) {
          const client = getSupabase();
          if (client) {
            void client.auth.signOut({ scope: "local" });
          }
        }

        if (outcome.mode === "enter" && outcome.member) {
          // Keep splash until navigation; recover to unlock if enter fails.
          updateAuthSessionSpecialist(outcome.member);
          setRoster(outcome.roster);
          setMember(outcome.member);
          try {
            await enterWorkspace(outcome.member, bootGen);
            if (!stillActive()) return;
            // router.replace does not always unmount immediately — never stay booting.
            setMode((current) => (current === "booting" ? "unlock" : current));
          } catch {
            if (!stillActive()) return;
            setMode("unlock");
          }
          return;
        }

        if (outcome.member && outcome.mode !== "login") {
          updateAuthSessionSpecialist(outcome.member);
        }
        setRoster(outcome.roster);
        setMember(outcome.member);
        // enter is handled above — remaining modes are AuthWall modes only.
        setMode(
          outcome.mode === "login" ||
            outcome.mode === "unlock" ||
            outcome.mode === "setup"
            ? outcome.mode
            : "unlock"
        );
      } catch {
        if (!stillActive()) return;
        // Absolute fail-closed: never grant access; show full login.
        setRoster([]);
        setMember(null);
        setMode("login");
      }
    })();

    return () => {
      cancelled = true;
      bootGenRef.current += 1;
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
    const bootGen = bootGenRef.current;
    void enterWorkspace(nextMember, bootGen).catch(() => {
      setMode("login");
    });
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
