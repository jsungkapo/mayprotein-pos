/* MayProtein POS — คิวบิลออฟไลน์
 * ขายตอนไม่มีเน็ต: เก็บบิล (รวมรูปสลิป) ไว้ใน IndexedDB ของเครื่องนี้ แล้วส่งขึ้นเซิร์ฟเวอร์เองเมื่อเน็ตกลับมา
 * เซิร์ฟเวอร์กันบิลซ้ำด้วย client_id จึงส่งซ้ำได้อย่างปลอดภัย */
(function () {
  const DB = 'mayprotein-pos', STORE = 'pendingSales';
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'client_id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(STORE, mode), st = t.objectStore(STORE);
      const out = fn(st);
      t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  };

  const listeners = new Set();
  let cache = [], syncing = false, timer = null;

  const Offline = {
    get items() { return cache; },
    get count() { return cache.length; },
    onChange(fn) { listeners.add(fn); fn(cache); },

    async refresh() {
      try { cache = (await tx('readonly', st => st.getAll())) || []; } catch (e) { cache = []; }
      cache.sort((a, b) => a.created_at.localeCompare(b.created_at));
      listeners.forEach(fn => fn(cache));
      return cache;
    },

    async add(entry) {
      await tx('readwrite', st => st.put(entry));
      await Offline.refresh();
      Offline.schedule();
    },

    async remove(id) {
      await tx('readwrite', st => st.delete(id));
      await Offline.refresh();
    },

    async update(id, patch) {
      const it = cache.find(x => x.client_id === id);
      if (!it) return;
      await tx('readwrite', st => st.put(Object.assign({}, it, patch)));
      await Offline.refresh();
    },

    nextNo() {
      const n = (+localStorage.getItem('pos_offline_no') || 0) + 1;
      try { localStorage.setItem('pos_offline_no', String(n)); } catch (e) {}
      return n;
    },

    /** ส่งบิลค้างทีละใบ คืน { sent: [bill...], failed: n, stopped: bool } */
    async sync(opts) {
      opts = opts || {};
      if (syncing || !cache.length) return { sent: [], failed: 0 };
      if (navigator.onLine === false && !opts.force) return { sent: [], failed: 0, stopped: true };
      syncing = true;
      listeners.forEach(fn => fn(cache));
      const sent = [];
      let failed = 0, stopped = false;
      for (const it of cache.slice()) {
        if (it.error && !opts.retryErrors) { failed++; continue; }
        try {
          const r = await POS.call('createSale', it.payload, { timeout: 45000 });
          await Offline.remove(it.client_id);
          sent.push(Object.assign(r.bill, { local_no: it.local_no, auto_hidden: r.auto_hidden }));
        } catch (e) {
          if (e.network) { stopped = true; break; }
          failed++;
          await Offline.update(it.client_id, { error: e.message, tried_at: new Date().toISOString() });
        }
      }
      syncing = false;
      listeners.forEach(fn => fn(cache));
      if (sent.length && Offline.onSent) Offline.onSent(sent);
      return { sent, failed, stopped };
    },
    get syncing() { return syncing; },

    /** ลองส่งใหม่เป็นระยะ ตราบที่ยังมีบิลค้าง */
    schedule() {
      clearTimeout(timer);
      if (!cache.some(x => !x.error)) return;
      timer = setTimeout(async () => { await Offline.sync(); Offline.schedule(); }, 30000);
    }
  };

  window.addEventListener('online', () => setTimeout(() => Offline.sync(), 1500));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Offline.sync(); });
  window.Offline = Offline;
})();
