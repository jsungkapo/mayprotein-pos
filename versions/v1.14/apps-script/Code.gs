/**
 * MayProtein POS — Google Apps Script backend
 *
 * วิธีติดตั้ง: ดู SETUP.md ใน repo
 * วางไฟล์นี้ใน Apps Script ที่ผูกกับ Google Sheets ฐานข้อมูล (ส่วนขยาย → Apps Script)
 * แล้ว Deploy เป็น Web app (Execute as: Me, Who has access: Anyone)
 */

const SERVER_VERSION = '1.14'; // ตั้งโดย tools/release.py
const SESSION_DAYS = 30;
const MAX_LOGIN_FAILS = 5;
const LOCK_MINUTES = 5;
const IMAGE_FOLDER = 'MayProtein POS Images';
const SLIP_FOLDER = 'MayProtein POS Slips'; // รูปสลิปเก็บแบบส่วนตัว (ไม่แชร์ลิงก์)

const SCHEMA = {
  Products: ['product_id', 'sku', 'name', 'category', 'subcategory', 'unit', 'price', 'cost', 'has_variants', 'stock_qty', 'description', 'image_url', 'active'],
  Variants: ['variant_id', 'product_id', 'sku', 'size', 'color', 'price', 'cost', 'stock_qty', 'image_url', 'active'],
  Packages: ['package_id', 'name', 'price', 'description', 'image_url', 'active', 'total_qty'],
  PackageSlots: ['package_id', 'slot', 'qty', 'allowed_items', 'lines', 'kind'],
  StockIn: ['stockin_id', 'datetime', 'event_name', 'item_id', 'qty', 'note', 'staff'],
  Sales: ['bill_id', 'datetime', 'event_name', 'subtotal', 'discount_type', 'discount_value', 'discount_amount', 'total', 'payment_method', 'note', 'staff', 'client_id', 'slip_url', 'status', 'cancelled_at', 'cancelled_by', 'cancel_reason'],
  SaleItems: ['bill_id', 'line_no', 'item_id', 'item_name', 'qty', 'unit_price', 'line_total', 'package_id', 'package_set_no', 'slot'],
  Settings: ['key', 'value'],
  Users: ['user_id', 'username', 'display_name', 'pin_hash', 'salt', 'role', 'status', 'created_at'],
  Sessions: ['token', 'user_id', 'expires_at'],
  Logs: ['datetime', 'user', 'action', 'target_type', 'target_id', 'target_name', 'details'],
  Requisitions: ['req_id', 'created_at', 'doc_date', 'department', 'activity', 'requester', 'items_json', 'note', 'created_by']
};

const DEFAULT_SETTINGS = {
  shop_name: 'MayProtein',
  current_event: '',
  promptpay_qr_image_url: '',
  logo_url: '',
  categories: 'อาหารเสริม,เสื้อผ้า,อุปกรณ์',
  subcategories: 'โปรตีน,พรีเวิร์กเอาต์,More',
  units: 'ซอง,ชิ้น',
  department: 'Protein',
  receipt_name: '',
  receipt_address: '',
  receipt_phone: '',
  receipt_tax_id: '',
  receipt_footer: 'ขอบคุณที่อุดหนุนค่ะ',
  receipt_logo: 'on',
  receipt_qr: 'none',
  receipt_qr_url: '',
  receipt_qr_label: ''
};

/* ---------------- HTTP ---------------- */

function doGet() {
  return json_({ ok: true, app: 'MayProtein POS API', version: SERVER_VERSION });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  try {
    const res = route_(req);
    return json_(Object.assign({ ok: true }, res || {}));
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

const PUBLIC_ACTIONS = { register: register_, login: login_ };
const USER_ACTIONS = { me: me_, logout: logout_, getCatalog: getCatalog_, createSale: createSale_, getImage: getImage_, todaySales: todaySales_, cancelBill: cancelBill_ };
const ADMIN_ACTIONS = {
  getAdminData: getAdminData_, updateUser: updateUser_,
  saveProduct: saveProduct_, saveVariant: saveVariant_, savePackage: savePackage_,
  deleteProduct: deleteProduct_, deleteVariant: deleteVariant_, deletePackage: deletePackage_,
  uploadImage: uploadImage_, stockCount: stockCount_, getLogs: getLogs_,
  createRequisition: createRequisition_, listRequisitions: listRequisitions_, getSlip: getSlip_,
  setProductsActive: setProductsActive_
};
// เฉพาะ master (สิทธิ์สูงสุด): ตั้งค่าระบบ + ปรับสต็อกรายการเดียว
const MASTER_ACTIONS = { saveSettings: saveSettings_, addStock: addStock_ };

/** สิทธิ์: master > admin > seller */
function isAdmin_(u) { return !!u && (u.role === 'admin' || u.role === 'master'); }
function isMaster_(u) { return !!u && u.role === 'master'; }
const ROLE_LABEL = { master: 'มาสเตอร์', admin: 'แอดมิน', seller: 'พนักงานขาย' };

/** ระบบเดิมยังไม่มี master → ตั้งแอดมินคนแรก (แถวบนสุดในชีต Users) เป็น master อัตโนมัติ ครั้งเดียว */
function ensureMaster_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('master_ok_v1')) return;
  withLock_(function () {
    const users = readTable_('Users');
    if (!users.some(function (u) { return u.role === 'master'; })) {
      const first = users.filter(function (u) { return u.role === 'admin' && u.status === 'active'; })[0];
      if (first) {
        updateRow_('Users', first._row, { role: 'master' });
        cache.remove('usr_' + first.user_id);
        log_(first, 'แก้ไข', 'พนักงาน', first.user_id, first.display_name, 'สิทธิ์: มาสเตอร์ (ตั้งอัตโนมัติ — แอดมินคนแรก)');
      }
    }
    cache.put('master_ok_v1', '1', 21600);
  });
}

function route_(req) {
  ensureSetup_();
  const action = req.action;
  const p = req.payload || {};
  if (PUBLIC_ACTIONS[action]) return PUBLIC_ACTIONS[action](p);
  ensureMaster_();
  const user = auth_(req.token);
  if (USER_ACTIONS[action]) return USER_ACTIONS[action](p, user, req.token);
  if (ADMIN_ACTIONS[action]) {
    if (!isAdmin_(user)) throw new Error('forbidden');
    return ADMIN_ACTIONS[action](p, user);
  }
  if (MASTER_ACTIONS[action]) {
    if (!isMaster_(user)) throw new Error('เฉพาะมาสเตอร์เท่านั้น');
    return MASTER_ACTIONS[action](p, user);
  }
  throw new Error('unknown_action');
}

/* ---------------- Sheet helpers ---------------- */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function tz_() { return ss_().getSpreadsheetTimeZone() || 'Asia/Bangkok'; }
function sh_(name) { return ss_().getSheetByName(name); }
function now_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function key_(h) { return String(h).trim().split(/[\s(]/)[0]; }
function bool_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function num_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function pad_(n, w) { return String(n).padStart(w, '0'); }

function norm_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm:ss');
  return v;
}

function ensureSetup_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('setup_ok_v11')) return;
  const book = ss_();
  Object.keys(SCHEMA).forEach(function (name) {
    let s = book.getSheetByName(name);
    if (!s) {
      s = book.insertSheet(name);
      s.getRange(1, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name]]);
      s.setFrozenRows(1);
    } else {
      const lastCol = Math.max(s.getLastColumn(), 1);
      const have = s.getRange(1, 1, 1, lastCol).getValues()[0].map(key_).filter(String);
      const missing = SCHEMA[name].filter(function (h) { return have.indexOf(h) < 0; });
      if (missing.length) s.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
    }
  });
  ['Users', 'Sessions'].forEach(function (n) {
    const s = sh_(n);
    s.getRange(1, 1, s.getMaxRows(), s.getMaxColumns()).setNumberFormat('@');
  });
  // คอลัมน์ค่าเป็นข้อความ (เบอร์โทร / เลขภาษี ไม่ให้เลข 0 หน้าหาย)
  const st = sh_('Settings');
  st.getRange(1, 2, st.getMaxRows(), 1).setNumberFormat('@');
  // ล็อกไว้ กันหลายเครื่องเพิ่มค่าเริ่มต้นซ้ำพร้อมกัน
  withLock_(function () {
    if (cache.get('setup_ok_v11')) return;
    const have = {};
    readTable_('Settings').forEach(function (r) { if (r.key) have[r.key] = true; });
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
      if (!have[k]) appendRow_('Settings', { key: k, value: DEFAULT_SETTINGS[k] });
    });
    cache.put('setup_ok_v11', '1', 21600);
  });
}

