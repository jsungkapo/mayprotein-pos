// Network-first: ใช้ไฟล์ล่าสุดจากเว็บเสมอ ถ้าเน็ตหลุดค่อยใช้ไฟล์ที่เก็บไว้ (เปิดแอปตอนไม่มีเน็ตได้)
const CACHE = 'mayprotein-pos-v5';
const CORE = ['./', 'index.html', 'admin.html', 'styles.css', 'config.js', 'api.js', 'offline.js', 'requisition.js', 'report.js', 'receipt.js', 'version.js', 'manifest.json', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    // no-cache: ถามเซิร์ฟเวอร์ทุกครั้งว่าไฟล์เปลี่ยนไหม (ไม่ใช้ไฟล์เก่าจากแคชของเบราว์เซอร์)
    // (หน้า navigate สร้าง Request ใหม่จาก url เพราะใส่ option กับ Request แบบ navigate ตรงๆ ไม่ได้)
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
