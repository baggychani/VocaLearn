// 오프라인에서도 열리도록 앱 파일을 기기에 저장해 둔다(시험장 와이파이가 끊겨도 동작).
// 앱 파일을 고치면 VERSION을 올리고 index.html의 ?v= 값도 똑같이 맞춘다.
const VERSION = "2026112102";
const CACHE = `vocalearn-${VERSION}`;
const ASSETS = [
  "./",
  `./styles.css?v=${VERSION}`,
  `./words.js?v=${VERSION}`,
  `./app.js?v=${VERSION}`,
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("vocalearn-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/** 페이지: 인터넷이 되면 새 버전을, 안 되거나 4초 안에 답이 없으면 저장해 둔 것을 연다. */
async function page(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
    ]);
    if (response.ok) cache.put("./", response.clone());
    return response;
  } catch {
    return (await cache.match("./")) ?? Response.error();
  }
}

/** 나머지 파일: 주소에 버전이 붙어 있으므로 저장해 둔 것을 먼저 쓴다. */
async function asset(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(request.mode === "navigate" ? page(request) : asset(request));
});
