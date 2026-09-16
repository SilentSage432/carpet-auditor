"use client";

/**
 * Lightweight current-instant signal for derived availability.
 * Recomputes locally — does not refetch or write schedules.
 */

import { useEffect, useState } from "react";

function msUntilNextMinute(from = Date.now()): number {
  return 60_000 - (from % 60_000) + 25;
}

/**
 * Updates about once per minute and on visibility/focus.
 * Clock passage alone must not trigger network or assignment writers.
 */
export function useStoreClockTick(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let intervalId: number | undefined;
    let timeoutId: number | undefined;

    function tick() {
      setNow(new Date());
    }

    function onVisible() {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      tick();
    }

    timeoutId = window.setTimeout(() => {
      tick();
      intervalId = window.setInterval(tick, 60_000);
    }, msUntilNextMinute());

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  return now;
}
