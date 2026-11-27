/* MayProtein POS — รายงานสรุปยอดขายตามช่วงวันที่ (แยกรายวัน) + สร้าง PDF A4 ด้วย PdfKit จาก requisition.js */
(function () {
  const MLABEL = { cash: 'เงินสด', transfer: 'โอน' };
  const money = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const normMethod = m => (m === 'promptpay' ? 'transfer' : m);

  /** รวมยอดจากบิล: ทั้งช่วง + แยกวัน */
  function aggregate(bills) {
    const blank = () => ({ bills: 0, cash: 0, transfer: 0, discount: 0, subtotal: 0, net: 0, items: {}, packages: {}, itemIds: {} });
    const all = blank(), days = {};
    all.cancelled = bills.filter(b => b.status === 'cancelled').length;
    bills.filter(b => b.status !== 'cancelled').forEach(b => {
      const d = String(b.datetime).slice(0, 10);
      const day = days[d] || (days[d] = Object.assign(blank(), { date: d }));
      const m = normMethod(b.payment_method);
      [all, day].forEach(g => {
        g.bills++; g.net += b.total; g.discount += b.discount_amount; g.subtotal += b.subtotal;
        if (m === 'cash') g.cash += b.total; else g.transfer += b.total;
        b.items.forEach(i => {
          if (i.package_id && !i.slot) { g.packages[i.item_name] = (g.packages[i.item_name] || 0) + i.qty; return; }
          g.items[i.item_name] = (g.items[i.item_name] || 0) + i.qty;
          if (i.item_id) g.itemIds[i.item_id] = (g.itemIds[i.item_id] || 0) + i.qty;
        });
      });
    });
    all.days = Object.keys(days).sort().map(k => days[k]);
    return all;
  }

  const sorted = o => Object.entries(o).sort((a, b) => b[1] - a[1]);

  /* ---------- กราฟ (วาดบน canvas ใช้ทั้งหน้าจอและ PDF) ---------- */
  // ชุดสีแยกประเภท (ผ่านการตรวจตาบอดสีแล้ว) ใช้ตามลำดับเสมอ ไม่วนสี — เกิน 7 รายการรวมเป็น "อื่นๆ"
  const CAT = ['#257de0', '#f47230', '#00b894', '#f2a600', '#ee7fac', '#008a17', '#6a4ce2'];
  const OTHER = '#b9bcc2', BAR = '#e8336d', INK = '#191919', INK2 = '#666666', GRID = '#ececf0';
  const CFONT = '"Sarabun","Thonburi","Leelawadee UI","Tahoma",sans-serif';

  /** สินค้าที่ขายได้ → ชิ้นของกราฟวงกลม (มากสุด 7 + อื่นๆ) */
  function pieData(items) {
    const all = sorted(items).filter(([, v]) => v > 0);
    const total = all.reduce((a, [, v]) => a + v, 0);
    if (!total) return [];
    const top = all.length > 8 ? all.slice(0, 7) : all.slice(0, 8);
    const rest = all.slice(top.length).reduce((a, [, v]) => a + v, 0);
    const out = top.map(([label, value], i) => ({ label, value, color: CAT[i] || OTHER }));
    if (rest) out.push({ label: `อื่นๆ (${all.length - top.length} รายการ)`, value: rest, color: OTHER });
    out.forEach(d => d.pct = d.value / total * 100);
    return out;
  }

  /** ทุกวันในช่วงที่เลือก (วันที่ไม่มีขาย = 0) */
  function dayData(g, from, to) {
    const byDay = {}; g.days.forEach(d => byDay[d.date] = d.net);
    const out = [];
    const d = new Date(from + 'T00:00:00'), end = new Date((to || from) + 'T00:00:00');
    for (let i = 0; d <= end && i < 400; i++) {
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push({ date: k, label: `${d.getDate()}/${d.getMonth() + 1}`, value: byDay[k] || 0 });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  const pctText = p => (p >= 10 ? p.toFixed(0) : p.toFixed(1)) + '%';
  function fitText(ctx, t, w) { t = String(t); if (ctx.measureText(t).width <= w) return t; while (t.length > 1 && ctx.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; }

  /** วาดกราฟวงกลม + คำอธิบาย ในหน่วย css px (u = จำนวนพิกเซลจริงต่อ 1 หน่วย) */
  function drawPie(ctx, W, H, data, u) {
    ctx.save(); ctx.scale(u, u);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    if (!data.length) { ctx.fillStyle = INK2; ctx.font = `14px ${CFONT}`; ctx.textAlign = 'center'; ctx.fillText('ไม่มีข้อมูลการขาย', W / 2, H / 2); ctx.restore(); return; }
    const wide = W >= 460;
    const D = wide ? Math.min(H - 8, W * 0.42) : Math.min(W - 40, 220);
    const cx = wide ? D / 2 + 4 : W / 2, cy = D / 2 + 4, r = D / 2;
    let a = -Math.PI / 2;
    data.forEach(d => {
      const b = a + d.value / data.reduce((s, x) => s + x.value, 0) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a, b); ctx.closePath();
      ctx.fillStyle = d.color; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();   // ช่องว่าง 2px ระหว่างชิ้น
      // ใส่ % บนชิ้นที่ใหญ่พอ
      if (d.pct >= 7) {
        const m = (a + b) / 2;
        ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.max(11, r * 0.13)}px ${CFONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(pctText(d.pct), cx + Math.cos(m) * r * 0.64, cy + Math.sin(m) * r * 0.64);
      }
      a = b;
    });
    // คำอธิบาย: สี · ชื่อ · จำนวน · %
    const lx = wide ? D + 28 : 4, ly0 = wide ? Math.max(8, cy - data.length * 13) : D + 22, lw = W - lx - 4, rh = 26;
    ctx.textBaseline = 'middle';
    data.forEach((d, i) => {
      const y = ly0 + i * rh + rh / 2;
      ctx.fillStyle = d.color; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(lx, y - 6, 12, 12, 3) : ctx.rect(lx, y - 6, 12, 12); ctx.fill();
      ctx.font = `700 13px ${CFONT}`; ctx.fillStyle = INK; ctx.textAlign = 'right';
      const pt = pctText(d.pct); ctx.fillText(pt, lx + lw, y);
      const pw = ctx.measureText(pt).width;
      ctx.font = `13px ${CFONT}`; ctx.fillStyle = INK2;
      const q = money(d.value) + ' ชิ้น'; ctx.fillText(q, lx + lw - pw - 10, y);
      const qw = ctx.measureText(q).width;
      ctx.textAlign = 'left'; ctx.fillStyle = INK;
      ctx.fillText(fitText(ctx, d.label.replace(/^May Protein /, ''), lw - pw - qw - 40), lx + 20, y);
    });
    ctx.restore();
  }
  function pieHeight(W, n) { return W >= 460 ? Math.max(220, n * 26 + 16) : Math.min(W - 40, 220) + 30 + n * 26; }

  /** วาดกราฟแท่งยอดขายรายวัน */
  function drawBars(ctx, W, H, days, u) {
    ctx.save(); ctx.scale(u, u);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const max = Math.max(0, ...days.map(d => d.value));
    const step = nice(max / 4 || 1), top = Math.max(step * 4, step);
    ctx.font = `11px ${CFONT}`;
    const yl = Math.max(...[0, 1, 2, 3, 4].map(i => ctx.measureText(short(step * i)).width)) + 8;
    const L = yl, R = W - 4, T = 22, B = H - 24;
    // เส้นกริดจางๆ + ตัวเลขแกน
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const y = B - (B - T) * (step * i) / top;
      ctx.strokeStyle = i ? GRID : '#c9cad0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke();
      ctx.fillStyle = INK2; ctx.fillText(short(step * i), L - 6, y);
    }
    const n = days.length, slot = (R - L) / Math.max(n, 1), bw = Math.max(2, Math.min(36, slot * 0.68));
    const every = Math.ceil(n / Math.floor((R - L) / 34));          // เว้นป้ายวันที่ถ้าแน่นเกิน
    const showVal = n <= 14;
    const maxI = days.findIndex(d => d.value === max && max > 0);
    days.forEach((d, i) => {
      const x = L + slot * i + (slot - bw) / 2, h = (B - T) * d.value / top;
      if (h > 0) {
        const rr = Math.min(4, bw / 2, h);
        ctx.fillStyle = BAR; ctx.beginPath();
        ctx.moveTo(x, B); ctx.lineTo(x, B - h + rr); ctx.quadraticCurveTo(x, B - h, x + rr, B - h);
        ctx.lineTo(x + bw - rr, B - h); ctx.quadraticCurveTo(x + bw, B - h, x + bw, B - h + rr); ctx.lineTo(x + bw, B); ctx.closePath(); ctx.fill();
      }
      if ((showVal && d.value > 0) || i === maxI) {
        ctx.fillStyle = INK; ctx.font = `700 11px ${CFONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(short(d.value), x + bw / 2, B - h - 3);
      }
      if (i % every === 0) { ctx.fillStyle = INK2; ctx.font = `11px ${CFONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(d.label, x + bw / 2, B + 6); }
    });
    ctx.restore();
  }
  function nice(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
  function short(v) { return v >= 1e6 ? +(v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? +(v / 1e3).toFixed(1) + 'k' : money(Math.round(v)); }

  /** สร้าง canvas สำหรับหน้าจอ (คมบนจอ retina) */
  function chartCanvas(kind, data, cssW) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cssH = kind === 'pie' ? pieHeight(cssW, data.length || 1) : 220;
    const c = document.createElement('canvas');
    c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
    c.style.width = cssW + 'px'; c.style.height = cssH + 'px'; c.style.display = 'block';
    (kind === 'pie' ? drawPie : drawBars)(c.getContext('2d'), cssW, cssH, data, dpr);
    return c;
  }

  async function pdf(opt) {
    const K = window.PdfKit;
    await K.fonts();
    const g = aggregate(opt.bills);
    const period = opt.from === opt.to ? K.thaiDate(opt.from) : `${K.thaiDate(opt.from)} – ${K.thaiDate(opt.to)}`;
    const pages = [];
    let pg, P, y;
    const L = 15, R = 195, BOTTOM = 278;

    const newPage = () => {
      pg = K.newPage(); P = pg.P; pages.push(pg);
      P.text(opt.shop || 'MayProtein', L, 14, 10, { color: '#888' });
      P.text('รายงานสรุปยอดขาย', 105, 22, 18, { align: 'center', bold: true });
      P.text(opt.title ? 'งาน: ' + opt.title : '', 105, 30, 14, { align: 'center', color: '#0b3d91', bold: true });
      P.text('ช่วงวันที่ ' + period + (g.cancelled ? ` · ไม่รวมบิลที่ยกเลิก ${g.cancelled} บิล` : ''), 105, 37, 12, { align: 'center' });
      P.line(L, 41, R, 41, 0.3);
      y = 49;
    };
    const ensure = h => { if (y + h > BOTTOM) newPage(); };
    const heading = t => { ensure(18); y += 3; P.text(t, L, y, 13, { bold: true }); y += 4; };
    const fill = (x1, y1, x2, y2, color) => { pg.ctx.fillStyle = color; pg.ctx.fillRect(x1 * K.MM, y1 * K.MM, (x2 - x1) * K.MM, (y2 - y1) * K.MM); };

    /** ตาราง: cols = [{ label, w, align }] ; rows = [[...]] ; opts.total = แถวรวมตัวหนา */
    const table = (cols, rows, opts) => {
      opts = opts || {};
      const rh = 7.2;
      const xs = [L]; cols.forEach(c => xs.push(xs[xs.length - 1] + c.w));
      const head = () => {
        fill(L, y, xs[xs.length - 1], y + rh, '#f1f2f5');
        cols.forEach((c, i) => P.text(c.label, c.align === 'right' ? xs[i + 1] - 2 : xs[i] + 2, y + 5, 10.5, { bold: true, align: c.align === 'right' ? 'right' : 'left' }));
        P.line(L, y, xs[xs.length - 1], y, 0.3); P.line(L, y + rh, xs[xs.length - 1], y + rh, 0.3);
        y += rh;
      };
      ensure(rh * 2 + 2); head();
      const all = rows.concat(opts.total ? [opts.total] : []);
      if (!rows.length) { P.text('— ไม่มีข้อมูล —', L + 2, y + 5, 10.5, { color: '#999' }); y += rh; }
      all.forEach((r, ri) => {
        if (y + rh > BOTTOM) { newPage(); head(); }
        const isTotal = opts.total && ri === all.length - 1;
        if (isTotal) fill(L, y, xs[xs.length - 1], y + rh, '#fdf0f4');
        r.forEach((v, i) => {
          const c = cols[i];
          const s = c.align === 'right' ? String(v) : P.fit(v, c.w - 4, 10.5);
          P.text(s, c.align === 'right' ? xs[i + 1] - 2 : xs[i] + 2, y + 5, 10.5, { bold: isTotal, align: c.align === 'right' ? 'right' : 'left' });
        });
        y += rh;
        P.line(L, y, xs[xs.length - 1], y, isTotal ? 0.3 : 0.12);
      });
      y += 6;
    };

    newPage();

    // กล่องตัวเลขหลัก
    const kpis = [['ยอดขายสุทธิ', money(g.net) + ' ฿'], ['จำนวนบิล', String(g.bills)], ['เงินสด', money(g.cash) + ' ฿'], ['โอน', money(g.transfer) + ' ฿'], ['ส่วนลดรวม', money(g.discount) + ' ฿']];
    const bw = (R - L - 4 * 3) / 5;
    kpis.forEach(([k, v], i) => {
      const x = L + i * (bw + 3);
      fill(x, y, x + bw, y + 18, i === 0 ? '#fde3ec' : '#f4f5f7');
      P.text(k, x + 3, y + 6, 9.5, { color: '#666' });
      P.text(v, x + 3, y + 14, i === 0 ? 14 : 13, { bold: true, color: i === 0 ? '#c2185b' : '#111', max: bw - 5 });
    });
    y += 27;

    // วาดกราฟลง PDF: กว้างเต็มหน้า หน่วย css px → พิกเซลจริง
    const chart = (kind, data) => {
      const u = 0.75 * K.PT, wmm = R - L, cssW = wmm * K.MM / u;
      const cssH = kind === 'pie' ? pieHeight(cssW, data.length || 1) : 230;
      const hmm = cssH * u / K.MM;
      ensure(hmm + 4);
      pg.ctx.save(); pg.ctx.translate(L * K.MM, y * K.MM);
      (kind === 'pie' ? drawPie : drawBars)(pg.ctx, cssW, cssH, data, u);
      pg.ctx.restore();
      y += hmm + 6;
    };
    heading('ยอดขายรายวัน (บาท)');
    chart('bar', dayData(g, opt.from, opt.to));
    heading('สัดส่วนสินค้าที่ขายได้ (รวมในแพ็กเกจ)');
    chart('pie', pieData(g.items));

    heading('สรุปรายวัน');
    table(
      [{ label: 'วันที่', w: 50 }, { label: 'บิล', w: 18, align: 'right' }, { label: 'เงินสด', w: 28, align: 'right' }, { label: 'โอน', w: 28, align: 'right' }, { label: 'ส่วนลด', w: 26, align: 'right' }, { label: 'ยอดสุทธิ', w: 30, align: 'right' }],
      g.days.map(d => [K.thaiDate(d.date), d.bills, money(d.cash), money(d.transfer), money(d.discount), money(d.net)]),
      { total: ['รวม', g.bills, money(g.cash), money(g.transfer), money(g.discount), money(g.net)] }
    );

    heading('แพ็กเกจที่ขายได้ (ทั้งช่วง)');
    table([{ label: 'แพ็กเกจ', w: 140 }, { label: 'จำนวนเซต', w: 40, align: 'right' }], sorted(g.packages).map(([k, v]) => [k, v]));

    heading('สินค้าที่ขายได้ รวมที่อยู่ในแพ็กเกจ (ทั้งช่วง)');
    table([{ label: 'สินค้า', w: 140 }, { label: 'จำนวน', w: 40, align: 'right' }], sorted(g.items).map(([k, v]) => [k, v]));

    if (opt.stock && opt.stock.length) {
      heading('สินค้าคงเหลือ (ณ เวลาที่พิมพ์)');
      table([{ label: 'สินค้า', w: 100 }, { label: 'ขายในช่วงนี้', w: 30, align: 'right' }, { label: 'คงเหลือ', w: 25, align: 'right' }, { label: 'สถานะ', w: 25 }],
        opt.stock.map(r => [r.name, r.sold, r.stock, r.state]));
    }

    if (g.days.length > 1 || opt.detailEvenIfOneDay) {
      g.days.forEach(d => {
        heading(`${K.thaiDate(d.date)} · ${d.bills} บิล · สุทธิ ${money(d.net)} ฿ (เงินสด ${money(d.cash)} · โอน ${money(d.transfer)})`);
        const rows = sorted(d.packages).map(([k, v]) => ['🎁 ' + k, v + ' เซต']).concat(sorted(d.items).map(([k, v]) => [k, String(v)]));
        table([{ label: 'รายการ', w: 140 }, { label: 'จำนวน', w: 40, align: 'right' }], rows.map(r => [r[0].replace('🎁 ', 'แพ็กเกจ: '), r[1]]));
      });
    }

    pages.forEach((p, i) => {
      p.P.text(`พิมพ์โดย ${opt.by || ''} · ${opt.printedAt || ''} · หน้า ${i + 1}/${pages.length}`, 105, 290, 8.5, { align: 'center', color: '#999' });
    });
    return K.buildPdf(pages.map(p => p.canvas));
  }

  window.SalesReport = { aggregate, pdf, money, normMethod, MLABEL, pieData, dayData, chartCanvas };
})();
