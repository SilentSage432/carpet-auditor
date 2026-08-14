import { useEffect } from "react";

/** Flush pending drafts on tab hide, pagehide, and unmount. */
export function useFlushOnLeave(flush: () => void): void {
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden") flush();
    }
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [flush]);
}