function headers_(name) {
  const s = sh_(name);
  return s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0].map(key_);
}

function readTable_(name) {
  const s = sh_(name);
  const values = s.getDataRange().getValues();
  if (values.length < 2) return [];
  const hs = values[0].map(key_);
  return values.slice(1).map(function (r, i) {
    const o = { _row: i + 2 };
    hs.forEach(function (h, j) { if (h) o[h] = norm_(r[j]); });
    return o;
  }).filter(function (o) {
    return hs.some(function (h) { return h && o[h] !== ''; });
  });
}

function rowFrom_(hs, obj, base) {
  return hs.map(function (h, j) {
    if (h && Object.prototype.hasOwnProperty.call(obj, h)) return obj[h];
    return base ? base[j] : '';
  });
}

function appendRow_(name, obj) {
  sh_(name).appendRow(rowFrom_(headers_(name), obj));
}

function appendRows_(name, objs) {
  if (!objs.length) return;
  const s = sh_(name);
  const hs = headers_(name);
  const rows = objs.map(function (o) { return rowFrom_(hs, o); });
  s.getRange(s.getLastRow() + 1, 1, rows.length, hs.length).setValues(rows);
}

function updateRow_(name, row, obj) {
  const s = sh_(name);
  const hs = headers_(name);
  const range = s.getRange(row, 1, 1, hs.length);
  const base = range.getValues()[0];
  range.setValues([rowFrom_(hs, obj, base)]);
}

