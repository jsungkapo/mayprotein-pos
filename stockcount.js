/* MayProtein POS — ใบสรุปการนับสต็อก (A4) ใช้ PdfKit จาก requisition.js
 * rec = { count_id, datetime, note, staff, checked, matched, short_items, short_qty, over_items, over_qty, not_counted,
 *         items: [{ id, name, sku, unit, cat, cost, system, counted, diff }] } */
(function () {
  const num = n => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  const signed = n => (n > 0 ? '+' : '') + num(n);
  // นับแบบหน่วยใหญ่: "May Protein กล้วย (20 กล่อง + 10 ซอง)"
  const withPack = l => l.pack_size > 1 && l.packs != null ? `${l.name} (${num(l.packs)} ${l.pack_unit} + ${num(l.loose || 0)} ${l.unit || ''})` : l.name;

  async function renderPages(rec, opt) {
    opt = opt || {};
    const K = window.PdfKit;
    await K.fonts();
    const pages = [];
    let pg, P, y;
    const L = 15, R = 195, BOTTOM = 276;
    const fill = (x1, y1, x2, y2, color) => { pg.ctx.fillStyle = color; pg.ctx.fillRect(x1 * K.MM, y1 * K.MM, (x2 - x1) * K.MM, (y2 - y1) * K.MM); };
    const date = String(rec.datetime || '');

    const newPage = () => {
      pg = K.newPage(); P = pg.P; pages.push(pg);
      P.text(opt.shop || 'MayProtein', L, 14, 10, { color: '#888' });
      P.text('ใบสรุปการนับสต็อก', 105, 22, 18, { align: 'center', bold: true });
      P.text(`เลขที่ ${rec.count_id}`, R, 14, 10.5, { align: 'right', bold: true });
      P.text(`วันที่นับ ${K.thaiDate(date.slice(0, 10))} เวลา ${date.slice(11, 16)} น. · ผู้นับ ${rec.staff || '-'}`, 105, 30, 12, { align: 'center' });
      if (rec.note) P.text('หมายเหตุ: ' + P.fit(rec.note, 170, 12), 105, 36.5, 12, { align: 'center', color: '#0b3d91' });
      P.line(L, 40, R, 40, 0.3);
      y = 48;
    };
    const ensure = h => { if (y + h > BOTTOM) newPage(); };
    const heading = t => { ensure(18); y += 2; P.text(t, L, y, 13, { bold: true }); y += 4; };

    const table = (cols, rows, o) => {
      o = o || {};
      const rh = 7;
      const xs = [L]; cols.forEach(c => xs.push(xs[xs.length - 1] + c.w));
      const head = () => {
        fill(L, y, R, y + rh, '#f1f2f5');
        cols.forEach((c, i) => P.text(c.label, c.align === 'right' ? xs[i + 1] - 2 : xs[i] + 2, y + 4.9, 10, { bold: true, align: c.align === 'right' ? 'right' : 'left' }));
        P.line(L, y, R, y, 0.3); P.line(L, y + rh, R, y + rh, 0.3);
        y += rh;
      };
      ensure(rh * 2 + 2); head();
      if (!rows.length) { P.text('— ไม่มี —', L + 2, y + 5, 10.5, { color: '#999' }); y += rh; }
      rows.forEach(r => {
        if (y + rh > BOTTOM) { newPage(); head(); }
        if (r.bg) fill(L, y, R, y + rh, r.bg);
        if (r.span) { P.text(r.span, L + 2, y + 4.9, 10, { bold: true, color: '#444' }); y += rh; P.line(L, y, R, y, 0.12); return; }  // หัวหมวด เต็มแถว
        r.cells.forEach((v, i) => {
          const c = cols[i];
          const s = c.align === 'right' ? String(v) : P.fit(String(v), c.w - 4, 10);
          P.text(s, c.align === 'right' ? xs[i + 1] - 2 : xs[i] + 2, y + 4.9, 10, { bold: !!(r.bold || (c.boldCol && v !== '')), align: c.align === 'right' ? 'right' : 'left', color: c.colorOf ? c.colorOf(r) : '#111' });
        });
        y += rh;
        P.line(L, y, R, y, 0.12);
      });
      y += 6;
    };

    newPage();

    // กล่องตัวเลขสรุป
    const value = rec.items.reduce((t, l) => t + l.diff * (l.cost || 0), 0);
    const kpis = [
      ['นับแล้ว', `${num(rec.checked)} รายการ`, '#f4f5f7', '#111'],
      ['ตรงกับระบบ', `${num(rec.matched)} รายการ`, '#e8f6ec', '#137333'],
      ['ขาด', `${num(rec.short_items)} รายการ (${num(rec.short_qty)})`, '#fdecea', '#c5221f'],
      ['เกิน', `${num(rec.over_items)} รายการ (${signed(rec.over_qty)})`, '#fff4e0', '#b06000']
    ];
    const bw = (R - L - 3 * 3) / 4;
    kpis.forEach(([k, v, bg, col], i) => {
      const x = L + i * (bw + 3);
      fill(x, y, x + bw, y + 17, bg);
      P.text(k, x + 3, y + 6, 9.5, { color: '#555' });
      P.text(v, x + 3, y + 13.5, 12, { bold: true, color: col, max: bw - 5 });
    });
    y += 22;
    const extra = [];
    if (rec.not_counted) extra.push(`ยังไม่ได้นับ ${num(rec.not_counted)} รายการ (สต็อกในระบบไม่เปลี่ยน)`);
    if (value) extra.push(`มูลค่าส่วนต่างตามราคาทุน ${value > 0 ? '+' : '-'}${num(Math.abs(value))} บาท`);
    if (extra.length) { P.text(extra.join(' · '), L, y, 10.5, { color: '#555' }); y += 7; }
    y += 2;

    const diffs = rec.items.filter(l => l.diff).sort((a, b) => a.diff - b.diff);
    heading(`รายการที่ไม่ตรง (ปรับสต็อกตามที่นับได้แล้ว) · ${diffs.length} รายการ`);
    const dcol = r => r.diff < 0 ? '#c5221f' : r.diff > 0 ? '#b06000' : '#111';
    table(
      [{ label: 'สินค้า', w: 74 }, { label: 'SKU', w: 24 }, { label: 'ในระบบ', w: 18, align: 'right' }, { label: 'นับได้', w: 18, align: 'right' },
       { label: 'ส่วนต่าง', w: 21, align: 'right', colorOf: r => dcol(r.l) }, { label: 'มูลค่าทุน', w: 25, align: 'right', colorOf: r => dcol(r.l) }],
      diffs.map(l => ({ l, cells: [withPack(l), l.sku || '-', num(l.system), num(l.counted), signed(l.diff), l.cost ? signed(l.diff * l.cost) : '-'] }))
    );

    heading(`รายการที่นับทั้งหมด · ${rec.items.length} รายการ`);
    const all = rec.items.slice().sort((a, b) => (a.cat || '').localeCompare(b.cat || '', 'th') || a.name.localeCompare(b.name, 'th'));
    const rows = [];
    let lastCat = null, no = 0;
    all.forEach(l => {
      if (l.cat !== lastCat) { rows.push({ span: l.cat, bg: '#f7f7f9' }); lastCat = l.cat; }
      rows.push({ l, cells: [String(++no), withPack(l), num(l.system), num(l.counted), l.diff ? signed(l.diff) : '✓', l.unit || ''] });
    });
    table(
      [{ label: 'ลำดับ', w: 14 }, { label: 'สินค้า', w: 96 }, { label: 'ในระบบ', w: 18, align: 'right' }, { label: 'นับได้', w: 18, align: 'right' },
       { label: 'ผล', w: 16, align: 'right', colorOf: r => r.l ? (r.l.diff ? dcol(r.l) : '#137333') : '#111' }, { label: 'หน่วย', w: 18 }],
      rows
    );

    // ช่องลงชื่อ
    ensure(34);
    y += 8;
    [[L + 10, 'ผู้นับ', rec.staff || ''], [R - 75, 'ผู้ตรวจสอบ', '']].forEach(([x, label, name]) => {
      P.text('ลงชื่อ ..........................................................', x, y + 8, 11);
      P.text(`( ${name || '..........................................................'} )`, x + 32, y + 16, 11, { align: 'center' });
      P.text(label, x + 32, y + 23, 11, { align: 'center', color: '#555' });
    });

    pages.forEach((p, i) => p.P.text(`MayProtein POS · ${rec.count_id} · พิมพ์ ${opt.printedAt || ''} · หน้า ${i + 1}/${pages.length}`, 105, 290, 8.5, { align: 'center', color: '#999' }));
    return pages.map(p => p.canvas);
  }

  window.StockCountDoc = {
    renderPages,
    async pdf(rec, opt) { return window.PdfKit.buildPdf(await renderPages(rec, opt)); },
    fileName: rec => `นับสต็อก-${rec.count_id}-${String(rec.datetime || '').slice(0, 10)}.pdf`
  };
})();
