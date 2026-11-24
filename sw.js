// Network-first: ใช้ไฟล์ล่าสุดจากเว็บเสมอ ถ้าเน็ตหลุดค่อยใช้ไฟล์ที่เก็บไว้
const CACHE = 'mayprotein-pos-v1';

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req))
  );
});