function nextId_(rows, field, prefix, width) {
  let max = 0;
  rows.forEach(function (r) {
    const m = String(r[field] || '').match(new RegExp('^' + prefix + '(\\d+)$'));
    if (m) max = Math.max(max, Number(m[1]));
  });
  return prefix + pad_(max + 1, width);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function settingsMap_() {
  const o = {};
  // ถ้ามีคีย์ซ้ำ ใช้แถวแรกที่มีค่า (แถวว่างที่ซ้ำไม่ทับค่าที่กรอกไว้)
  readTable_('Settings').forEach(function (r) { if (r.key && (!(r.key in o) || (o[r.key] === '' && str_(r.value) !== ''))) o[r.key] = str_(r.value); });
  return o;
}

/* ---------------- Activity log ---------------- */

const LABELS = {
  name: 'ชื่อ', sku: 'SKU', category: 'หมวดหมู่', subcategory: 'หมวดย่อย', unit: 'หน่วย', price: 'ราคา', cost: 'ต้นทุน',
  description: 'คำอธิบาย', total_qty: 'จำนวนชิ้นทั้งหมด', size: 'ไซซ์', color: 'สี', shop_name: 'ชื่อร้าน', current_event: 'ชื่องาน',
  categories: 'หมวดหมู่', subcategories: 'หมวดย่อย', units: 'หน่วย', promptpay_qr_image_url: 'รูป QR', logo_url: 'โลโก้', department: 'แผนก',
  receipt_name: 'ชื่อบนใบเสร็จ', receipt_address: 'ที่อยู่', receipt_phone: 'เบอร์โทร', receipt_tax_id: 'เลขประจำตัวผู้เสียภาษี',
  receipt_footer: 'ข้อความท้ายใบเสร็จ', receipt_logo: 'โลโก้บนใบเสร็จ', receipt_qr: 'QR ท้ายใบเสร็จ', receipt_qr_url: 'รูป QR ท้ายใบเสร็จ', receipt_qr_label: 'คำอธิบาย QR'
};

/** สรุปว่าค่าไหนเปลี่ยนจากอะไรเป็นอะไร (oldRow = null แปลว่าสร้างใหม่) */
function diff_(oldRow, obj) {
  const skip = ['product_id', 'variant_id', 'package_id', 'has_variants', 'stock_qty'];
  const out = [];
  Object.keys(obj).forEach(function (k) {
    if (skip.indexOf(k) >= 0) return;
    let a = oldRow ? oldRow[k] : '';
    const b = obj[k];
    if (typeof b === 'boolean') a = oldRow ? bool_(a) : null;
    if (oldRow && String(a === undefined ? '' : a) === String(b)) return;
    if (k === 'image_url' || k === 'promptpay_qr_image_url' || k === 'logo_url') {
      if (!oldRow && !b) return;
      out.push((LABELS[k] || 'รูป') + ': ' + (b ? (a ? 'เปลี่ยนรูป' : 'เพิ่มรูป') : 'ลบรูป'));
      return;
    }
    if (k === 'active') { if (oldRow || !b) out.push(b ? 'เปิดขาย' : 'ปิดขาย'); return; }
    if (!oldRow && (b === '' || b === null)) return;
    out.push((LABELS[k] || k) + ': ' + (oldRow ? (a === '' ? '-' : a) + ' → ' : '') + (b === '' || b === null ? '-' : b));
  });
  return out.join(' · ');
}

function log_(user, action, type, id, name, details) {
  try {
    appendRow_('Logs', {
      datetime: now_(), user: user ? str_(user.display_name) + ' (@' + str_(user.username) + ')' : '',
      action: action, target_type: type, target_id: id || '', target_name: name || '', details: details || ''
    });
  } catch (e) { /* log ไม่ได้ก็ไม่ให้งานหลักล้ม */ }
}

function getLogs_(p) {
  const limit = Math.min(2000, Math.max(1, num_(p.limit) || 500));
  const rows = readTable_('Logs');
  return {
    logs: rows.slice(-limit).reverse().map(function (r) {
      return { datetime: str_(r.datetime), user: str_(r.user), action: str_(r.action), target_type: str_(r.target_type), target_id: str_(r.target_id), target_name: str_(r.target_name), details: str_(r.details) };
    }),
    total: rows.length
  };
}

/* ---------------- Auth ---------------- */

function hash_(pin, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function publicUser_(u) {
  return { user_id: u.user_id, username: u.username, display_name: u.display_name, role: u.role, status: u.status };
}

function register_(p) {
  const username = str_(p.username).toLowerCase();
  const display = str_(p.display_name);
  const pin = str_(p.pin);
  if (!/^[a-z0-9._-]{3,20}$/.test(username)) throw new Error('ชื่อผู้ใช้ต้องเป็นภาษาอังกฤษ ตัวเลข หรือ . _ - ยาว 3–20 ตัว');
  if (!display) throw new Error('กรุณาใส่ชื่อที่แสดง');
  if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN ต้องเป็นตัวเลข 4–6 หลัก');
  return withLock_(function () {
    const users = readTable_('Users');
    if (users.some(function (u) { return str_(u.username).toLowerCase() === username; })) throw new Error('ชื่อผู้ใช้นี้ถูกใช้แล้ว');
    const first = users.length === 0;
    const salt = Utilities.getUuid();
    const user = {
      user_id: nextId_(users, 'user_id', 'U', 3), username: username, display_name: display,
      pin_hash: hash_(pin, salt), salt: salt,
      role: first ? 'master' : 'seller', status: first ? 'active' : 'pending', created_at: now_()
    };
    appendRow_('Users', user);
    log_(user, 'สมัคร', 'พนักงาน', user.user_id, display, first ? 'เป็นมาสเตอร์ (ผู้ใช้คนแรก)' : 'รออนุมัติ');
    return { user: publicUser_(user) };
  });
}

function login_(p) {
  const username = str_(p.username).toLowerCase();
  const pin = str_(p.pin);
  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + username;
  const fails = num_(cache.get(failKey));
  if (fails >= MAX_LOGIN_FAILS) throw new Error('ใส่ PIN ผิดหลายครั้ง กรุณารอ ' + LOCK_MINUTES + ' นาที');
  const u = readTable_('Users').filter(function (x) { return str_(x.username).toLowerCase() === username; })[0];
  if (!u || hash_(pin, str_(u.salt)) !== str_(u.pin_hash)) {
    cache.put(failKey, String(fails + 1), LOCK_MINUTES * 60);
    throw new Error('ชื่อผู้ใช้หรือ PIN ไม่ถูกต้อง');
  }
  cache.remove(failKey);
  if (u.status === 'pending') throw new Error('บัญชีนี้รอแอดมินอนุมัติ');
  if (u.status !== 'active') throw new Error('บัญชีนี้ถูกปิดใช้งาน');
  const token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  const expires = Date.now() + SESSION_DAYS * 86400000;
  appendRow_('Sessions', { token: token, user_id: u.user_id, expires_at: String(expires) });
  log_(u, 'เข้าสู่ระบบ', 'พนักงาน', u.user_id, u.display_name, '');
  return { token: token, user: publicUser_(u) };
}

function auth_(token) {
  if (!token) throw new Error('unauthorized');
  const cache = CacheService.getScriptCache();
  let userId = cache.get('tok_' + token);
  if (!userId) {
    const s = readTable_('Sessions').filter(function (r) { return r.token === token; })[0];
    if (!s || num_(s.expires_at) < Date.now()) throw new Error('unauthorized');
    userId = s.user_id;
    cache.put('tok_' + token, userId, 3600);
  }
  let u = null;
  const cached = cache.get('usr_' + userId);
  if (cached) u = JSON.parse(cached);
  else {
    u = readTable_('Users').filter(function (x) { return x.user_id === userId; })[0];
    if (u) cache.put('usr_' + userId, JSON.stringify(u), 600);
  }
  if (!u || u.status !== 'active') throw new Error('unauthorized');
  return u;
}

function me_(p, user) { return { user: publicUser_(user), server_version: SERVER_VERSION }; }

function logout_(p, user, token) {
  CacheService.getScriptCache().remove('tok_' + token);
  const s = readTable_('Sessions').filter(function (r) { return r.token === token; })[0];
  if (s) sh_('Sessions').deleteRow(s._row);
  return {};
}

/* ---------------- Catalog ---------------- */

function cleanProduct_(r, admin) {
  const o = {
    product_id: str_(r.product_id), sku: str_(r.sku), name: str_(r.name), category: str_(r.category),
    subcategory: str_(r.subcategory), unit: str_(r.unit), price: num_(r.price),
    has_variants: bool_(r.has_variants), stock_qty: num_(r.stock_qty), description: str_(r.description),
    image_url: str_(r.image_url), active: bool_(r.active)
  };
  if (admin) o.cost = num_(r.cost);
  return o;
}

function cleanVariant_(r, admin) {
  const o = {
    variant_id: str_(r.variant_id), product_id: str_(r.product_id), sku: str_(r.sku), size: str_(r.size),
    color: str_(r.color), price: r.price === '' ? null : num_(r.price), stock_qty: num_(r.stock_qty),
    image_url: str_(r.image_url), active: bool_(r.active)
  };
  if (admin) o.cost = r.cost === '' ? null : num_(r.cost);
  return o;
}

function loadPackagesRaw_() {
  const slots = readTable_('PackageSlots');
  return readTable_('Packages').map(function (r) {
    return {
      package_id: str_(r.package_id), name: str_(r.name), price: num_(r.price), description: str_(r.description),
      image_url: str_(r.image_url), active: bool_(r.active), total_qty: Math.max(0, num_(r.total_qty)),
      slots: slots.filter(function (s) { return str_(s.package_id) === str_(r.package_id); }).map(function (s) {
        return {
          slot: str_(s.slot), kind: str_(s.kind), qty: s.qty === '' ? 0 : Math.max(0, num_(s.qty)), lines: Math.max(1, num_(s.lines) || 1),
          items: str_(s.allowed_items).split(',').map(function (x) { return x.trim(); }).filter(String)
        };
      })
    };
  });
}

/**
 * แพ็กเกจแบบใหม่: fixed = สินค้าติดแพ็กเกจ [{id, qty}] · pool = สินค้าที่ให้เลือกเองหน้าร้าน · total = จำนวนชิ้นทั้งหมด
 * แพ็กเกจแบบเก่า (ช่อง A/B/C) จะถูกแปลง: สินค้าทุกช่องรวมเป็น pool, total = total_qty หรือผลรวมจำนวนของแต่ละช่อง
 */
function packageDef_(k) {
  const typed = k.slots.some(function (s) { return s.kind === 'fixed' || s.kind === 'pool'; });
  const fixed = [], pool = [];
  if (typed) {
    k.slots.forEach(function (s) {
      if (s.kind === 'fixed' && s.items[0] && s.qty > 0) fixed.push({ id: s.items[0], qty: s.qty });
      if (s.kind === 'pool') s.items.forEach(function (i) { if (pool.indexOf(i) < 0) pool.push(i); });
    });
  } else {
    k.slots.forEach(function (s) { s.items.forEach(function (i) { if (pool.indexOf(i) < 0) pool.push(i); }); });
  }
  const fixedQty = fixed.reduce(function (a, f) { return a + f.qty; }, 0);
  let total = k.total_qty || 0;
  if (!total && !typed) total = k.slots.reduce(function (a, s) { return a + (s.qty || 0); }, 0);
  if (!total && !pool.length) total = fixedQty;
  return { fixed: fixed, pool: pool, total: total, choose: Math.max(0, total - fixedQty) };
}

function loadPackages_() {
  return loadPackagesRaw_().map(function (k) {
    const d = packageDef_(k);
    k.fixed = d.fixed; k.pool = d.pool; k.total = d.total; k.choose = d.choose;
    return k;
  });
}

function catalog_(admin) {
  const products = readTable_('Products').map(function (r) { return cleanProduct_(r, admin); });
  const variants = readTable_('Variants').map(function (r) { return cleanVariant_(r, admin); });
  const packages = loadPackages_();
  if (!admin) {
    return {
      products: products.filter(function (p) { return p.active; }),
      variants: variants.filter(function (v) { return v.active; }),
      packages: packages.filter(function (k) { return k.active; }),
      settings: settingsMap_()
    };
  }
  return { products: products, variants: variants, packages: packages, settings: settingsMap_() };
}

function cachedCatalog_(admin) {
  const cache = CacheService.getScriptCache();
  const key = admin ? 'cat_admin_v2' : 'cat_user_v2';
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const data = catalog_(admin);
  try { cache.put(key, JSON.stringify(data), 600); } catch (e) { /* ใหญ่เกิน 100KB ก็อ่านจากชีตทุกครั้ง */ }
  return data;
}

function catalogChanged_() {
  CacheService.getScriptCache().removeAll(['cat_admin_v2', 'cat_user_v2']);
}

function getCatalog_() { return cachedCatalog_(false); }

/* ---------------- Stock ---------------- */

function stockIndex_() {
  const idx = {};
  readTable_('Products').forEach(function (r) {
    idx[str_(r.product_id)] = { sheet: 'Products', row: r._row, stock: num_(r.stock_qty), name: str_(r.name), has_variants: bool_(r.has_variants), product: r };
  });
  readTable_('Variants').forEach(function (r) {
    const parent = idx[str_(r.product_id)];
    const label = [str_(r.size), str_(r.color)].filter(String).join('/');
    idx[str_(r.variant_id)] = {
      sheet: 'Variants', row: r._row, stock: num_(r.stock_qty),
      name: (parent ? parent.name : '') + (label ? ' ' + label : ''),
      price: r.price === '' ? (parent ? num_(parent.product.price) : 0) : num_(r.price),
      variant: r
    };
  });
  return idx;
}

function changeStock_(idx, itemId, delta) {
  const it = idx[itemId];
  if (!it) throw new Error('ไม่พบสินค้า ' + itemId);
  if (it.has_variants) throw new Error('สินค้า ' + it.name + ' ต้องเลือกไซซ์/สี');
  if (it.before === undefined) it.before = it.stock;
  it.stock += delta;
  it.dirty = true;
  return it.stock;
}

/**
 * เขียนสต็อกที่เปลี่ยนลงชีตครั้งเดียวต่อชีต (เร็วกว่าเขียนทีละช่อง)
 * สินค้าที่สต็อกเพิ่งหมด (จากมากกว่า 0 เหลือ 0 หรือติดลบ) จะถูกปิดขายอัตโนมัติ — เปิดใหม่ได้ที่หลังบ้าน
 * คืนรายชื่อสินค้าที่ถูกปิดขาย
 */
function flushStock_(idx, user) {
  const hidden = [];
  ['Products', 'Variants'].forEach(function (name) {
    const dirty = Object.keys(idx).map(function (k) { return idx[k]; }).filter(function (it) { return it.dirty && it.sheet === name; });
    if (!dirty.length) return;
    const s = sh_(name);
    const hs = headers_(name);
    const col = hs.indexOf('stock_qty') + 1;
    const actCol = hs.indexOf('active') + 1;
    const n = s.getLastRow() - 1;
    if (col < 1 || n < 1) return;
    const range = s.getRange(2, col, n, 1);
    const vals = range.getValues();
    const soldOut = [];
    dirty.forEach(function (it) {
      vals[it.row - 2][0] = it.stock; it.dirty = false;
      if (it.before > 0 && it.stock <= 0) soldOut.push(it);
      it.before = undefined;
    });
    range.setValues(vals);
    if (soldOut.length && actCol > 0) {
      const ar = s.getRange(2, actCol, n, 1);
      const av = ar.getValues();
      soldOut.forEach(function (it) {
        if (!bool_(av[it.row - 2][0])) return;
        av[it.row - 2][0] = false;
        hidden.push(it);
      });
      ar.setValues(av);
    }
  });
  hidden.forEach(function (it) { log_(user, 'ปิดขายอัตโนมัติ', 'สินค้า', '', it.name, 'สินค้าหมด (สต็อกเหลือ ' + it.stock + ') · เปิดขายใหม่ได้ที่หลังบ้าน'); });
  catalogChanged_();
  return hidden.map(function (it) { return it.name; });
}

function addStock_(p, user) {
  const itemId = str_(p.item_id);
  const qty = Math.round(num_(p.qty));
  if (!itemId || !qty) throw new Error('กรุณาเลือกสินค้าและใส่จำนวน');
  return withLock_(function () {
    const idx = stockIndex_();
    const stock = changeStock_(idx, itemId, qty);
    const autoHidden = flushStock_(idx, user);
    appendRow_('StockIn', {
      stockin_id: nextId_(readTable_('StockIn'), 'stockin_id', 'S', 4), datetime: now_(),
      event_name: str_(p.event_name), item_id: itemId, qty: qty, note: str_(p.note), staff: user.display_name
    });
    log_(user, qty > 0 ? 'เพิ่มสต็อก' : 'ลดสต็อก', 'สต็อก', itemId, idx[itemId].name,
      (qty > 0 ? '+' : '') + qty + ' → คงเหลือ ' + stock + (p.note ? ' · ' + str_(p.note) : '') + (p.event_name ? ' · งาน ' + str_(p.event_name) : ''));
    return { item_id: itemId, stock_qty: stock, auto_hidden: autoHidden };
  });
}

/* ---------------- Sales ---------------- */

function createSale_(p, user) {
  const lines = p.lines || [];
  if (!lines.length) throw new Error('ไม่มีสินค้าในตะกร้า');
  const method = str_(p.payment_method);
  if (['cash', 'transfer', 'promptpay'].indexOf(method) < 0) throw new Error('วิธีชำระเงินไม่ถูกต้อง'); // promptpay = แบบเดิม นับรวมเป็นโอน

  return withLock_(function () {
    const sales = readTable_('Sales');
    const clientId = str_(p.client_id);
    if (clientId) {
      const dup = sales.filter(function (s) { return str_(s.client_id) === clientId; })[0];
      if (dup) return { bill: billOf_(dup.bill_id) };
    }
    const idx = stockIndex_();
    const packages = {};
    loadPackages_().forEach(function (k) { packages[k.package_id] = k; });

    const items = [];
    const deductions = [];
    let subtotal = 0;
    let setNo = 0;

    lines.forEach(function (ln) {
      const qty = Math.round(num_(ln.qty));
      if (qty <= 0) return;
      if (ln.type === 'package') {
        const k = packages[str_(ln.id)];
        if (!k || !k.active) throw new Error('ไม่พบแพ็กเกจ ' + ln.id);
        setNo += 1;
        items.push({ item_id: k.package_id, item_name: k.name, qty: qty, unit_price: k.price, line_total: k.price * qty, package_id: k.package_id, package_set_no: setNo, slot: '' });
        subtotal += k.price * qty;
        // สินค้าติดแพ็กเกจ (ใส่ให้อัตโนมัติ) + สินค้าที่เลือกเองจาก pool ต้องรวมครบจำนวนชิ้นทั้งหมดพอดี
        const merged = {};
        const picks = Array.isArray(ln.selections && ln.selections.pool) ? ln.selections.pool : [];
        picks.forEach(function (x) {
          const pid = str_(x && x.id), q = Math.round(num_(x && x.qty));
          if (pid && q > 0) merged[pid] = (merged[pid] || 0) + q;
        });
        let pieces = 0;
        k.fixed.forEach(function (f) {
          const it = idx[f.id];
          if (!it) throw new Error('ไม่พบสินค้าที่ติดแพ็กเกจ ' + k.name);
          items.push({ item_id: f.id, item_name: it.name, qty: qty * f.qty, unit_price: 0, line_total: 0, package_id: k.package_id, package_set_no: setNo, slot: 'ติดเซต' });
          deductions.push([f.id, qty * f.qty]);
          pieces += f.qty;
        });
        Object.keys(merged).forEach(function (chosen) {
          if (k.pool.indexOf(chosen) < 0) throw new Error('สินค้าที่เลือกไม่อยู่ในแพ็กเกจ ' + k.name);
          const it = idx[chosen];
          if (!it) throw new Error('ไม่พบสินค้า ' + chosen);
          items.push({ item_id: chosen, item_name: it.name, qty: qty * merged[chosen], unit_price: 0, line_total: 0, package_id: k.package_id, package_set_no: setNo, slot: 'เลือก' });
          deductions.push([chosen, qty * merged[chosen]]);
          pieces += merged[chosen];
        });
        if (k.total > 0 && pieces !== k.total) throw new Error(k.name + ' ต้องมีสินค้ารวม ' + k.total + ' ชิ้น (ตอนนี้ ' + pieces + ')');
        if (!pieces) throw new Error('ยังไม่ได้เลือกสินค้าใน ' + k.name);
      } else {
        const id = str_(ln.id);
        const it = idx[id];
        if (!it) throw new Error('ไม่พบสินค้า ' + id);
        const parentRow = it.sheet === 'Variants' ? (idx[str_(it.variant.product_id)] || {}).product : null;
        const active = it.sheet === 'Products' ? bool_(it.product.active) : bool_(it.variant.active) && (!parentRow || bool_(parentRow.active));
        // บิลที่ขายตอนออฟไลน์ ขายไปแล้วจริง จึงรับไว้แม้สินค้าถูกปิดขายระหว่างนั้น
        if (!active && !p.offline) throw new Error(it.name + ' ปิดขายอยู่ (เช่น สินค้าหมด) — เปิดขายได้ที่หลังบ้าน');
        const price = it.sheet === 'Variants' ? it.price : num_(it.product.price);
        items.push({ item_id: id, item_name: it.name, qty: qty, unit_price: price, line_total: price * qty, package_id: '', package_set_no: '', slot: '' });
        subtotal += price * qty;
        deductions.push([id, qty]);
      }
    });
    if (!items.length) throw new Error('ไม่มีสินค้าในตะกร้า');

    const dType = str_(p.discount_type) === 'percent' ? 'percent' : 'baht';
    const dValue = Math.max(0, num_(p.discount_value));
    let dAmount = dType === 'percent' ? subtotal * Math.min(dValue, 100) / 100 : dValue;
    dAmount = Math.min(subtotal, Math.round(dAmount * 100) / 100);
    const total = Math.round((subtotal - dAmount) * 100) / 100;

    const billId = nextId_(sales, 'bill_id', 'B', 4);

    // รูปสลิป (ถ้ามี) — บันทึกก่อนตัดสต็อก ถ้าบันทึกรูปไม่ได้จะไม่ขาย
    let slipUrl = '';
    if (p.slip_data) {
      const bytes = Utilities.base64Decode(str_(p.slip_data));
      if (bytes.length > 4 * 1024 * 1024) throw new Error('รูปสลิปใหญ่เกิน 4MB');
      const file = folder_(SLIP_FOLDER).createFile(Utilities.newBlob(bytes, 'image/jpeg', billId + '-slip-' + Date.now() + '.jpg'));
      slipUrl = 'https://drive.google.com/file/d/' + file.getId() + '/view';
    }

    deductions.forEach(function (d) { changeStock_(idx, d[0], -d[1]); });
    const autoHidden = flushStock_(idx, user);

    const bill = {
      bill_id: billId, datetime: saleTime_(p), event_name: str_(p.event_name), subtotal: subtotal,
      discount_type: dType, discount_value: dValue, discount_amount: dAmount, total: total,
      payment_method: method, note: str_(p.note), staff: user.display_name, client_id: clientId, slip_url: slipUrl
    };
    appendRow_('Sales', bill);
    appendRows_('SaleItems', items.map(function (it, i) { return Object.assign({ bill_id: billId, line_no: i + 1 }, it); }));
    log_(user, 'ขาย', 'บิล', billId, '', 'ยอด ' + total + ' ฿ · ' + ({ cash: 'เงินสด', transfer: 'โอน', promptpay: 'โอน (QR)' })[method] +
      (dAmount ? ' · ส่วนลด ' + dAmount + ' ฿' : '') + (slipUrl ? ' · มีรูปสลิป' : '') + (p.offline ? ' · ขายตอนออฟไลน์ ส่งขึ้นภายหลัง' : '') + ' · ' + items.filter(function (i) { return !i.slot; }).map(function (i) { return i.item_name + ' ×' + i.qty; }).join(', '));
    delete bill.client_id;
    bill.items = items;
    return { bill: bill, auto_hidden: autoHidden };
  });
}

/** เวลาขาย: บิลออฟไลน์ใช้เวลาที่ขายจริงในเครื่อง (ถ้าสมเหตุสมผล) ไม่งั้นใช้เวลาตอนบันทึก */
function saleTime_(p) {
  const t = str_(p.sold_at);
  if (!p.offline || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t)) return now_();
  const nowStr = now_();
  const monthAgo = Utilities.formatDate(new Date(Date.now() - 30 * 86400000), tz_(), 'yyyy-MM-dd HH:mm:ss');
  return t <= nowStr && t >= monthAgo ? t : nowStr;
}

function billOf_(billId) {
  const s = readTable_('Sales').filter(function (r) { return r.bill_id === billId; })[0];
  const items = readTable_('SaleItems').filter(function (r) { return r.bill_id === billId; });
  return Object.assign(cleanSale_(s), { items: items.map(cleanItem_) });
}

function cleanSale_(r) {
  return {
    bill_id: str_(r.bill_id), datetime: str_(r.datetime), event_name: str_(r.event_name), subtotal: num_(r.subtotal),
    discount_type: str_(r.discount_type), discount_value: num_(r.discount_value), discount_amount: num_(r.discount_amount),
    total: num_(r.total), payment_method: str_(r.payment_method), note: str_(r.note), staff: str_(r.staff),
    slip_url: str_(r.slip_url), status: str_(r.status) || 'paid', cancelled_at: str_(r.cancelled_at),
    cancelled_by: str_(r.cancelled_by), cancel_reason: str_(r.cancel_reason)
  };
}

function cleanItem_(r) {
  return {
    item_id: str_(r.item_id), item_name: str_(r.item_name), qty: num_(r.qty), unit_price: num_(r.unit_price),
    line_total: num_(r.line_total), package_id: str_(r.package_id), package_set_no: r.package_set_no === '' ? '' : num_(r.package_set_no), slot: str_(r.slot)
  };
}

/** บิลตามช่วงวันที่ (from–to รวมทั้งสองวัน รูปแบบ yyyy-MM-dd) ถ้าไม่ระบุ = วันนี้ */
function todaySales_(p, user) {
  // พนักงานขายดูได้เฉพาะบิลของวันนี้ (ไว้ยกเลิกบิล) แอดมินเลือกช่วงวันที่ได้
  const admin = isAdmin_(user);
  const from = admin ? (str_(p.from) || str_(p.date) || today_()) : today_();
  const to = admin ? (str_(p.to) || from) : from;
  if (to < from) throw new Error('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม');
  const day = from;
  const bills = readTable_('Sales').filter(function (r) { const d = str_(r.datetime).slice(0, 10); return d >= from && d <= to; }).map(cleanSale_);
  const ids = {};
  bills.forEach(function (b) { b.items = []; ids[b.bill_id] = b; });
  readTable_('SaleItems').forEach(function (r) { if (ids[r.bill_id]) ids[r.bill_id].items.push(cleanItem_(r)); });
  bills.reverse();
  return { date: day, from: from, to: to, bills: bills };
}

/**
 * ยกเลิกบิล: ต้องพิมพ์ชื่อผู้ใช้ของตัวเองยืนยัน + ใส่เหตุผล
 * คืนสินค้าเข้าสต็อกทุกรายการ (รวมสินค้าในแพ็กเกจ) และบันทึกสถานะ/เหตุผลไว้ในบิล
 */
function cancelBill_(p, user) {
  const billId = str_(p.bill_id);
  const reason = str_(p.reason);
  if (str_(p.username).toLowerCase() !== str_(user.username).toLowerCase()) throw new Error('ชื่อผู้ใช้ไม่ตรงกับบัญชีที่เข้าสู่ระบบอยู่');
  if (!reason) throw new Error('กรุณาใส่สาเหตุที่ยกเลิก');
  return withLock_(function () {
    const bill = readTable_('Sales').filter(function (r) { return str_(r.bill_id) === billId; })[0];
    if (!bill) throw new Error('ไม่พบบิล ' + billId);
    if (str_(bill.status) === 'cancelled') throw new Error('บิลนี้ถูกยกเลิกไปแล้ว');
    if (!isAdmin_(user) && str_(bill.datetime).slice(0, 10) !== today_()) throw new Error('พนักงานขายยกเลิกได้เฉพาะบิลของวันนี้');
    const items = readTable_('SaleItems').filter(function (r) { return str_(r.bill_id) === billId; });
    const idx = stockIndex_();
    const back = {};
    items.forEach(function (r) {
      if (str_(r.package_id) && !str_(r.slot)) return; // แถวหัวแพ็กเกจ ไม่ใช่สินค้าจริง
      const id = str_(r.item_id);
      if (!idx[id] || idx[id].has_variants) return;     // สินค้าถูกลบไปแล้ว
      back[id] = (back[id] || 0) + num_(r.qty);
    });
    const ids = Object.keys(back);
    ids.forEach(function (id) { changeStock_(idx, id, back[id]); });
    if (ids.length) {
      flushStock_(idx, user);
      const base = Number(nextId_(readTable_('StockIn'), 'stockin_id', 'S', 4).slice(1));
      const when = now_();
      appendRows_('StockIn', ids.map(function (id, i) {
        return { stockin_id: 'S' + pad_(base + i, 4), datetime: when, event_name: str_(bill.event_name), item_id: id, qty: back[id], note: 'คืนสต็อกจากยกเลิกบิล ' + billId + ' · ' + reason, staff: user.display_name };
      }));
    }
    const patch = { status: 'cancelled', cancelled_at: now_(), cancelled_by: user.display_name, cancel_reason: reason };
    updateRow_('Sales', bill._row, patch);
    log_(user, 'ยกเลิกบิล', 'บิล', billId, '', 'สาเหตุ: ' + reason + ' · ยอด ' + num_(bill.total) + ' ฿ · คืนสต็อก ' +
      (ids.map(function (id) { return idx[id].name + ' +' + back[id]; }).join(', ') || '-'));
    return { bill: Object.assign(cleanSale_(Object.assign({}, bill, patch)), { items: items.map(cleanItem_) }) };
  });
}

/** ส่งรูปสลิปของบิลกลับมาเป็น base64 ให้แอดมินดูในแอปได้ (ไฟล์ใน Drive ไม่ได้แชร์สาธารณะ) */
function getSlip_(p) {
  const bill = readTable_('Sales').filter(function (r) { return str_(r.bill_id) === str_(p.bill_id); })[0];
  if (!bill) throw new Error('ไม่พบบิล');
  const m = str_(bill.slip_url).match(/\/d\/([^/]+)/);
  if (!m) throw new Error('บิลนี้ไม่มีรูปสลิป');
  let blob;
  try { blob = DriveApp.getFileById(m[1]).getBlob(); }
  catch (e) { throw new Error('เปิดไฟล์สลิปใน Drive ไม่ได้: ' + (e && e.message ? e.message : e)); }
  return { bill_id: str_(bill.bill_id), mime: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()), url: str_(bill.slip_url) };
}

