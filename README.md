# PPK Duty Node Backend V4

อัปโหลดไฟล์ `server.js` และ `package.json` ทับใน GitHub repo ที่ผูกกับ Render

## แก้สำคัญ

- แอดมินไม่อยู่ใน `users` แล้ว
- สมัคร/ล็อกอินจะไม่สร้างแอดมินเป็นนักเรียน
- `users` เหลือเฉพาะบัญชีนักเรียน
- บัญชี demo ปิดค่าเริ่มต้น

## Render

```text
Build Command: npm install
Start Command: npm start
```

## Admin

```text
admin / admin1234
```

เปลี่ยนรหัสแอดมินได้ด้วย Environment Variable:

```text
ADMIN_PASSWORD=รหัสใหม่
```
