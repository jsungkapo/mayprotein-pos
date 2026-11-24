# MayProtein POS — Project Notes

สรุปไว้ให้แชตถัดไปทำงานต่อได้ทันที

## ลิงก์
- เว็บแอป (GitHub Pages): https://jsungkapo.github.io/mayprotein-pos/
- โค้ด: https://github.com/jsungkapo/mayprotein-pos (branch `main`, ไฟล์หลัก `index.html`)
- ฐานข้อมูล Google Sheets: "MayProtein POS Database (Template)" — ID `1Qh7fWcxFHWhvQta1zbiBRmFMyRFOfJk-yJuTaDgoMMw`
- สเปกทั้งหมด: https://claude.ai/artifact/9qhEYdDboouqCXbjhjzMXa

## วิธีทำงาน
- Claude แก้โค้ดใน repo นี้โดยตรง แล้ว commit + push ขึ้น `main`
- GitHub Pages deploy จาก `main` / root อัตโนมัติ (รอ 1–2 นาทีหลัง push)
- บน iPhone: เปิดลิงก์ใน Safari → แชร์ → เพิ่มไปยังหน้าจอโฮม

## สถานะปัจจุบัน (v3 — ยังเป็น mockup ข้อมูลอยู่ในหน่วยความจำเบราว์เซอร์ ยังไม่ต่อ Sheets)
- แท็บ: ขาย / รายการขาย / สต็อก / สรุป
- กดสินค้าซ้ำ = เพิ่มจำนวน, ตะกร้าแยกเป็นส่วนเหนือปุ่มชำระเงิน
- สินค้ามี variation (ไซซ์/สี), แพ็กเกจแบบช่อง A/B/C เลือกสินค้าได้ นับจำนวนเซต
- ชำระเงิน: ส่วนลดท้ายบิล (บาท/%), หมายเหตุ, เงินสด/โอน/พร้อมเพย์ QR
- ช่องเงินใช้ `inputmode="decimal"` (แป้นตัวเลขบน iPhone)
- หลังยืนยันขาย: หน้า "ขายสำเร็จ" แสดงเลขบิล + ปุ่มบิลถัดไป

## งานที่ยังเหลือ (ตามลำดับ)
1. Google Apps Script backend + แท็บ Users, ระบบล็อกอิน (username + PIN), สมัครครั้งแรกรอแอดมินอนุมัติ
2. Role: admin เห็นทุกอย่าง / seller ไม่เห็นยอดขาย (ซ่อนแท็บรายการขายและสรุป)
3. ต่อหน้า POS เข้ากับ backend (บันทึกบิล, ตัดสต็อก, เลขบิลจาก backend)
4. หน้าหลังบ้าน `admin.html`: จัดการสินค้า/รูป/variation/แพ็กเกจ/QR/พนักงาน
5. PWA manifest + ไอคอน
6. ดาวน์โหลดสรุปท้ายวันเป็น CSV

## ประวัติ
- 2026-11-24: สร้าง repo, เปิด Pages, เพิ่ม inputmode ช่องส่วนลด, อัปเป็น v3 (หน้าขายสำเร็จ + แท็บรายการขาย)