/** ส่งรูปสินค้า/รูป QR (เฉพาะไฟล์ในโฟลเดอร์รูปของระบบ) กลับเป็น base64 — ใช้เมื่อเปิดลิงก์สาธารณะของ Drive ไม่ได้ */
function getImage_(p) {
  const m = str_(p.url).match(/\/d\/([\w-]{20,})|[?&]id=([\w-]{20,})/);
  if (!m) throw new Error('ลิงก์รูปไม่ถูกต้อง');
  const file = DriveApp.getFileById(m[1] || m[2]);
  const folderId = imageFolder_().getId();
  let inFolder = false;
  const parents = file.getParents();
  while (parents.hasNext()) if (parents.next().getId() === folderId) inFolder = true;
  if (!inFolder) throw new Error('ไม่อนุญาตให้เปิดไฟล์นี้');
  const blob = file.getBlob();
  return { mime: blob.getContentType() || 'image/png', data: Utilities.base64Encode(blob.getBytes()) };
}

/* ---------------- Admin ---------------- */

function getAdminData_() {
  const data = JSON.parse(JSON.stringify(cachedCatalog_(true)));
  data.users = readTable_('Users').map(publicUser_);
  data.server_version = SERVER_VERSION;
  return data;
}

function updateUser_(p, admin) {
  return withLock_(function () {
    const u = readTable_('Users').filter(function (x) { return x.user_id === str_(p.user_id); })[0];
    if (!u) throw new Error('ไม่พบผู้ใช้');
    const patch = {};
    // แอดมินแก้บัญชีของมาสเตอร์ไม่ได้ และตั้งใครเป็นมาสเตอร์ไม่ได้
    if (u.role === 'master' && !isMaster_(admin)) throw new Error('แก้ไขบัญชีมาสเตอร์ได้เฉพาะมาสเตอร์');
    if (p.role) {
      if (['master', 'admin', 'seller'].indexOf(p.role) < 0) throw new Error('role ไม่ถูกต้อง');
      if (p.role === 'master' && !isMaster_(admin)) throw new Error('ตั้งเป็นมาสเตอร์ได้เฉพาะมาสเตอร์');
      if (u.user_id === admin.user_id && p.role !== admin.role) throw new Error('เปลี่ยนสิทธิ์ของตัวเองไม่ได้');
      patch.role = p.role;
    }
    if (p.status) {
      if (['active', 'pending', 'disabled'].indexOf(p.status) < 0) throw new Error('สถานะไม่ถูกต้อง');
      if (u.user_id === admin.user_id && p.status !== 'active') throw new Error('ปิดบัญชีตัวเองไม่ได้');
      patch.status = p.status;
    }
    if (p.pin) {
      if (!/^\d{4,6}$/.test(str_(p.pin))) throw new Error('PIN ต้องเป็นตัวเลข 4–6 หลัก');
      patch.salt = Utilities.getUuid();
      patch.pin_hash = hash_(str_(p.pin), patch.salt);
    }
    updateRow_('Users', u._row, patch);
    CacheService.getScriptCache().remove('usr_' + u.user_id);
    if (patch.status && patch.status !== 'active') revokeSessions_(u.user_id);
    const what = [];
    if (patch.role && patch.role !== u.role) what.push('สิทธิ์: ' + (ROLE_LABEL[patch.role] || patch.role));
    if (patch.status && patch.status !== u.status) what.push(patch.status === 'active' ? (u.status === 'pending' ? 'อนุมัติ' : 'เปิดบัญชี') : patch.status === 'disabled' ? (u.status === 'pending' ? 'ไม่อนุมัติ' : 'ปิดบัญชี') : patch.status);
    if (patch.pin_hash) what.push('รีเซ็ต PIN');
    if (what.length) log_(admin, 'แก้ไข', 'พนักงาน', u.user_id, u.display_name, what.join(' · '));
    return { user: publicUser_(Object.assign({}, u, patch)) };
  });
}

