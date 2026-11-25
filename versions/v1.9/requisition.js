/* MayProtein POS — วาดใบเบิกพัสดุขนาด A4 แล้วสร้างไฟล์ PDF ในเบราว์เซอร์ (ไม่ใช้ไลบรารีภายนอก)
 * ตัวหนังสือไทยวาดด้วยเบราว์เซอร์เอง สระ/วรรณยุกต์จึงถูกต้องทุกเครื่อง แต่ละหน้าเก็บเป็นรูปความละเอียด 200 dpi */
(function () {
  const DPI = 200;
  const W = Math.round(210 / 25.4 * DPI);   // 1654 px
  const H = Math.round(297 / 25.4 * DPI);   // 2339 px
  const MM = W / 210;
  const PT = DPI / 72;
  const FONT = '"Sarabun","Thonburi","Leelawadee UI","Tahoma","Loma",sans-serif';
  const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const ROWS_LAST = 12;   // แถวในหน้าที่มีช่องลงชื่อ
  const ROWS_FULL = 21;   // แถวในหน้าที่ไม่มีช่องลงชื่อ

  function thaiDate(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return { d: '', m: '', y: '' };
    return { d: String(+m[3]), m: MONTHS[+m[2] - 1], y: String(+m[1] + 543) };
  }
  function shortThai(iso) {
    const t = thaiDate(iso);
    return t.d ? `${t.d} ${t.m} ${t.y}` : '';
  }

  function painter(ctx) {
    const P = {
      font(size, bold) { ctx.font = `${bold ? '700' : '400'} ${size * PT}px ${FONT}`; },
      text(s, xmm, ymm, size, opt) {
        opt = opt || {};
        P.font(size, opt.bold);
        ctx.fillStyle = opt.color || '#111';
        ctx.textAlign = opt.align || 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(String(s == null ? '' : s), xmm * MM, ymm * MM, opt.max ? opt.max * MM : undefined);
      },
      width(s, size, bold) { P.font(size, bold); return ctx.measureText(String(s)).width / MM; },
      line(x1, y1, x2, y2, w) {
        ctx.strokeStyle = '#222'; ctx.lineWidth = (w || 0.3) * MM; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(x1 * MM, y1 * MM); ctx.lineTo(x2 * MM, y2 * MM); ctx.stroke();
      },
      dots(x1, x2, y) {
        ctx.strokeStyle = '#555'; ctx.lineWidth = 0.25 * MM; ctx.setLineDash([0.4 * MM, 0.9 * MM]);
        ctx.beginPath(); ctx.moveTo(x1 * MM, y * MM); ctx.lineTo(x2 * MM, y * MM); ctx.stroke(); ctx.setLineDash([]);
      },
      /** ข้อความบนเส้นประ (เหมือนเขียนบนบรรทัด) */
      field(x1, x2, y, value, size, opt) {
        P.dots(x1, x2, y + 0.8);
        if (value) P.text(value, (x1 + x2) / 2, y - 0.4, size || 13, Object.assign({ align: 'center', color: '#0b3d91', max: x2 - x1 - 1 }, opt));
      },
      /** ตัดคำให้พอดีความกว้าง (ภาษาไทยไม่มีเว้นวรรค จึงตัดทีละตัวอักษรเมื่อจำเป็น) */
      fit(s, w, size) {
        s = String(s || '');
        if (P.width(s, size) <= w) return s;
        while (s.length && P.width(s + '…', size) > w) s = s.slice(0, -1);
        return s + '…';
      }
    };
    return P;
  }

  function qtyText(q, unit) {
    if (q === '' || q == null) return '';
    return q + (unit ? ' ' + unit : '');
  }

  function drawPage(req, rows, startNo, pageNo, pageCount, isLast) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const P = painter(ctx);
    const L = 20, R = 190;
    const td = thaiDate(req.doc_date);

    // หัวกระดาษ
    P.text('เลขที่ ' + req.req_id, L, 16, 11, { color: '#555' });
    if (pageCount > 1) P.text(`หน้า ${pageNo}/${pageCount}`, R, 16, 11, { align: 'right', color: '#555' });
    P.text('ใบเบิกพัสดุ และอุปกรณ์', 105, 27, 20, { align: 'center', bold: true });

    // แผนก / วันที่ (ชิดขวา)
    P.text('แผนก', 120, 38, 13);
    P.field(132, R, 38, req.department);
    P.text('วันที่', 96, 46, 13);
    P.field(106, 116, 46, td.d);
    P.text('เดือน', 118, 46, 13);
    P.field(129, 160, 46, td.m);
    P.text('พ.ศ.', 162, 46, 13);
    P.field(171, R, 46, td.y);

    // ข้อความขอเบิก
    P.text('แผนก', L, 60, 13);
    P.field(32, 92, 60, req.department);
    P.text('มีความประสงค์จะขอเบิกพัสดุต่างๆ ตามแผน/นอกแผน', 94, 60, 13);
    P.text('เพื่อในกิจกรรม', L, 69, 13);
    P.field(48, 156, 69, req.activity);
    P.text('ดังรายการต่อไปนี้', R, 69, 13, { align: 'right' });

    // ตาราง
    const cols = [L, 33, 105, 127, 149, R];
    const top = 74, headH = 15, rowH = 8.6;
    const nRows = isLast ? Math.max(rows.length, ROWS_LAST) : ROWS_FULL;
    const bottom = top + headH + nRows * rowH;
    P.line(L, top, R, top, 0.45); P.line(L, bottom, R, bottom, 0.45);
    P.line(L, top + headH, R, top + headH, 0.35);
    cols.forEach((x, i) => P.line(x, top, x, bottom, i === 0 || i === cols.length - 1 ? 0.45 : 0.3));
    for (let i = 1; i < nRows; i++) P.line(L, top + headH + i * rowH, R, top + headH + i * rowH, 0.2);
    P.text('ลำดับ', (cols[0] + cols[1]) / 2, top + 9.5, 12, { align: 'center', bold: true });
    P.text('รายการ', (cols[1] + cols[2]) / 2, top + 9.5, 12, { align: 'center', bold: true });
    P.text('จำนวน', (cols[2] + cols[3]) / 2, top + 6.5, 12, { align: 'center', bold: true });
    P.text('ขอเบิก', (cols[2] + cols[3]) / 2, top + 12.5, 12, { align: 'center', bold: true });
    P.text('จำนวน', (cols[3] + cols[4]) / 2, top + 6.5, 12, { align: 'center', bold: true });
    P.text('ที่ได้รับ', (cols[3] + cols[4]) / 2, top + 12.5, 12, { align: 'center', bold: true });
    P.text('หมายเหตุ', (cols[4] + cols[5]) / 2, top + 9.5, 12, { align: 'center', bold: true });
    rows.forEach((it, i) => {
      const y = top + headH + i * rowH + 6.1;
      P.text(String(startNo + i), (cols[0] + cols[1]) / 2, y, 12, { align: 'center' });
      P.text(P.fit(it.name, cols[2] - cols[1] - 3, 12), cols[1] + 2, y, 12, { color: '#0b3d91' });
      P.text(qtyText(it.qty_req, it.unit), (cols[2] + cols[3]) / 2, y, 12, { align: 'center', color: '#0b3d91', max: cols[3] - cols[2] - 2 });
      P.text(qtyText(it.qty_recv, it.unit), (cols[3] + cols[4]) / 2, y, 12, { align: 'center', color: '#0b3d91', max: cols[4] - cols[3] - 2 });
      P.text(P.fit(it.note, cols[5] - cols[4] - 3, 10.5), cols[4] + 1.5, y, 10.5, { color: '#0b3d91' });
    });

    if (isLast) {
      let y0 = bottom + 13;
      if (req.note) { P.text('หมายเหตุ: ' + P.fit(req.note, 165, 11), L, bottom + 7, 11, { color: '#444' }); y0 += 3; }
      const block = (cx, y, title, name, date, suffix) => {
        P.text(title, cx, y, 13, { align: 'center', bold: true });
        P.dots(cx - 35, suffix ? cx + 18 : cx + 35, y + 14);
        if (suffix) P.text(suffix, cx + 19, y + 13.5, 13);
        P.text('(', cx - 37, y + 22, 13);
        P.field(cx - 34, cx + 34, y + 22, name);
        P.text(')', cx + 35, y + 22, 13);
        P.text('วันที่', cx - 37, y + 30, 13);
        P.field(cx - 26, cx + 35, y + 30, date);
      };
      block(62, y0, 'ผู้ขอเบิก', req.requester, shortThai(req.doc_date));
      block(148, y0, 'อนุมัติให้จ่ายได้', '', '');
      block(62, y0 + 41, 'ได้จ่ายของตามใบเบิกแล้ว', '', '');
      block(148, y0 + 41, 'ได้รับของตามใบเบิกแล้ว', '', '', 'ผู้รับของ');
    }
    P.text(`MayProtein POS · ${req.req_id} · สร้างโดย ${req.created_by || ''} ${req.created_at ? '· ' + req.created_at.slice(0, 16) : ''}`, 105, 290, 8.5, { align: 'center', color: '#999' });
    return c;
  }

  /** วาดทุกหน้า คืน array ของ canvas */
  async function renderPages(req) {
    try { if (document.fonts) await Promise.race([document.fonts.load(`700 ${20 * PT}px Sarabun`).then(() => document.fonts.load(`400 ${13 * PT}px Sarabun`)), new Promise(r => setTimeout(r, 2500))]); } catch (e) {}
    const items = req.items || [];
    const pages = [];
    let i = 0;
    // ทุกหน้าที่ไม่ใช่หน้าสุดท้ายใส่ได้ ROWS_FULL แถว หน้าสุดท้าย (มีช่องลงชื่อ) ใส่ได้ ROWS_LAST แถว
    while (items.length - i > ROWS_LAST) { pages.push(items.slice(i, i + ROWS_FULL)); i += ROWS_FULL; }
    pages.push(items.slice(i));
    return pages.map((rows, p) => drawPage(req, rows, p === 0 ? 1 : 1 + p * ROWS_FULL, p + 1, pages.length, p === pages.length - 1));
  }

  function canvasJpeg(c) {
    const b64 = c.toDataURL('image/jpeg', 0.9).split(',')[1];
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** PDF แบบเรียบง่าย: 1 รูป JPEG ต่อ 1 หน้า A4 */
  function buildPdf(canvases) {
    const enc = new TextEncoder();
    const parts = []; let len = 0; const offs = [];
    const push = b => { if (typeof b === 'string') b = enc.encode(b); parts.push(b); len += b.length; };
    const PW = 595.28, PH = 841.89;
    const n = canvases.length;
    const total = 2 + n * 3;
    push('%PDF-1.4\n');
    offs[1] = len; push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    const kids = canvases.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    offs[2] = len; push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${n} >>\nendobj\n`);
    canvases.forEach((c, i) => {
      const pg = 3 + i * 3, ct = pg + 1, im = pg + 2;
      offs[pg] = len; push(`${pg} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im${i} ${im} 0 R >> >> /Contents ${ct} 0 R >>\nendobj\n`);
      const stream = `q ${PW} 0 0 ${PH} 0 0 cm /Im${i} Do Q`;
      offs[ct] = len; push(`${ct} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
      const jpg = canvasJpeg(c);
      offs[im] = len; push(`${im} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
      push(jpg); push('\nendstream\nendobj\n');
    });
    const xref = len;
    let x = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    push(x + `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  // ใช้ร่วมกับรายงานยอดขาย (report.js)
  window.PdfKit = {
    W, H, MM, PT, FONT, painter, buildPdf, thaiDate: shortThai,
    newPage() { const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); return { canvas: c, P: painter(ctx), ctx }; },
    async fonts() { try { if (document.fonts) await Promise.race([document.fonts.load(`700 ${20 * PT}px Sarabun`).then(() => document.fonts.load(`400 ${13 * PT}px Sarabun`)), new Promise(r => setTimeout(r, 2500))]); } catch (e) {} }
  };

  window.Requisition = {
    renderPages,
    async pdf(req) { return buildPdf(await renderPages(req)); },
    fileName(req) { return `ใบเบิก-${req.req_id}-${(req.activity || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 40)}.pdf`; },
    thaiDate: shortThai
  };
})();
