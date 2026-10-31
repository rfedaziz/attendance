// يحفظ ملفات التطبيق على التلفون حتى يعمل بدون إنترنت
const CACHE = "attendance-v1";
const FILES = ["./", "./index.html", "./app.js", "./config.js", "./jsQR.js", "./manifest.json", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // لا تتدخل في طلبات Google
  // الشبكة أولاً (لتحديث الملفات)، وإذا ماكو نت نستخدم النسخة المحفوظة
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("./index.html"))));
});