function revokeSessions_(userId) {
  const s = sh_('Sessions');
  readTable_('Sessions').filter(function (r) { return r.user_id === userId; }).reverse().forEach(function (r) {
    CacheService.getScriptCache().remove('tok_' + r.token);
    s.deleteRow(r._row);
  });
}

/** เปิด/ปิดขายสินค้าหลายรายการพร้อมกัน: { ids: [product_id...], active: true/false } */
function setProductsActive_(p, user) {
  const ids = (p.ids || []).map(str_).filter(String);
  if (!ids.length) throw new Error('ยังไม่ได้เลือกสินค้า');
  const active = p.active === true || String(p.active) === 'true';
  return withLock_(function () {
    const want = {};
    ids.forEach(function (id) { want[id] = true; });
    const rows = readTable_('Products').filter(function (r) { return want[str_(r.product_id)]; });
    if (!rows.length) throw new Error('ไม่พบสินค้า');
    const changed = rows.filter(function (r) { return bool_(r.active) !== active; });
    changed.forEach(function (r) { updateRow_('Products', r._row, { active: active }); });
    if (changed.length) {
      catalogChanged_();
      log_(user, 'แก้ไข', 'สินค้า', changed.map(function (r) { return r.product_id; }).join(','),
        changed.length + ' รายการ', (active ? 'เปิดขาย: ' : 'ปิดขาย: ') + changed.map(function (r) { return r.name; }).join(', '));
    }
    return { changed: changed.length, ids: changed.map(function (r) { return str_(r.product_id); }) };
  });
}

