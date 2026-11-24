/* MayProtein POS — shared API client + login screen (ใช้ทั้ง index.html และ admin.html) */
(function () {
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  const ERR = {
    unauthorized: 'กรุณาเข้าสู่ระบบใหม่',
    forbidden: 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้',
    NO_API: 'ยังไม่ได้ตั้งค่า URL ของเซิร์ฟเวอร์',
    NETWORK: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตหรือ URL ของเซิร์ฟเวอร์'
  };

  const POS = {
    apiUrl() { return LS.get('pos_api_url') || (window.POS_CONFIG && window.POS_CONFIG.API_URL) || ''; },
    token() { return LS.get('pos_token') || ''; },
    user() { try { return JSON.parse(LS.get('pos_user') || 'null'); } catch (e) { return null; } },
    isAdmin() { const u = this.user(); return !!u && u.role === 'admin'; },
    saveSession(token, user) { LS.set('pos_token', token); LS.set('pos_user', JSON.stringify(user)); },
    clearSession() { LS.del('pos_token'); LS.del('pos_user'); LS.del('pos_admin_cache'); },
    pref(k, v) { if (v === undefined) return LS.get('pos_pref_' + k); LS.set('pos_pref_' + k, v); },

    async call(action, payload) {
      const url = this.apiUrl();
      if (!url) throw new Error(ERR.NO_API);
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action, payload: payload || {}, token: this.token() })
        });
      } catch (e) { throw new Error(ERR.NETWORK); }
      let j;
      try { j = await res.json(); } catch (e) { throw new Error(ERR.NETWORK); }
      if (!j.ok) {
        if (j.error === 'unauthorized') { this.clearSession(); setTimeout(() => location.reload(), 1200); }
        throw new Error(ERR[j.error] || j.error || 'เกิดข้อผิดพลาด');
      }
      return j;
    },

    async logout() {
      try { await this.call('logout'); } catch (e) {}
      this.clearSession();
      location.reload();
    },

    toast(msg, isErr) {
      let t = document.getElementById('toast');
      if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
      t.textContent = msg;
      t.className = 'toast on' + (isErr ? ' err' : '');
      clearTimeout(t._h);
      t._h = setTimeout(() => { t.className = 'toast' + (isErr ? ' err' : ''); }, isErr ? 3500 : 2000);
    },

    esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    money(n) { return Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 }); },

    /** แสดงหน้าล็อกอินถ้ายังไม่ได้ล็อกอิน แล้วเรียก onReady(user) เมื่อพร้อม */
    requireLogin(onReady, opts) {
      opts = opts || {};
      const u = this.user();
      if (u && this.token()) {
        if (opts.adminOnly && u.role !== 'admin') { showLogin('หน้านี้สำหรับแอดมินเท่านั้น', true); return; }
        onReady(u);
        this.call('me').then(r => {
          this.saveSession(this.token(), r.user);
          if (opts.adminOnly && r.user.role !== 'admin') location.reload();
        }).catch(() => {});
        return;
      }
      showLogin('', false);

      function showLogin(msg, isErr) {
        let el = document.getElementById('loginScreen');
        if (!el) { el = document.createElement('div'); el.id = 'loginScreen'; document.body.appendChild(el); }
        let mode = 'login';
        const render = () => {
          const url = POS.apiUrl();
          el.innerHTML = `<div class="login-wrap">
            <div class="login-logo"><div class="mark">M</div><h1>MayProtein POS</h1><p>${opts.adminOnly ? 'หลังบ้าน (แอดมิน)' : 'ระบบขายหน้าร้าน'}</p></div>
            <div class="seg"><button data-m="login" class="${mode === 'login' ? 'on' : ''}">เข้าสู่ระบบ</button><button data-m="register" class="${mode === 'register' ? 'on' : ''}">สมัครพนักงานใหม่</button></div>
            <form id="lf" autocomplete="on">
              <label>ชื่อผู้ใช้ (ภาษาอังกฤษ)</label>
              <input id="lfUser" autocapitalize="none" autocorrect="off" autocomplete="username" required>
              ${mode === 'register' ? '<label>ชื่อที่แสดง</label><input id="lfName" placeholder="เช่น เมย์" required>' : ''}
              <label>PIN (ตัวเลข 4–6 หลัก)</label>
              <input id="lfPin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required>
              ${mode === 'register' ? '<label>ยืนยัน PIN</label><input id="lfPin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" required>' : ''}
              <br><br><button class="btn" id="lfBtn">${mode === 'login' ? 'เข้าสู่ระบบ' : 'สมัคร'}</button>
            </form>
            <div class="login-msg ${isErr ? 'err' : 'ok'}" id="lfMsg">${POS.esc(msg)}</div>
            ${mode === 'register' ? '<div class="login-foot">สมัครแล้วต้องรอแอดมินอนุมัติก่อนใช้งาน<br>(คนแรกที่สมัครจะเป็นแอดมินอัตโนมัติ)</div>' : ''}
            <div class="login-foot"><a id="lfApi">${url ? 'ตั้งค่าเซิร์ฟเวอร์' : '⚠️ ยังไม่ได้ตั้งค่าเซิร์ฟเวอร์ — แตะเพื่อตั้งค่า'}</a></div>
          </div>`;
          el.classList.add('on');
          el.querySelectorAll('.seg button').forEach(b => b.onclick = () => { mode = b.dataset.m; msg = ''; render(); });
          el.querySelector('#lfApi').onclick = () => {
            const v = prompt('วาง URL ของ Apps Script Web App (ลงท้ายด้วย /exec)', POS.apiUrl());
            if (v !== null) { if (v.trim()) LS.set('pos_api_url', v.trim()); else LS.del('pos_api_url'); render(); }
          };
          el.querySelector('#lf').onsubmit = async ev => {
            ev.preventDefault();
            const m = el.querySelector('#lfMsg');
            const btn = el.querySelector('#lfBtn');
            const username = el.querySelector('#lfUser').value.trim().toLowerCase();
            const pin = el.querySelector('#lfPin').value.trim();
            m.className = 'login-msg';
            if (mode === 'register' && pin !== el.querySelector('#lfPin2').value.trim()) { m.className = 'login-msg err'; m.textContent = 'PIN ทั้งสองช่องไม่ตรงกัน'; return; }
            btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
            try {
              if (mode === 'register') {
                const r = await POS.call('register', { username, pin, display_name: el.querySelector('#lfName').value.trim() });
                mode = 'login';
                if (r.user.status === 'active') { msg = 'สมัครสำเร็จ คุณเป็นแอดมินคนแรก เข้าสู่ระบบได้เลย'; }
                else { msg = 'สมัครสำเร็จ รอแอดมินอนุมัติแล้วค่อยเข้าสู่ระบบ'; }
                isErr = false; render();
                el.querySelector('#lfUser').value = username;
                return;
              }
              const r = await POS.call('login', { username, pin });
              if (opts.adminOnly && r.user.role !== 'admin') throw new Error('หน้านี้สำหรับแอดมินเท่านั้น');
              POS.saveSession(r.token, r.user);
              el.classList.remove('on');
              onReady(r.user);
            } catch (e) {
              m.className = 'login-msg err'; m.textContent = e.message;
              btn.disabled = false; btn.textContent = mode === 'login' ? 'เข้าสู่ระบบ' : 'สมัคร';
            }
          };
        };
        render();
      }
    },

    /** ครอปรูปเป็นสี่เหลี่ยมจัตุรัสตรงกลาง ย่อเหลือ size px แล้วคืน base64 JPEG (ไม่มี prefix) */
    squareImage(file, size) {
      size = size || 600;
      return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          const s = Math.min(img.naturalWidth, img.naturalHeight);
          const c = document.createElement('canvas');
          c.width = c.height = Math.min(size, s);
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          resolve(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('อ่านไฟล์รูปไม่ได้')); };
        img.src = url;
      });
    },

    /** อ่านรูปตามสัดส่วนเดิม (สำหรับ QR) ย่อด้านยาวสุดเหลือ max px */
    scaledImage(file, max) {
      max = max || 1000;
      return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          resolve(c.toDataURL('image/png').split(',')[1]);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('อ่านไฟล์รูปไม่ได้')); };
        img.src = url;
      });
    },

    /** เปิดตัวเลือกไฟล์/กล้อง แล้วคืนไฟล์ หรือ null ถ้ากดยกเลิก (ต้องเรียกจากการกดปุ่มโดยตรง) */
    pickFile(input) {
      return new Promise(resolve => {
        input.value = '';
        let done = false;
        const finish = v => { if (done) return; done = true; window.removeEventListener('focus', onFocus); resolve(v); };
        const onFocus = () => setTimeout(() => { if (!input.files.length) finish(null); }, 3000);
        input.oncancel = () => finish(null);
        input.onchange = () => finish(input.files[0] || null);
        window.addEventListener('focus', onFocus);
        input.click();
      });
    },

    /** ย่อรูปถ่าย (เช่น สลิป) ให้ด้านยาวไม่เกิน max px แล้วคืน base64 JPEG (ไม่มี prefix) */
    jpegImage(file, max, quality) {
      max = max || 1280;
      return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          resolve(c.toDataURL('image/jpeg', quality || 0.7).split(',')[1]);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('อ่านไฟล์รูปไม่ได้')); };
        img.src = url;
      });
    },

    /** รหัสไฟล์ Google Drive จากลิงก์รูป */
    driveId(url) { const m = String(url || '').match(/\/d\/([\w-]{20,})|[?&]id=([\w-]{20,})/); return m ? (m[1] || m[2]) : ''; },

    /** รูปจาก Drive โหลดไม่ขึ้น: ลองลิงก์แบบ thumbnail แทน ถ้ายังไม่ได้ก็ซ่อน (ใช้ใน onerror) */
    imgFix(img) {
      const id = POS.driveId(img.getAttribute('src'));
      if (id && !img.dataset.tried) { img.dataset.tried = '1'; img.src = 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1000'; return; }
      if (img.dataset.keep) return;
      img.style.visibility = 'hidden';
    },

    /** โหลดรูปผ่านเซิร์ฟเวอร์ (ไม่พึ่งลิงก์สาธารณะของ Drive) แล้วจำไว้ในเครื่อง คืน data URI */
    async imageData(url) {
      if (!url) return '';
      const key = 'pos_img_' + POS.driveId(url);
      const hit = LS.get(key);
      if (hit) return hit;
      const r = await POS.call('getImage', { url });
      const data = 'data:' + r.mime + ';base64,' + r.data;
      LS.set(key, data);
      return data;
    },

    /** ให้เซิร์ฟเวอร์ดึงโค้ดล่าสุดจาก GitHub ทันที แล้วโหลดหน้าเว็บใหม่ (ไม่ต้องจำว่าต้องเติม ?refresh=1) */
    async updateSystem(btn) {
      const url = POS.apiUrl();
      if (!url) return POS.toast('ยังไม่ได้ตั้งค่าเซิร์ฟเวอร์', true);
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin dark"></span> กำลังอัปเดต'; }
      let ok = false;
      try { const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'refresh=1&t=' + Date.now()); const j = await r.json(); ok = !!(j && j.refreshed); }
      catch (e) { try { await fetch(url + '?refresh=1&t=' + Date.now(), { mode: 'no-cors' }); ok = true; } catch (e2) {} }
      try { const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : []; await Promise.all(regs.map(r => r.update())); } catch (e) {}
      POS.toast(ok ? 'อัปเดตระบบเป็นเวอร์ชันล่าสุดแล้ว' : 'อัปเดตหน้าเว็บแล้ว (เซิร์ฟเวอร์จะอัปเดตเองภายใน 5–10 นาที)', !ok);
      setTimeout(() => location.reload(), 1200);
    },

    uuid() {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    }
  };

  window.POS = POS;

  // ปลุกเซิร์ฟเวอร์ตั้งแต่เปิดหน้า (Apps Script ที่ไม่ได้ใช้สักพักจะตื่นช้า)
  try { const u = POS.apiUrl(); if (u) fetch(u, { mode: 'no-cors' }).catch(() => {}); } catch (e) {}
})();
