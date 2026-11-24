# ติดตั้งเซิร์ฟเวอร์ (Google Apps Script) — ทำครั้งเดียว

ระบบล็อกอิน การบันทึกบิล สต็อก และหลังบ้าน ทำงานผ่าน Apps Script ที่ผูกกับ Google Sheets ฐานข้อมูล

1. เปิด Google Sheets **MayProtein POS Database (Template)**
   https://docs.google.com/spreadsheets/d/1Qh7fWcxFHWhvQta1zbiBRmFMyRFOfJk-yJuTaDgoMMw/edit
2. เมนู **ส่วนขยาย (Extensions) → Apps Script**
3. ลบโค้ดเดิมในไฟล์ `Code.gs` ทั้งหมด แล้ววางโค้ด **ตัวโหลด** จาก
   https://github.com/jsungkapo/mayprotein-pos/blob/main/apps-script/Loader.gs (กดปุ่ม Copy raw file มุมขวาบน)
   ตัวโหลดจะดึงโค้ดเซิร์ฟเวอร์จริง (`apps-script/Code.gs`) จาก GitHub มาใช้เอง
4. กด 💾 บันทึก
5. ที่แถบด้านบน เลือกฟังก์ชัน **setup** แล้วกด **เรียกใช้ (Run)**
   - Google จะขอสิทธิ์เข้าถึง Sheets และ Drive → กด **ตรวจสอบสิทธิ์**
   - ถ้าขึ้นว่า "Google hasn't verified this app" → กด **ขั้นสูง (Advanced)** → **ไปที่ ... (ไม่ปลอดภัย)** → **อนุญาต**
     (เป็นสคริปต์ของเราเอง ไม่ได้ส่งข้อมูลไปที่อื่น)
   - setup จะสร้างแท็บ Users, Sessions และคอลัมน์ที่ขาดให้อัตโนมัติ
6. กด **การทำให้ใช้งานได้ (Deploy) → การทำให้ใช้งานได้รายการใหม่ (New deployment)**
   - ไอคอนเฟือง → เลือกประเภท **เว็บแอป (Web app)**
   - Execute as: **Me (ตัวเอง)**
   - Who has access: **Anyone (ทุกคน)**
   - กด Deploy แล้ว **คัดลอก URL ของเว็บแอป** (ลงท้ายด้วย `/exec`)
7. ส่ง URL ให้ Claude ใส่ใน `config.js` (หรือกด "ตั้งค่าเซิร์ฟเวอร์" ที่หน้าล็อกอินแล้ววางเองก็ได้)
8. เปิด https://jsungkapo.github.io/mayprotein-pos/ → **สมัครพนักงานใหม่** — คนแรกที่สมัครจะเป็นแอดมินอัตโนมัติ

## เวลาแก้โค้ดเซิร์ฟเวอร์ภายหลัง
ไม่ต้องทำอะไร — push `apps-script/Code.gs` ขึ้น branch main แล้วเซิร์ฟเวอร์จะใช้โค้ดใหม่เองภายใน ~5–10 นาที
อยากให้มีผลทันที: เปิด `<URL เว็บแอป>?refresh=1` หรือใน Apps Script เลือกฟังก์ชัน `refresh` แล้ว Run
ต้อง Deploy ใหม่เฉพาะเมื่อแก้ `Loader.gs` หรือโค้ดเซิร์ฟเวอร์ต้องใช้สิทธิ์ Google ชนิดใหม่ที่ยังไม่ได้ขอ (ดู `permissions_` ใน Loader.gs)

## หมายเหตุ
- ในแท็บ Sales / SaleItems / StockIn มีแถวตัวอย่าง (บิล B0001) ที่ใส่ไว้ตอนทำเทมเพลต ลบทิ้งได้ก่อนเริ่มขายจริง
- รูปสินค้าและรูป QR จะเก็บในโฟลเดอร์ Google Drive ชื่อ "MayProtein POS Images" (แชร์แบบดูได้ผ่านลิงก์ เพื่อให้แสดงในแอป)
- รูปสลิปโอนเงินเก็บในโฟลเดอร์ "MayProtein POS Slips" แบบไม่แชร์ เปิดดูได้เฉพาะบัญชี Google เจ้าของ
- PIN เก็บแบบเข้ารหัส (hash) ในแท็บ Users อย่าแชร์ไฟล์ Sheets ให้คนนอก
