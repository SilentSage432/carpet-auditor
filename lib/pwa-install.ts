/**
 * Captures beforeinstallprompt for deferred "Add to Home Screen" UI.
 * Does not invent installability — only surfaces the browser event when fired.
 */

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
let listening = false;

function isInstallEvent(e: Event): e is BeforeInstallPromptEvent {
  return (
    typeof (e as BeforeInstallPromptEvent).prompt === "function" &&
    "userChoice" in e
  );
}

/** Call once from app root (client) so pair / invite / settings can prompt later. */
export function initPwaInstallCapture(): void {
  if (typeof window === "undefined" || listening) return;
  listening = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    if (isInstallEvent(e)) deferred = e;
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
  });
}

export function canPromptPwaInstall(): boolean {
  return deferred != null;
}

export function getDeferredPwaInstall(): BeforeInstallPromptEvent | null {
  return deferred;
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia("(display-mode: standalone)");
  // iOS Safari
  const iosStandalone =
    "standalone" in navigator &&
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return mq.matches || iosStandalone;
}

export async function promptPwaInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferred) return "unavailable";
  const event = deferred;
  deferred = null;
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome;
}
