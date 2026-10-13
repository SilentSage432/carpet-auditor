"use client";

/**
 * Public access gate — roster boot + AuthWall only.
 * Does not mount Floor/Map/dashboard chrome.
 *
 * SEC-OPS-007D: bootstrap always leaves "booting" — failures fail closed to
 * login/unlock and never grant workspace entry.
 * AUTH-002: refreshable JWT resume, single hub-gate sync, gate failure surfaces.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthWall, type AuthWallMode } from "@/components/auth/AuthWall";
import { DeptSyncSplash } from "@/components/hub/DeptSyncSplash";
import { decideAccessGateBoot } from "@/lib/auth/access-gate-bootstrap";
import { resolveLiveSupabaseSession } from "@/lib/auth/live-session";
import {
  clearAuthSession,
  isAuthSessionExpired,
  readAuthSession,
  startAuthSession,
  updateAuthSessionSpecialist,
} from "@/lib/auth-session";
import { safeInternalNext } from "@/lib/auth-gate";
import { syncHubGateCookie } from "@/lib/auth-gate-client";
import { homeHrefForSpecialist } from "@/lib/nav-hub";
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
  const [enterError, setEnterError] = useState<string | null>(null);
  const bootGenRef = useRef(0);

  const nextParam = safeInternalNext(searchParams.get("next"));

  const enterWorkspace = useCallback(
    async (nextMember: StoreSpecialist, bootGen: number) => {
      if (bootGenRef.current !== bootGen) return;
      startAuthSession(nextMember);
      if (bootGenRef.current !== bootGen) return;
      const gated = await syncHubGateCookie();
      if (bootGenRef.current !== bootGen) return;
      if (!gated) {
        throw new Error(
          "Could not open a secure hub session. Check your connection and try again."
        );
      }
      const destination = nextParam || homeHrefForSpecialist(nextMember);
      if (process.env.NODE_ENV !== "production") {
        console.info("[auth-002] enter workspace", { destination });
      }
      router.replace(destination);
    },
    [nextParam, router]
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

        // AUTH-002: attempt refresh before concluding no JWT.
        const live = await resolveLiveSupabaseSession();
        if (!stillActive()) return;
        const hasJwt = live.hasAccessToken;

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
          updateAuthSessionSpecialist(outcome.member);
          setRoster(outcome.roster);
          setMember(outcome.member);
          try {
            await enterWorkspace(outcome.member, bootGen);
            if (!stillActive()) return;
            setMode((current) => (current === "booting" ? "unlock" : current));
          } catch (err) {
            if (!stillActive()) return;
            setEnterError(
              err instanceof Error
                ? err.message
                : "Could not resume your session. Unlock with PIN."
            );
            setMode("unlock");
          }
          return;
        }

        if (outcome.member && outcome.mode !== "login") {
          updateAuthSessionSpecialist(outcome.member);
        }
        setRoster(outcome.roster);
        setMember(outcome.member);
        setMode(
          outcome.mode === "login" ||
            outcome.mode === "unlock" ||
            outcome.mode === "setup"
            ? outcome.mode
            : "unlock"
        );
      } catch {
        if (!stillActive()) return;
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
    setEnterError(null);
    const bootGen = bootGenRef.current;
    void enterWorkspace(nextMember, bootGen).catch((err) => {
      setEnterError(
        err instanceof Error
          ? err.message
          : "Could not open workspace. Try signing in again."
      );
      setMode("login");
    });
  }

  if (mode === "booting") {
    return <DeptSyncSplash message="Loading DeptSync secure session…" />;
  }

  return (
    <>
      {enterError ? (
        <p
          role="alert"
          className="fixed inset-x-0 top-3 z-[95] mx-auto w-[min(92vw,28rem)] rounded-xl border border-rose-500/40 bg-rose-950/95 px-3 py-2 text-center text-sm font-semibold text-rose-100"
        >
          {enterError}
        </p>
      ) : null}
      <AuthWall
        mode={mode}
        roster={roster}
        member={member}
        onAuthenticated={handleAuthenticated}
        onRequestFullLogin={() => {
          setMember(null);
          setEnterError(null);
          setMode("login");
        }}
      />
    </>
  );
}
