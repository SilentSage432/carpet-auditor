/**
 * VAPID configuration for Web Push.
 * Public key is safe for the browser; private key is server-only.
 */

export function getVapidPublicKey(): string | null {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || null;
}

export function getVapidPrivateKey(): string | null {
  return process.env.VAPID_PRIVATE_KEY?.trim() || null;
}

export function getVapidSubject(): string {
  return (
    process.env.VAPID_SUBJECT?.trim() ||
    "mailto:deptsync-hub@localhost"
  );
}

export function isWebPushConfigured(): boolean {
  return Boolean(getVapidPublicKey() && getVapidPrivateKey());
}
