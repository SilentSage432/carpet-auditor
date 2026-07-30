/* DeptSync Hub — offline shell cache */
const CACHE_VERSION = "carpet-hub-shell-v1";
const SHELL_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  const path = url.pathname;
  return (
    path.startsWith("/_next/static/") ||
    path.startsWith("/icons/") ||
    path.endsWith(".css") ||
    path.endsWith(".js") ||
    path.endsWith(".woff2") ||
    path.endsWith(".png") ||
    path.endsWith(".svg") ||
    path.endsWith(".webp") ||
    path.endsWith(".ico") ||
    path === "/manifest.webmanifest"
  );
}

function isNavigation(request) {
  return (
    request.mode === "navigate" ||
    (request.method === "GET" &&
      request.headers.get("accept")?.includes("text/html"))
  );
}

function isDynamicApi(url) {
  return (
    url.hostname.includes("supabase.co") ||
    pathLooksLikeApi(url.pathname)
  );
}

function pathLooksLikeApi(pathname) {
  return pathname.startsWith("/api/") || pathname.includes("/rest/v1/");
}

/** Cache First, Network Fallback — static shell & bundles */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const fallback = await caches.match("/");
    return fallback || Response.error();
  }
}

/** Network First, Cache Fallback — HTML navigations / shell */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const shell = await caches.match("/");
    return shell || Response.error();
  }
}

/** Network only for dynamic/API — app localStorage/queue owns offline data */
async function networkOnly(request) {
  return fetch(request);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    if (isDynamicApi(url)) {
      event.respondWith(networkOnly(request));
    }
    return;
  }

  if (isDynamicApi(url)) {
    event.respondWith(networkOnly(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isNavigation(request)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