function saveProduct_(p, user) {
  const name = str_(p.name);
  if (!name) throw new Error('กรุณาใส่ชื่อสินค้า');
  return withLock_(function () {
    const rows = readTable_('Products');
    const sku = str_(p.sku);
    const id = str_(p.product_id);
    if (sku && rows.some(function (r) { return str_(r.sku) === sku && str_(r.product_id) !== id; })) throw new Error('SKU นี้ถูกใช้แล้ว');
    const obj = {
      sku: sku, name: name, category: str_(p.category), subcategory: str_(p.subcategory), unit: str_(p.unit),
      price: num_(p.price), cost: num_(p.cost), description: str_(p.description), image_url: str_(p.image_url),
      active: p.active !== false
    };
    if (id) {
      const r = rows.filter(function (x) { return str_(x.product_id) === id; })[0];
      if (!r) throw new Error('ไม่พบสินค้า');
      updateRow_('Products', r._row, obj);
      catalogChanged_();
      const d = diff_(r, obj);
      if (d) log_(user, 'แก้ไข', 'สินค้า', id, name, d);
      return { product_id: id };
    }
    obj.product_id = nextId_(rows, 'product_id', 'P', 3);
    obj.has_variants = false;
    obj.stock_qty = 0;
    appendRow_('Products', obj);
    catalogChanged_();
    log_(user, 'เพิ่ม', 'สินค้า', obj.product_id, name, diff_(null, obj));
    return { product_id: obj.product_id };
  });
}

function saveVariant_(p, user) {
  return withLock_(function () {
    const productId = str_(p.product_id);
    const prod = readTable_('Products').filter(function (x) { return str_(x.product_id) === productId; })[0];
    if (!prod) throw new Error('ไม่พบสินค้าหลัก');
    const rows = readTable_('Variants');
    const id = str_(p.variant_id);
    const obj = {
      product_id: productId, sku: str_(p.sku), size: str_(p.size), color: str_(p.color),
      price: p.price === '' || p.price === null || p.price === undefined ? '' : num_(p.price),
      cost: p.cost === '' || p.cost === null || p.cost === undefined ? '' : num_(p.cost),
      image_url: str_(p.image_url), active: p.active !== false
    };
    if (!obj.size && !obj.color) throw new Error('กรุณาใส่ไซซ์หรือสี');
    if (obj.sku && rows.some(function (r) { return str_(r.sku) === obj.sku && str_(r.variant_id) !== id; })) throw new Error('SKU นี้ถูกใช้แล้ว');
    let vid = id;
    const label = str_(prod.name) + ' ' + [obj.size, obj.color].filter(String).join('/');
    if (id) {
      const r = rows.filter(function (x) { return str_(x.variant_id) === id; })[0];
      if (!r) throw new Error('ไม่พบตัวเลือก');
      updateRow_('Variants', r._row, obj);
      const d = diff_(r, obj);
      if (d) log_(user, 'แก้ไข', 'ไซซ์/สี', id, label, d);
    } else {
      vid = nextId_(rows, 'variant_id', 'V', 3);
      obj.variant_id = vid;
      obj.stock_qty = 0;
      appendRow_('Variants', obj);
      log_(user, 'เพิ่ม', 'ไซซ์/สี', vid, label, diff_(null, obj));
    }
    if (!bool_(prod.has_variants)) updateRow_('Products', prod._row, { has_variants: true });
    catalogChanged_();
    return { variant_id: vid };
  });
}

