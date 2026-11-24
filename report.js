/* MayProtein POS — รายงานสรุปยอดขายตามช่วงวันที่ (แยกรายวัน) + สร้าง PDF A4 ด้วย PdfKit จาก requisition.js */
(function () {
  const MLABEL = { cash: 'เงินสด', transfer: 'โอน' };
  const money = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const normMethod = m => (m === 'promptpay' ? 'transfer' : m);

  /** รวมยอดจากบิล: ทั้งช่วง + แยกวัน */
  function aggregate(bills) {
    const blank = () => ({ bills: 0, cash: 0, transfer: 0, discount: 0, subtotal: 0, net: 0, items: {}, packages: {} });
    const all = blank(), days = {};
    bills.forEach(b => {
      const d = String(b.datetime).slice(0, 10);
      const day = days[d] || (days[d] = Object.assign(blank(), { date: d }));
      const m = normMethod(b.payment_method);
      [all, day].forEach(g => {
        g.bills++; g.net += b.total; g.discount += b.discount_amount; g.subtotal += b.subtotal;
        if (m === 'cash') g.cash += b.total; else g.transfer += b.total;
        b.items.forEach(i => {
          if (i.package_id && !i.slot) { g.packages[i.item_name] = (g.packages[i.item_name] || 0) + i.qty; return; }
          g.items[i.item_name] = (g.items[i.item_name] || 0) + i.qty;
        });
      });
    });
    all.days = Object.keys(days).sort().map(k => days[k]);
    return all;
  }

  const sorted = o => Object.entries(o).sort((a, b) => b[1] - a[1]);

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
      P.text('ช่วงวันที่ ' + period, 105, 37, 12, { align: 'center' });
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

  window.SalesReport = { aggregate, pdf, money, normMethod, MLABEL };
})();
