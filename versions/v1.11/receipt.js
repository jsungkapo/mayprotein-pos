/* MayProtein POS — วาดใบเสร็จ (กว้างแบบกระดาษ 80 มม.) เป็นรูป เพื่อแชร์/บันทึก/พิมพ์
 * Receipt.render(bill, settings) → canvas · Receipt.blob(canvas) → PNG
 * ข้อมูลร้านมาจากหน้า ตั้งค่า → ใบเสร็จ (receipt_*) */
(function () {
  const S = 2;                 // ความคมชัด (2 เท่า)
  const W = 400;               // ความกว้าง (หน่วย css px) ≈ กระดาษ 80 มม.
  const PAD = 22;
  const FONT = '"Sarabun","Thonburi","Leelawadee UI","Tahoma","Loma",sans-serif';
  const MLABEL = { cash: 'เงินสด', transfer: 'โอนเงิน', promptpay: 'โอนเงิน (QR)' };
  const money = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function thaiStamp(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    return m ? `${+m[3]}/${+m[2]}/${+m[1] + 543} ${m[4]}:${m[5]} น.` : String(s || '');
  }

  /** แบ่งคำภาษาไทยด้วย Intl.Segmenter (ถ้ามี) เพื่อตัดบรรทัดไม่ให้ขาดกลางคำ */
  function tokens(s) {
    if (window.Intl && Intl.Segmenter) return Array.from(new Intl.Segmenter('th', { granularity: 'word' }).segment(s), x => x.segment);
    return s.split(/(\s+)/);
  }
  function wrap(ctx, text, maxW) {
    const out = [];
    String(text || '').split(/\n/).forEach(para => {
      let line = '';
      tokens(para).forEach(t => {
        if (ctx.measureText(line + t).width <= maxW) { line += t; return; }
        if (line.trim()) out.push(line.trim());
        line = '';
        // คำยาวกว่าบรรทัด → ตัดทีละตัวอักษร
        for (const ch of t) { if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ''; } line += ch; }
      });
      out.push(line.trim());
    });
    return out;
  }

  function loadImg(src) {
    return new Promise(res => {
      if (!src) return res(null);
      const im = new Image();
      im.onload = () => res(im); im.onerror = () => res(null);
      im.src = src;
    });
  }
  async function imgData(url) {
    if (!url) return '';
    if (url.startsWith('data:')) return url;
    try { return await POS.imageData(url); } catch (e) { return ''; }
  }

  /** รายการที่จะวาด (คำนวณความสูงก่อน แล้ววาดจริง) */
  function layout(ctx, b, st, imgs) {
    const ops = [];
    let y = PAD;
    const inner = W - PAD * 2;
    const font = (size, bold) => `${bold ? 700 : 400} ${size}px ${FONT}`;
    const text = (s, size, opt) => {
      opt = opt || {};
      ctx.font = font(size, opt.bold);
      const lines = opt.nowrap ? [String(s)] : wrap(ctx, s, opt.w || inner);
      lines.forEach(l => { y += size * 1.35; ops.push({ t: 'text', s: l, x: opt.align === 'center' ? W / 2 : opt.align === 'right' ? W - PAD : (opt.x || PAD), y, size, bold: opt.bold, align: opt.align || 'left', color: opt.color }); });
    };
    const pair = (l, r, size, opt) => {
      opt = opt || {};
      ctx.font = font(size, opt.bold);
      const rw = ctx.measureText(r).width;
      const lines = wrap(ctx, l, inner - rw - 12 - (opt.indent || 0));
      lines.forEach((ln, i) => {
        y += size * 1.35;
        ops.push({ t: 'text', s: ln, x: PAD + (opt.indent || 0), y, size, bold: opt.bold, color: opt.color });
        if (i === 0 && r) ops.push({ t: 'text', s: r, x: W - PAD, y, size, bold: opt.bold, align: 'right', color: opt.color });
      });
    };
    const gap = h => { y += h; };
    const dash = () => { y += 10; ops.push({ t: 'dash', y }); y += 4; };

    // หัวใบเสร็จ
    if (imgs.logo) {
      const h = 64, w = Math.min(inner, imgs.logo.width * h / imgs.logo.height);
      ops.push({ t: 'img', im: imgs.logo, x: (W - w) / 2, y, w, h }); y += h + 4;
    }
    text(st.receipt_name || st.shop_name || 'MayProtein', 20, { bold: true, align: 'center' });
    if (st.receipt_address) text(st.receipt_address, 13, { align: 'center', color: '#444' });
    if (st.receipt_phone) text('โทร ' + st.receipt_phone, 13, { align: 'center', color: '#444' });
    if (st.receipt_tax_id) text('เลขประจำตัวผู้เสียภาษี ' + st.receipt_tax_id, 13, { align: 'center', color: '#444' });
    gap(8);
    text(st.receipt_title || 'ใบเสร็จรับเงิน', 17, { bold: true, align: 'center' });
    gap(4);
    pair('เลขที่ ' + b.bill_id, thaiStamp(b.datetime), 13);
    if (b.event_name) pair('งาน ' + b.event_name, '', 13, { color: '#444' });
    pair('พนักงาน ' + (b.staff || ''), '', 13, { color: '#444' });
    dash();

    // รายการสินค้า
    const heads = (b.items || []).filter(i => !i.slot);
    heads.forEach(it => {
      pair(it.item_name, money(it.line_total), 15);
      const unit = it.qty ? it.line_total / it.qty : 0;
      text(`${it.qty} × ${money(unit)}`, 12, { color: '#666', x: PAD + 10 });
      if (it.package_id) {
        const comps = b.items.filter(x => x.slot && x.package_set_no === it.package_set_no);
        const agg = {};
        comps.forEach(c => { const n = String(c.item_name).replace(/^May Protein /, ''); agg[n] = (agg[n] || 0) + c.qty / (it.qty || 1); });
        const s = Object.keys(agg).map(n => n + ' ×' + agg[n]).join(', ');
        if (s) text('• ' + s, 12, { color: '#666', x: PAD + 10, w: inner - 10 });
      }
      gap(3);
    });
    dash();
    const pcs = heads.reduce((a, i) => a + Number(i.qty || 0), 0);
    pair(`รวม (${pcs} ชิ้น)`, money(b.subtotal), 14);
    if (Number(b.discount_amount)) pair('ส่วนลด' + (b.discount_type === 'percent' ? ' ' + b.discount_value + '%' : ''), '-' + money(b.discount_amount), 14);
    gap(2);
    pair('ยอดสุทธิ', money(b.total) + ' บาท', 20, { bold: true });
    pair('ชำระโดย', MLABEL[b.payment_method] || String(b.payment_method || ''), 14, { color: '#444' });
    if (b.note) text('หมายเหตุ: ' + b.note, 13, { color: '#444' });
    if (b.status === 'cancelled') { gap(6); text('*** บิลนี้ถูกยกเลิกแล้ว ***', 16, { bold: true, align: 'center', color: '#d93636' }); if (b.cancel_reason) text('สาเหตุ: ' + b.cancel_reason, 12, { align: 'center', color: '#d93636' }); }

    // ท้ายใบเสร็จ
    if (st.receipt_footer || imgs.qr) dash();
    if (st.receipt_footer) { gap(4); text(st.receipt_footer, 14, { align: 'center' }); }
    if (imgs.qr) {
      gap(10);
      const s = 150;
      ops.push({ t: 'img', im: imgs.qr, x: (W - s) / 2, y, w: s, h: s * imgs.qr.height / imgs.qr.width });
      y += s * imgs.qr.height / imgs.qr.width;
      if (st.receipt_qr_label) text(st.receipt_qr_label, 13, { align: 'center', color: '#444' });
    }
    gap(PAD);
    return { ops, h: Math.ceil(y), cancelled: b.status === 'cancelled' };
  }

  async function render(bill, settings) {
    const st = settings || {};
    try { if (document.fonts) await Promise.race([Promise.all([document.fonts.load(`700 20px Sarabun`), document.fonts.load(`400 14px Sarabun`)]), new Promise(r => setTimeout(r, 2500))]); } catch (e) {}
    const qrUrl = st.receipt_qr === 'payment' ? st.promptpay_qr_image_url : st.receipt_qr === 'custom' ? st.receipt_qr_url : '';
    const [logo, qr] = await Promise.all([
      st.receipt_logo === 'off' ? null : imgData(st.logo_url).then(loadImg),
      imgData(qrUrl).then(loadImg)
    ]);
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const L = layout(ctx, bill, st, { logo, qr });
    c.width = W * S; c.height = L.h * S;
    ctx.scale(S, S);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, L.h);
    ctx.textBaseline = 'alphabetic';
    L.ops.forEach(o => {
      if (o.t === 'text') {
        ctx.font = `${o.bold ? 700 : 400} ${o.size}px ${FONT}`;
        ctx.fillStyle = o.color || '#111'; ctx.textAlign = o.align || 'left';
        ctx.fillText(o.s, o.x, o.y - o.size * 0.28);
      } else if (o.t === 'dash') {
        ctx.strokeStyle = '#999'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(PAD, o.y); ctx.lineTo(W - PAD, o.y); ctx.stroke(); ctx.setLineDash([]);
      } else if (o.t === 'img') {
        ctx.drawImage(o.im, o.x, o.y, o.w, o.h);
      }
    });
    if (L.cancelled) {
      ctx.save(); ctx.translate(W / 2, L.h / 2); ctx.rotate(-0.4);
      ctx.font = `700 64px ${FONT}`; ctx.fillStyle = 'rgba(217,54,54,.18)'; ctx.textAlign = 'center'; ctx.fillText('ยกเลิก', 0, 20);
      ctx.restore();
    }
    return c;
  }

  function blob(canvas) { return new Promise(r => canvas.toBlob(r, 'image/png')); }

  /** ตัวอย่างบิลสำหรับหน้าตั้งค่า */
  const SAMPLE = {
    bill_id: 'B0123', datetime: '2026-11-25 14:30', event_name: 'ตัวอย่างงาน', staff: 'พนักงาน', payment_method: 'transfer',
    subtotal: 1240, discount_type: 'baht', discount_value: 40, discount_amount: 40, total: 1200, note: '',
    items: [
      { item_name: 'May Protein รสช็อกโกแลต', qty: 2, line_total: 380 },
      { item_name: 'เซต 7 ซอง', qty: 1, line_total: 860, package_id: 'PK1', package_set_no: 1 },
      { item_name: 'May Protein พีช', qty: 1, slot: 'ติดเซต', package_set_no: 1 },
      { item_name: 'May Protein ช็อกโกแลต', qty: 3, slot: 'เลือก', package_set_no: 1 },
      { item_name: 'May Protein ชาไทย', qty: 3, slot: 'เลือก', package_set_no: 1 }
    ]
  };

  window.Receipt = { render, blob, SAMPLE, money };
})();