function savePackage_(p, user) {
  const name = str_(p.name);
  if (!name) throw new Error('กรุณาใส่ชื่อแพ็กเกจ');
  const totalQty = Math.max(0, Math.round(num_(p.total_qty)));
  if (!totalQty) throw new Error('กรุณาใส่จำนวนชิ้นทั้งหมดในแพ็กเกจ');
  const fixedMap = {};
  (p.fixed || []).forEach(function (f) {
    const id = str_(f && f.id), q = Math.round(num_(f && f.qty));
    if (id && q > 0) fixedMap[id] = (fixedMap[id] || 0) + q;
  });
  const fixed = Object.keys(fixedMap).map(function (id) { return { id: id, qty: fixedMap[id] }; });
  const pool = (p.pool || []).map(str_).filter(String).filter(function (v, i, a) { return a.indexOf(v) === i; });
  const fixedQty = fixed.reduce(function (a, f) { return a + f.qty; }, 0);
  if (fixedQty > totalQty) throw new Error('สินค้าติดแพ็กเกจ (' + fixedQty + ' ชิ้น) มากกว่าจำนวนชิ้นทั้งหมด (' + totalQty + ')');
  if (fixedQty < totalQty && !pool.length) throw new Error('ต้องให้ลูกค้าเลือกเองอีก ' + (totalQty - fixedQty) + ' ชิ้น กรุณาติ๊กสินค้าที่ให้เลือกอย่างน้อย 1 รายการ');
  if (!fixed.length && !pool.length) throw new Error('แพ็กเกจต้องมีสินค้าอย่างน้อย 1 ชิ้น');
  return withLock_(function () {
    const idx = stockIndex_();
    fixed.concat(pool.map(function (i) { return { id: i }; })).forEach(function (f) { if (!idx[f.id]) throw new Error('ไม่พบสินค้า ' + f.id); });
    const rows = readTable_('Packages');
    let id = str_(p.package_id);
    const obj = { name: name, price: num_(p.price), description: str_(p.description), image_url: str_(p.image_url), active: p.active !== false, total_qty: totalQty };
    const nm = function (i) { return idx[i] ? idx[i].name : i; };
    const contents = function (fx, pl) { return 'ติดแพ็กเกจ: ' + (fx.map(function (f) { return nm(f.id) + '×' + f.qty; }).join(', ') || '-') + ' · ให้เลือก: ' + (pl.map(nm).join(', ') || '-'); };
    let logDetail;
    if (id) {
      const r = rows.filter(function (x) { return str_(x.package_id) === id; })[0];
      if (!r) throw new Error('ไม่พบแพ็กเกจ');
      const old = loadPackages_().filter(function (k) { return k.package_id === id; })[0];
      updateRow_('Packages', r._row, obj);
      const d = [diff_(r, obj)];
      if (old && contents(old.fixed, old.pool) !== contents(fixed, pool)) d.push(contents(old.fixed, old.pool) + ' → ' + contents(fixed, pool));
      logDetail = ['แก้ไข', d.filter(String).join(' · ')];
    } else {
      id = nextId_(rows, 'package_id', 'PK', 3);
      obj.package_id = id;
      appendRow_('Packages', obj);
      logDetail = ['เพิ่ม', [diff_(null, obj), contents(fixed, pool)].filter(String).join(' · ')];
    }
    if (logDetail[1]) log_(user, logDetail[0], 'แพ็กเกจ', id, name, logDetail[1]);
    const s = sh_('PackageSlots');
    readTable_('PackageSlots').filter(function (r) { return str_(r.package_id) === id; }).reverse().forEach(function (r) { s.deleteRow(r._row); });
    appendRows_('PackageSlots', fixed.map(function (f) { return { package_id: id, slot: 'ติดเซต', kind: 'fixed', qty: f.qty, allowed_items: f.id, lines: 1 }; })
      .concat(pool.length ? [{ package_id: id, slot: 'เลือก', kind: 'pool', qty: 0, allowed_items: pool.join(','), lines: 1 }] : []));
    catalogChanged_();
    return { package_id: id };
  });
}

function saveSettings_(p, user) {
  const allowed = Object.keys(DEFAULT_SETTINGS);
  return withLock_(function () {
    const rows = readTable_('Settings');
    const before = settingsMap_();
    const changed = {};
    Object.keys(p || {}).forEach(function (k) { if (allowed.indexOf(k) >= 0 && str_(before[k]) !== str_(p[k])) changed[k] = str_(p[k]); });
    const d = diff_(before, changed);
    if (d) log_(user, 'แก้ไข', 'ตั้งค่า', '', '', d);
    Object.keys(p || {}).forEach(function (k) {
      if (allowed.indexOf(k) < 0) return;
      const rs = rows.filter(function (x) { return x.key === k; });
      if (rs.length) rs.forEach(function (r) { updateRow_('Settings', r._row, { value: str_(p[k]) }); });
      else appendRow_('Settings', { key: k, value: str_(p[k]) });
    });
    catalogChanged_();
    return { settings: settingsMap_() };
  });
}

/* ---------------- Requisitions (ใบเบิก) ---------------- */

/**
 * items: [{ item_id (ว่าง = รายการพิมพ์เอง ไม่ตัด/เพิ่มสต็อก), name, unit, qty_req, qty_recv, note }]
 * สินค้าในระบบจะเพิ่มสต็อกตาม "จำนวนที่ได้รับ" (ถ้าไม่ใส่ ใช้ "จำนวนขอเบิก")
 */
function createRequisition_(p, user) {
  const raw = (p.items || []).filter(function (it) { return it && (str_(it.item_id) || str_(it.name)); });
  if (!raw.length) throw new Error('ใบเบิกต้องมีอย่างน้อย 1 รายการ');
  const activity = str_(p.activity);
  if (!activity) throw new Error('กรุณาใส่ชื่อกิจกรรม / งาน');
  return withLock_(function () {
    const idx = stockIndex_();
    const items = raw.map(function (it) {
      const id = str_(it.item_id);
      const o = {
        item_id: id, name: str_(it.name), unit: str_(it.unit),
        qty_req: it.qty_req === '' || it.qty_req === null || it.qty_req === undefined ? '' : Math.round(num_(it.qty_req)),
        qty_recv: it.qty_recv === '' || it.qty_recv === null || it.qty_recv === undefined ? '' : Math.round(num_(it.qty_recv)),
        note: str_(it.note)
      };
      if (id) {
        const s = idx[id];
        if (!s) throw new Error('ไม่พบสินค้า ' + id);
        if (s.has_variants) throw new Error('สินค้า ' + s.name + ' ต้องเลือกไซซ์/สี');
        o.name = s.name;
        if (!o.unit) o.unit = s.sheet === 'Products' ? str_(s.product.unit) : '';
        o.qty_in = o.qty_recv !== '' ? o.qty_recv : num_(o.qty_req);
        if (o.qty_in < 0) throw new Error('จำนวนต้องไม่ติดลบ');
      }
      return o;
    });
    const reqId = nextId_(readTable_('Requisitions'), 'req_id', 'RQ', 4);
    const when = now_();
    const stockRows = [];
    items.forEach(function (o) {
      if (!o.item_id || !o.qty_in) return;
      o.stock_after = changeStock_(idx, o.item_id, o.qty_in);
      stockRows.push(o);
    });
    if (stockRows.length) {
      flushStock_(idx, user);
      const base = Number(nextId_(readTable_('StockIn'), 'stockin_id', 'S', 4).slice(1));
      appendRows_('StockIn', stockRows.map(function (o, i) {
        return { stockin_id: 'S' + pad_(base + i, 4), datetime: when, event_name: activity, item_id: o.item_id, qty: o.qty_in, note: 'ใบเบิก ' + reqId + (o.note ? ' · ' + o.note : ''), staff: user.display_name };
      }));
    }
    const req = {
      req_id: reqId, created_at: when, doc_date: str_(p.doc_date) || today_(), department: str_(p.department),
      activity: activity, requester: str_(p.requester) || user.display_name, note: str_(p.note), created_by: user.display_name
    };
    appendRow_('Requisitions', Object.assign({}, req, { items_json: JSON.stringify(items) }));
    log_(user, 'เบิกสินค้า', 'ใบเบิก', reqId, activity, items.map(function (o) {
      return o.name + ' ' + (o.qty_recv !== '' ? o.qty_recv : o.qty_req) + (o.unit ? ' ' + o.unit : '');
    }).join(', '));
    req.items = items;
    return { requisition: req };
  });
}

