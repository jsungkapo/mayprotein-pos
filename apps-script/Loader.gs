/**
 * MayProtein POS — ตัวโหลดเซิร์ฟเวอร์ (วางใน Apps Script ครั้งเดียว แล้ว Deploy ครั้งเดียว)
 *
 * ตัวโหลดนี้ดึงโค้ดเซิร์ฟเวอร์จริง (apps-script/Code.gs) จาก GitHub มาทำงาน
 * ทุกครั้งที่มีการ push โค้ดใหม่ขึ้น branch main เซิร์ฟเวอร์จะใช้โค้ดใหม่เองภายในประมาณ 5–10 นาที
 * ไม่ต้องวางโค้ดหรือ Deploy ใหม่อีก
 *
 * ถ้าโหลดจาก GitHub ไม่ได้ จะใช้โค้ดชุดล่าสุดที่เก็บสำรองไว้ใน Script Properties
 * อยากให้ใช้โค้ดล่าสุดทันที: เลือกฟังก์ชัน refresh แล้วกด Run หรือเปิด URL เว็บแอปต่อท้ายด้วย ?refresh=1
 */

const SOURCE_URL = 'https://raw.githubusercontent.com/jsungkapo/mayprotein-pos/main/apps-script/Code.gs';
const CACHE_SECONDS = 300;
const CHUNK = 8000;        // แคช: ไม่เกิน 100KB ต่อค่า
const PROP_CHUNK = 2500;   // Script Properties: ไม่เกิน 9KB ต่อค่า (ภาษาไทย 1 ตัว = 3 ไบต์)

function doGet(e) {
  if (e && e.parameter && e.parameter.refresh) {
    backend_(true);
    return ContentService.createTextOutput(JSON.stringify({ ok: true, refreshed: true, loaded_at: new Date().toISOString() })).setMimeType(ContentService.MimeType.JSON);
  }
  return backend_().doGet(e);
}

function doPost(e) { return backend_().doPost(e); }

/** รันครั้งแรกจาก editor เพื่อขอสิทธิ์ และสร้างแท็บ/โฟลเดอร์ที่ต้องใช้ */
function setup() { backend_(true).setup(); }

/** ดึงโค้ดล่าสุดจาก GitHub ทันที */
function refresh() { backend_(true); Logger.log('โหลดโค้ดล่าสุดแล้ว'); }

let BACKEND_ = null;

function backend_(fresh) {
  if (BACKEND_ && !fresh) return BACKEND_;
  const src = source_(fresh);
  // รันโค้ดเซิร์ฟเวอร์ในขอบเขตของตัวเอง แล้วเอาเฉพาะฟังก์ชันที่ต้องใช้ออกมา
  BACKEND_ = new Function(src + '\n;return { doGet: doGet, doPost: doPost, setup: setup };')();
  return BACKEND_;
}

function source_(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const hit = readChunks_(function (k) { return cache.get(k); }, 'src');
    if (hit) return hit;
  }
  try {
    const res = UrlFetchApp.fetch(SOURCE_URL + '?t=' + Date.now(), { muteHttpExceptions: true, headers: { 'Cache-Control': 'no-cache' } });
    if (res.getResponseCode() === 200) {
      const text = res.getContentText();
      if (text.indexOf('function doPost') >= 0 && text.indexOf('function setup') >= 0) {
        writeChunks_(function (k, v) { cache.put(k, v, CACHE_SECONDS); }, 'src', text);
        backup_(text);
        return text;
      }
    }
  } catch (err) { /* ใช้สำรองแทน */ }
  const props = PropertiesService.getScriptProperties();
  const saved = readChunks_(function (k) { return props.getProperty(k); }, 'bak');
  if (saved) return saved;
  throw new Error('โหลดโค้ดเซิร์ฟเวอร์จาก GitHub ไม่ได้ และยังไม่มีโค้ดสำรอง');
}

function backup_(text) {
  const props = PropertiesService.getScriptProperties();
  const old = readChunks_(function (k) { return props.getProperty(k); }, 'bak');
  if (old === text) return;
  const all = {};
  const n = Math.ceil(text.length / PROP_CHUNK);
  for (let i = 0; i < n; i++) all['bak_' + i] = text.slice(i * PROP_CHUNK, (i + 1) * PROP_CHUNK);
  all.bak_n = String(n);
  props.setProperties(all);
}

function readChunks_(get, prefix) {
  const n = Number(get(prefix + '_n'));
  if (!n) return null;
  let out = '';
  for (let i = 0; i < n; i++) {
    const part = get(prefix + '_' + i);
    if (part === null || part === undefined) return null;
    out += part;
  }
  return out;
}

function writeChunks_(put, prefix, text) {
  const n = Math.ceil(text.length / CHUNK);
  for (let i = 0; i < n; i++) put(prefix + '_' + i, text.slice(i * CHUNK, (i + 1) * CHUNK));
  put(prefix + '_n', String(n));
}

/**
 * ไม่ได้ถูกเรียกใช้ — มีไว้ให้ Apps Script รู้ว่าโค้ดเซิร์ฟเวอร์ต้องใช้สิทธิ์อะไรบ้าง
 * (Sheets, Drive, ล็อก, แคช, ดึงข้อมูลจากเว็บ) จะได้ขออนุญาตครบตอนกด Run setup
 */
function permissions_() {
  SpreadsheetApp.getActiveSpreadsheet();
  DriveApp.getRootFolder();
  DriveApp.createFolder('x');
  LockService.getScriptLock();
  UrlFetchApp.fetch('https://example.com');
}
