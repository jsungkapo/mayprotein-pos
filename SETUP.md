# ติดตั้งเซิร์ฟเวอร์ (Google Apps Script) — ทำครั้งเดียว

ระบบล็อกอิน การบันทึกบิล สต็อก และหลังบ้าน ทำงานผ่าน Apps Script ที่ผูกกับ Google Sheets ฐานข้อมูล

1. เปิด Google Sheets **MayProtein POS Database (Template)**
   https://docs.google.com/spreadsheets/d/1Qh7fWcxFHWhvQta1zbiBRmFMyRFOfJk-yJuTaDgoMMw/edit
2. เมนู **ส่วนขยาย (Extensions) → Apps Script**
3. ลบโค้ดเดิมในไฟล์ `Code.gs` ทั้งหมด แล้ววางโค้ดจาก
   https://github.com/jsungkapo/mayprotein-pos/blob/main/apps-script/Code.gs (กดปุ่ม Copy raw file มุมขวาบน)
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

## เวลาแก้ Code.gs ภายหลัง
วางโค้ดใหม่ → บันทึก → **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**
(URL เดิมใช้ต่อได้ ไม่ต้องเปลี่ยน)

## หมายเหตุ
- ในแท็บ Sales / SaleItems / StockIn มีแถวตัวอย่าง (บิล B0001) ที่ใส่ไว้ตอนทำเทมเพลต ลบทิ้งได้ก่อนเริ่มขายจริง
- รูปสินค้าและรูป QR จะเก็บในโฟลเดอร์ Google Drive ชื่อ "MayProtein POS Images" (แชร์แบบดูได้ผ่านลิงก์ เพื่อให้แสดงในแอป)
- PIN เก็บแบบเข้ารหัส (hash) ในแท็บ Users อย่าแชร์ไฟล์ Sheets ให้คนนอก
