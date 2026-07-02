# PPK Duty Node Backend V6 — Google Sheets + Google Drive

เวอร์ชันนี้แก้จาก memory ชั่วคราว ไปใช้ Google Sheets/Google Drive เป็นที่เก็บข้อมูลถาวร

## เก็บข้อมูลที่ไหน

- Users: บัญชีนักเรียน
- Records: งานเวรและสถานะ
- Duties: รายการหน้าที่เวรของแต่ละห้อง
- Settings: ตั้งค่าระบบ
- Google Drive folder: รูปหลักฐาน

## Render Environment Variables ที่ต้องใส่

```text
GOOGLE_SHEET_ID=1aUNaQZy5M5xGKcyMjT4bjHfT5aZxwVMM81bflfb4jFI
GOOGLE_DRIVE_FOLDER_ID=1HGh0iEjxu33dokLxCy74EHqmlAm3_37m
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY=...
ADMIN_ID=admin
ADMIN_PASSWORD=admin1234
SEED_DEMO=false
ENABLE_GOOGLE_STORAGE=true
```

## สำคัญ

ต้องแชร์ Google Sheet และ Google Drive folder ให้ service account email เป็น Editor ไม่งั้น server อ่าน/เขียนไม่ได้

## Render

Build Command:

```text
npm install
```

Start Command:

```text
npm start
```