function listRequisitions_(p) {
  const rows = readTable_('Requisitions');
  return {
    requisitions: rows.slice(-Math.min(500, num_(p.limit) || 100)).reverse().map(function (r) {
      let items = [];
      try { items = JSON.parse(str_(r.items_json) || '[]'); } catch (e) {}
      return {
        req_id: str_(r.req_id), created_at: str_(r.created_at), doc_date: str_(r.doc_date).slice(0, 10), department: str_(r.department),
        activity: str_(r.activity), requester: str_(r.requester), note: str_(r.note), created_by: str_(r.created_by), items: items
      };
    })
  };
}

/* ---------------- Delete ---------------- */

/** เอาสินค้าที่ถูกลบออกจากช่องของทุกแพ็กเกจ คืนชื่อแพ็กเกจที่ได้รับผลกระทบ */
function scrubSlots_(ids) {
  const names = {};
  readTable_('Packages').forEach(function (k) { names[str_(k.package_id)] = str_(k.name); });
  const affected = [];
  readTable_('PackageSlots').forEach(function (r) {
    const items = str_(r.allowed_items).split(',').map(function (x) { return x.trim(); }).filter(String);
    const keep = items.filter(function (x) { return ids.indexOf(x) < 0; });
    if (keep.length === items.length) return;
    updateRow_('PackageSlots', r._row, { allowed_items: keep.join(',') });
    const n = names[str_(r.package_id)] || str_(r.package_id);
    if (affected.indexOf(n) < 0) affected.push(n);
  });
  return affected;
}

function deleteProduct_(p, user) {
  return withLock_(function () {
    const id = str_(p.product_id);
    const r = readTable_('Products').filter(function (x) { return str_(x.product_id) === id; })[0];
    if (!r) throw new Error('ไม่พบสินค้า');
    const vars = readTable_('Variants').filter(function (v) { return str_(v.product_id) === id; });
    const vs = sh_('Variants');
    vars.slice().reverse().forEach(function (v) { vs.deleteRow(v._row); });
    sh_('Products').deleteRow(r._row);
    const affected = scrubSlots_([id].concat(vars.map(function (v) { return str_(v.variant_id); })));
    catalogChanged_();
    const stock = bool_(r.has_variants) ? vars.reduce(function (a, v) { return a + num_(v.stock_qty); }, 0) : num_(r.stock_qty);
    log_(user, 'ลบ', 'สินค้า', id, str_(r.name), [
      r.sku ? 'SKU ' + r.sku : '', 'ราคา ' + num_(r.price), 'สต็อกตอนลบ ' + stock,
      vars.length ? 'ไซซ์/สี ' + vars.map(function (v) { return [str_(v.size), str_(v.color)].filter(String).join('/'); }).join(', ') : '',
      affected.length ? 'เอาออกจากแพ็กเกจ ' + affected.join(', ') : ''
    ].filter(String).join(' · '));
    return { deleted: id, packages: affected };
  });
}

function deleteVariant_(p, user) {
  return withLock_(function () {
    const id = str_(p.variant_id);
    const r = readTable_('Variants').filter(function (x) { return str_(x.variant_id) === id; })[0];
    if (!r) throw new Error('ไม่พบตัวเลือก');
    sh_('Variants').deleteRow(r._row);
    const prod = readTable_('Products').filter(function (x) { return str_(x.product_id) === str_(r.product_id); })[0];
    const left = readTable_('Variants').filter(function (v) { return str_(v.product_id) === str_(r.product_id); }).length;
    if (prod && !left) updateRow_('Products', prod._row, { has_variants: false, stock_qty: 0 });
    const affected = scrubSlots_([id]);
    catalogChanged_();
    log_(user, 'ลบ', 'ไซซ์/สี', id, (prod ? str_(prod.name) + ' ' : '') + [str_(r.size), str_(r.color)].filter(String).join('/'),
      [r.sku ? 'SKU ' + r.sku : '', 'สต็อกตอนลบ ' + num_(r.stock_qty), affected.length ? 'เอาออกจากแพ็กเกจ ' + affected.join(', ') : ''].filter(String).join(' · '));
    return { deleted: id, packages: affected };
  });
}

function deletePackage_(p, user) {
  return withLock_(function () {
    const id = str_(p.package_id);
    const r = readTable_('Packages').filter(function (x) { return str_(x.package_id) === id; })[0];
    if (!r) throw new Error('ไม่พบแพ็กเกจ');
    const s = sh_('PackageSlots');
    readTable_('PackageSlots').filter(function (x) { return str_(x.package_id) === id; }).reverse().forEach(function (x) { s.deleteRow(x._row); });
    sh_('Packages').deleteRow(r._row);
    catalogChanged_();
    log_(user, 'ลบ', 'แพ็กเกจ', id, str_(r.name), 'ราคา ' + num_(r.price));
    return { deleted: id };
  });
}

/* ---------------- Stock count ---------------- */

/**
 * counts: [{ item_id, system_qty (สต็อกในระบบตอนเริ่มนับ), counted }]
 * ปรับสต็อกตามส่วนต่าง (นับได้ − ระบบตอนนับ) ถ้าระหว่างนับมีการขาย ยอดขายนั้นจะยังถูกหักอยู่
 */
function stockCount_(p, user) {
  const counts = (p.counts || []).filter(function (c) { return c && c.item_id !== undefined && c.counted !== '' && c.counted !== null; });
  if (!counts.length) throw new Error('ยังไม่ได้นับสินค้ารายการไหนเลย');
  return withLock_(function () {
    const idx = stockIndex_();
    const adjusted = [];
    let matched = 0;
    counts.forEach(function (c) {
      const id = str_(c.item_id);
      const it = idx[id];
      if (!it || it.has_variants) return;
      const counted = Math.round(num_(c.counted));
      const delta = counted - Math.round(num_(c.system_qty));
      if (!delta) { matched++; return; }
      changeStock_(idx, id, delta);
      adjusted.push({ item_id: id, name: it.name, system_qty: num_(c.system_qty), counted: counted, delta: delta, stock_qty: it.stock });
    });
    if (adjusted.length) {
      flushStock_(idx, user);
      const base = Number((nextId_(readTable_('StockIn'), 'stockin_id', 'S', 4)).slice(1));
      const when = now_();
      appendRows_('StockIn', adjusted.map(function (a, i) {
        return {
          stockin_id: 'S' + pad_(base + i, 4), datetime: when, event_name: str_(p.event_name), item_id: a.item_id, qty: a.delta,
          note: 'นับสต็อก: ระบบ ' + a.system_qty + ' นับได้ ' + a.counted + (p.note ? ' · ' + str_(p.note) : ''), staff: user.display_name
        };
      }));
    }
    log_(user, 'นับสต็อก', 'สต็อก', '', str_(p.note), 'นับ ' + counts.length + ' รายการ · ตรง ' + matched + ' · ปรับ ' + adjusted.length +
      (adjusted.length ? ' — ' + adjusted.map(function (a) { return a.name + ' ' + a.system_qty + '→' + a.counted; }).join(', ') : ''));
    return { checked: counts.length, matched: matched, adjusted: adjusted };
  });
}

function folder_(name) {
  const it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

function imageFolder_() { return folder_(IMAGE_FOLDER); }

function uploadImage_(p) {
  const mime = str_(p.mime) || 'image/jpeg';
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new Error('รองรับเฉพาะไฟล์รูป JPG/PNG/WEBP');
  const bytes = Utilities.base64Decode(str_(p.data));
  if (bytes.length > 5 * 1024 * 1024) throw new Error('รูปใหญ่เกิน 5MB');
  const blob = Utilities.newBlob(bytes, mime, (str_(p.name) || 'image') + '-' + Date.now());
  const file = imageFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { url: 'https://lh3.googleusercontent.com/d/' + file.getId() + '=w600', file_id: file.getId() };
}

/** รันครั้งเดียวจาก editor เพื่อให้ Apps Script ขอสิทธิ์ Sheets + Drive และสร้างแท็บที่ขาด */
function setup() {
  CacheService.getScriptCache().remove('setup_ok_v11');
  ensureSetup_();
  imageFolder_();
  folder_(SLIP_FOLDER);
  Logger.log('Setup done. Users so far: ' + readTable_('Users').length);
}
