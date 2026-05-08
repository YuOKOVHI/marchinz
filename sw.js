/* MarchinZ PWA — bump CACHE when shell/offline behavior should refresh (deploy with index bump). */
const CACHE = "marchinz-pwa-v1.10.0";

self.addEventListener("install", (event) => {
  const origin = self.location.origin;
  const base = self.location.pathname.replace(/\/[^/]*$/, "") || "";
  const root = origin + (base.endsWith("/") ? base : base + "/");
  const precache = [
    root + "index.html",
    root + "manifest.webmanifest",
    root + "pwa/icon-192.png",
    root + "pwa/icon-512.png",
  ];
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(precache))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((name) => name !== CACHE).map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const origin = self.location.origin;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic" && request.url.startsWith(origin)) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const fromCache = await caches.match(request);
    if (fromCache) return fromCache;
    if (request.mode === "navigate") {
      const shell = await caches.match(new URL("index.html", origin));
      if (shell) return shell;
    }
    return Response.error();
  }
}

/** Firebase Google ログインのリダイレクト復帰 URL には apiKey / authType 等が付く。SW のキャッシュやネットワークフォールバック経由だと初回 HTML とクエリの組み合わせが崩れ、getRedirectResult が空になりやすい（特に iOS）。 */
function navigationLooksLikeFirebaseAuthReturn(url) {
  const sp = url.searchParams;
  if (sp.has("authType")) return true;
  if (sp.has("apiKey") && (sp.has("providerId") || sp.has("signInSuccessUrl"))) return true;
  const mode = sp.get("mode");
  if (mode === "signIn" || mode === "signInViaRedirect") return true;
  if (sp.has("oobCode")) return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/sw.js")) return;
  if (request.mode === "navigate" && navigationLooksLikeFirebaseAuthReturn(url)) {
    return;
  }
  event.respondWith(networkFirst(request));
});
