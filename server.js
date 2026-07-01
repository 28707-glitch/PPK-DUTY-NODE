const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";
const ADMIN_ID = process.env.ADMIN_ID || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";
const ADMIN_SESSION_ID = "__system_admin__";
const SEED_DEMO = String(process.env.SEED_DEMO || "false").toLowerCase() === "true";

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json({ limit: "25mb", type: "*/*" }));

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"]
  }
});

// -----------------------------------------------------------------------------
// PPK Duty Node Backend — Render + Socket.IO version V4
// หมายเหตุ: เวอร์ชันนี้เก็บข้อมูลใน memory เพื่อให้เริ่มใช้ฟรีได้ทันที
// ถ้า Render restart / redeploy / sleep แล้วตื่นใหม่ ข้อมูลอาจหายได้
// ใช้งานจริงถาวรควรต่อ Supabase/Firebase เพิ่มในขั้นต่อไป
// -----------------------------------------------------------------------------

const settings = {
  schoolName: "โรงเรียนพานพิทยาคม",
  openHour: 13,
  openMinute: 30,
  closeHour: 15,
  closeMinute: 30,
  maxUsersPerRoom: 60
};

// เก็บเฉพาะบัญชีนักเรียนเท่านั้น
// สำคัญ: แอดมินไม่อยู่ใน users array เพื่อไม่ให้ไปโผล่ในรายชื่อนักเรียน/การสมัคร/การจัดการบัญชี
const users = [];

// เปิดบัญชีทดสอบเฉพาะเมื่อ Render Environment Variable: SEED_DEMO=true
// ค่าเริ่มต้นคือ false เพื่อไม่ให้ระบบสร้างบัญชีแปลกปลอมเอง
if (SEED_DEMO) {
  users.push(
    {
      userId: "u_demo_10001",
      studentId: "10001",
      password: "1234",
      name: "นักเรียนทดสอบ 1",
      grade: "6",
      room: "1",
      role: "student",
      active: true
    },
    {
      userId: "u_demo_10002",
      studentId: "10002",
      password: "1234",
      name: "นักเรียนทดสอบ 2",
      grade: "6",
      room: "1",
      role: "student",
      active: true
    }
  );
}

let records = [];
const dutyMap = new Map();
const sessions = new Map();

const defaultDuties = [
  { emoji: "🧹", name: "กวาดพื้น", slots: 2 },
  { emoji: "🪣", name: "ถูพื้น", slots: 2 },
  { emoji: "🗑️", name: "ทิ้งขยะ", slots: 1 },
  { emoji: "🧽", name: "เช็ดกระดาน", slots: 1 },
  { emoji: "🪑", name: "จัดโต๊ะเก้าอี้", slots: 2 }
];

function id(prefix = "id") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`;
}

function clean(v = "") {
  return String(v || "").trim();
}

function systemAdmin() {
  return {
    userId: ADMIN_SESSION_ID,
    studentId: ADMIN_ID,
    name: "ผู้ดูแลระบบ",
    grade: "",
    room: "",
    role: "admin",
    active: true
  };
}

function isAdminLogin(loginId) {
  return clean(loginId).toLowerCase() === clean(ADMIN_ID).toLowerCase();
}

function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeDateKey(value) {
  const s = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : todayKey();
}

function roomKey(grade, room) {
  return `g${clean(grade)}-r${clean(room)}`;
}

function roomDutyKey(grade, room) {
  return `${clean(grade)}|${clean(room)}`;
}

function publicUser(u) {
  return {
    userId: u.userId,
    studentId: u.studentId,
    name: u.name,
    grade: u.grade,
    room: u.room,
    role: u.role
  };
}

function createToken(user) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { userId: user.userId, role: user.role, createdAt: Date.now() });
  return token;
}

function auth(token) {
  const s = sessions.get(clean(token));
  if (!s) return null;
  if (s.userId === ADMIN_SESSION_ID || s.role === "admin") return systemAdmin();
  const u = users.find((item) => item.userId === s.userId && item.active !== false && item.role === "student");
  return u || null;
}

function requireAuth(token) {
  const u = auth(token);
  if (!u) throw new Error("กรุณาเข้าสู่ระบบใหม่");
  return u;
}

function requireAdmin(token) {
  const u = requireAuth(token);
  if (u.role !== "admin") throw new Error("ต้องเป็นผู้ดูแลระบบเท่านั้น");
  return u;
}

function getDutiesForRoom(grade, room) {
  const key = roomDutyKey(grade, room);
  if (!dutyMap.has(key)) {
    dutyMap.set(key, defaultDuties.map((d, i) => ({
      dutyId: `d_${clean(grade)}_${clean(room)}_${i + 1}`,
      grade: clean(grade),
      room: clean(room),
      emoji: d.emoji,
      name: d.name,
      slots: d.slots
    })));
  }
  return dutyMap.get(key);
}

function knownRooms() {
  const map = new Map();
  users.filter((u) => u.active !== false && u.role === "student" && u.grade && u.room).forEach((u) => {
    map.set(roomDutyKey(u.grade, u.room), { grade: u.grade, room: u.room });
  });
  dutyMap.forEach((_, key) => {
    const [grade, room] = key.split("|");
    if (grade && room) map.set(key, { grade, room });
  });
  // ให้ห้อง ม.6/1 โผล่ทันทีสำหรับทดสอบ แม้ยังไม่มีใครสมัครเพิ่ม
  map.set(roomDutyKey("6", "1"), { grade: "6", room: "1" });
  return Array.from(map.values()).sort((a, b) => `${a.grade}/${a.room}`.localeCompare(`${b.grade}/${b.room}`, "th", { numeric: true }));
}

function getRecords({ dateKey, grade = "", room = "" } = {}) {
  const d = normalizeDateKey(dateKey);
  return records.filter((r) => {
    if (r.dateKey !== d) return false;
    if (grade && String(r.grade) !== String(grade)) return false;
    if (room && String(r.room) !== String(room)) return false;
    return true;
  });
}

function getUsers({ grade = "", room = "" } = {}) {
  return users.filter((u) => {
    if (u.active === false) return false;
    if (u.role !== "student") return false;
    if (grade && String(u.grade) !== String(grade)) return false;
    if (room && String(u.room) !== String(room)) return false;
    return true;
  });
}

function publicRecord(r) {
  return { ...r };
}

function progressFor(list) {
  const total = list.length;
  const assigned = list.filter((r) => r.status === "assigned" || r.status === "rework").length;
  const submitted = list.filter((r) => r.status === "done").length;
  const reviewed = list.filter((r) => r.status === "reviewed").length;
  const photos = list.filter((r) => !!r.photoUrl).length;
  return {
    total,
    assigned,
    submitted,
    reviewed,
    photos,
    done: submitted + reviewed,
    percent: total ? Math.round(((submitted + reviewed) / total) * 100) : 0
  };
}

function appDataFor(user, params = {}) {
  const dateKey = normalizeDateKey(params.dateKey);
  let grade = clean(params.grade);
  let room = clean(params.room);

  if (user.role !== "admin") {
    grade = clean(user.grade);
    room = clean(user.room);
  }

  const recs = getRecords({ dateKey, grade, room }).map(publicRecord);
  const scopedUsers = getUsers({ grade, room }).map(publicUser);
  const duties = grade && room ? getDutiesForRoom(grade, room) : [];

  return {
    ok: true,
    user: publicUser(user),
    settings: { ...settings },
    rooms: knownRooms(),
    users: scopedUsers,
    records: recs,
    duties,
    progress: progressFor(recs),
    scope: { dateKey, grade, room },
    serverTime: new Date().toISOString()
  };
}

function roomPayload(dateKey, grade, room) {
  const fakeUser = { role: "student", grade: clean(grade), room: clean(room) };
  return appDataFor(fakeUser, { dateKey, grade, room });
}

function emitChange({ dateKey, grade, room, type = "appDataChanged", record = null } = {}) {
  const d = normalizeDateKey(dateKey);
  const g = clean(grade);
  const r = clean(room);
  const payload = roomPayload(d, g, r);
  io.to(roomKey(g, r)).emit("appDataChanged", { type, scope: { dateKey: d, grade: g, room: r }, record, data: payload });
  io.to(roomKey(g, r)).emit("room_progress", payload);
  io.to("admin").emit("appDataChanged", { type, scope: { dateKey: d, grade: g, room: r }, record, data: payload });
  if (type) {
    io.to(roomKey(g, r)).emit(type, record || payload);
    io.to("admin").emit(type, record || payload);
  }
}

function isValidProofImage(photoDataUrl) {
  if (typeof photoDataUrl !== "string") return false;
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(photoDataUrl)) return false;
  const base64 = photoDataUrl.split(",")[1] || "";
  if (base64.length < 10000) return false;
  if (base64.length > 18000000) return false;
  return true;
}

function normalizeCaptureMode(value) {
  const mode = clean(value);
  const allowed = new Set(["mobile_camera", "gallery_upload", "photo_file", "attachment", "camera"]);
  return allowed.has(mode) ? mode : "photo_file";
}

async function handleAction(body = {}) {
  const action = clean(body.action);

  if (action === "login") {
    const loginId = clean(body.loginId || body.studentId || body.username);
    const password = String(body.password || "");

    // แอดมินเป็นบัญชีระบบ ไม่ใช่แถวนักเรียน จึงไม่ถูกสร้าง/แสดงใน users
    if (isAdminLogin(loginId)) {
      if (password !== ADMIN_PASSWORD) throw new Error("รหัสผ่านผู้ดูแลระบบไม่ถูกต้อง");
      const admin = systemAdmin();
      const token = createToken(admin);
      return { ok: true, token, user: publicUser(admin), settings: { ...settings } };
    }

    const studentId = loginId.replace(/\D/g, "");
    const user = users.find((u) => u.active !== false && u.role === "student" && String(u.studentId) === studentId && String(u.password) === password);
    if (!user) throw new Error("เลขประจำตัวหรือรหัสผ่านไม่ถูกต้อง");
    const token = createToken(user);
    return { ok: true, token, user: publicUser(user), settings: { ...settings } };
  }

  if (action === "register") {
    const name = clean(body.name);
    const studentId = clean(body.studentId).replace(/\D/g, "");
    const grade = clean(body.grade);
    const room = clean(body.room);
    const password = String(body.password || "");

    if (!name || !studentId || !grade || !room || !password) throw new Error("กรุณากรอกข้อมูลสมัครให้ครบ");
    if (!/^\d{1,10}$/.test(studentId)) throw new Error("เลขประจำตัวนักเรียนต้องเป็นตัวเลขเท่านั้น");
    if (isAdminLogin(body.studentId || body.loginId || body.username)) throw new Error("เลขประจำตัวนี้ถูกสงวนไว้สำหรับผู้ดูแลระบบ");
    if (users.some((u) => u.active !== false && u.role === "student" && u.studentId === studentId)) throw new Error("เลขประจำตัวนี้มีบัญชีแล้ว");

    const countInRoom = users.filter((u) => u.active !== false && u.role === "student" && u.grade === grade && u.room === room).length;
    if (countInRoom >= Number(settings.maxUsersPerRoom || 60)) throw new Error("ห้องนี้มีสมาชิกครบตามจำนวนที่ตั้งไว้แล้ว");

    const user = {
      userId: id("u"),
      studentId,
      password,
      name,
      grade,
      room,
      role: "student",
      active: true
    };
    users.push(user);
    getDutiesForRoom(grade, room);
    const token = createToken(user);
    emitChange({ dateKey: todayKey(), grade, room, type: "user_registered" });
    return { ok: true, token, user: publicUser(user), settings: { ...settings } };
  }

  if (action === "getAppData") {
    const user = requireAuth(body.token);
    return appDataFor(user, body);
  }

  if (action === "chooseDuty") {
    const user = requireAuth(body.token);
    if (user.role === "admin") throw new Error("แอดมินไม่สามารถเลือกเวรแทนนักเรียนจากหน้านี้ได้");

    const dateKey = normalizeDateKey(body.dateKey);
    const grade = clean(user.grade);
    const room = clean(user.room);
    const dutyId = clean(body.dutyId);
    const customText = clean(body.customText).slice(0, 80);
    if (!dutyId) throw new Error("กรุณาเลือกหน้าที่");

    const roomDuties = getDutiesForRoom(grade, room);
    let duty;
    if (dutyId === "other") {
      if (!customText) throw new Error("กรุณาระบุหน้าที่อื่นๆ");
      duty = {
        dutyId: `custom_${user.userId}_${Date.now()}`,
        grade,
        room,
        emoji: "✍️",
        name: customText,
        slots: 1
      };
    } else {
      duty = roomDuties.find((d) => String(d.dutyId) === String(dutyId));
      if (!duty) throw new Error("ไม่พบหน้าที่ที่เลือก");
    }

    const existing = records.find((r) => r.dateKey === dateKey && r.userId === user.userId);
    if (existing && (existing.status === "done" || existing.status === "reviewed")) {
      throw new Error("ส่งรูปแล้ว ไม่สามารถเปลี่ยนหน้าที่ได้");
    }

    const sameDutyRecords = records.filter((r) => r.dateKey === dateKey && r.grade === grade && r.room === room && r.dutyId === duty.dutyId && (!existing || r.recordId !== existing.recordId));
    if (sameDutyRecords.length >= Number(duty.slots || 1)) throw new Error("หน้าที่นี้เต็มแล้ว");

    const now = new Date().toISOString();
    let record;
    if (existing) {
      existing.dutyId = duty.dutyId;
      existing.dutyName = duty.name;
      existing.emoji = duty.emoji || "📌";
      existing.status = "assigned";
      existing.note = "";
      existing.photoUrl = "";
      existing.submittedAt = "";
      existing.reviewedAt = "";
      existing.updatedAt = now;
      record = existing;
    } else {
      record = {
        recordId: id("rec"),
        dateKey,
        grade,
        room,
        userId: user.userId,
        studentId: user.studentId,
        userName: user.name,
        dutyId: duty.dutyId,
        dutyName: duty.name,
        emoji: duty.emoji || "📌",
        status: "assigned",
        note: "",
        photoUrl: "",
        selectedAt: now,
        submittedAt: "",
        reviewedAt: "",
        updatedAt: now
      };
      records.push(record);
    }

    emitChange({ dateKey, grade, room, type: "duty_selected", record: publicRecord(record) });
    return { ok: true, record: publicRecord(record) };
  }

  if (action === "submitProof") {
    const user = requireAuth(body.token);
    const recordId = clean(body.recordId);
    const note = clean(body.note).slice(0, 300);
    const photoDataUrl = body.photoDataUrl;
    const captureMode = normalizeCaptureMode(body.captureMode);

    if (!isValidProofImage(photoDataUrl)) throw new Error("รูปไม่ถูกต้อง ต้องเป็นไฟล์รูปภาพที่มีขนาดเหมาะสม");

    const record = records.find((r) => r.recordId === recordId);
    if (!record) throw new Error("ไม่พบข้อมูลเวร");
    if (user.role !== "admin" && record.userId !== user.userId) throw new Error("ส่งหลักฐานแทนคนอื่นไม่ได้");
    if (record.status === "done" || record.status === "reviewed") throw new Error("งานนี้ส่งรูปแล้ว ต้องให้แอดมินกดแก้ก่อน");

    const now = new Date().toISOString();
    record.note = note;
    record.photoUrl = photoDataUrl;
    record.status = "done";
    record.captureMode = captureMode;
    record.captureClientAt = clean(body.captureClientAt);
    record.cameraMeta = body.cameraMeta || {};
    record.submittedAt = now;
    record.updatedAt = now;

    emitChange({ dateKey: record.dateKey, grade: record.grade, room: record.room, type: "proof_uploaded", record: publicRecord(record) });
    return { ok: true, record: publicRecord(record) };
  }

  if (action === "approveRecord") {
    requireAdmin(body.token);
    const record = records.find((r) => r.recordId === clean(body.recordId));
    if (!record) throw new Error("ไม่พบรายการเวร");
    if (!record.photoUrl) throw new Error("ยังไม่มีรูปหลักฐาน");
    record.status = "reviewed";
    record.reviewedAt = new Date().toISOString();
    record.updatedAt = record.reviewedAt;
    emitChange({ dateKey: record.dateKey, grade: record.grade, room: record.room, type: "duty_updated_by_admin", record: publicRecord(record) });
    return { ok: true, record: publicRecord(record) };
  }

  if (action === "reworkRecord") {
    requireAdmin(body.token);
    const record = records.find((r) => r.recordId === clean(body.recordId));
    if (!record) throw new Error("ไม่พบรายการเวร");
    record.status = "rework";
    record.updatedAt = new Date().toISOString();
    emitChange({ dateKey: record.dateKey, grade: record.grade, room: record.room, type: "duty_updated_by_admin", record: publicRecord(record) });
    return { ok: true, record: publicRecord(record) };
  }

  if (action === "saveDuties") {
    requireAdmin(body.token);
    const grade = clean(body.grade);
    const room = clean(body.room);
    if (!grade || !room) throw new Error("กรุณาเลือกชั้นและห้องก่อนบันทึกหน้าเวร");
    const duties = Array.isArray(body.duties) ? body.duties : [];
    if (!duties.length) throw new Error("ต้องมีหน้าที่อย่างน้อย 1 รายการ");
    const normalized = duties.map((d, i) => ({
      dutyId: clean(d.dutyId) || `d_${grade}_${room}_${i + 1}`,
      grade,
      room,
      emoji: clean(d.emoji) || "📌",
      name: clean(d.name) || "หน้าที่",
      slots: Math.max(1, Math.min(99, Number(d.slots || 1)))
    }));
    dutyMap.set(roomDutyKey(grade, room), normalized);
    emitChange({ dateKey: todayKey(), grade, room, type: "duties_saved" });
    return { ok: true, duties: normalized };
  }

  if (action === "resetPassword") {
    requireAdmin(body.token);
    const user = users.find((u) => u.userId === clean(body.userId) && u.role === "student");
    if (!user) throw new Error("ไม่พบบัญชีนักเรียน");
    user.password = "1234";
    return { ok: true };
  }

  if (action === "deleteUser") {
    requireAdmin(body.token);
    const user = users.find((u) => u.userId === clean(body.userId) && u.role === "student");
    if (!user) throw new Error("ไม่พบบัญชีนักเรียน");
    user.active = false;
    emitChange({ dateKey: todayKey(), grade: user.grade, room: user.room, type: "user_deleted" });
    return { ok: true };
  }

  if (action === "updateSettings") {
    requireAdmin(body.token);
    const incoming = body.settings || {};
    if (incoming.schoolName !== undefined) settings.schoolName = clean(incoming.schoolName).slice(0, 100) || settings.schoolName;
    ["openHour", "openMinute", "closeHour", "closeMinute", "maxUsersPerRoom"].forEach((key) => {
      if (incoming[key] !== undefined) settings[key] = Number(incoming[key]);
    });
    io.emit("appDataChanged", { type: "settings_updated", scope: {}, data: null });
    return { ok: true, settings: { ...settings } };
  }

  if (action === "resetToday") {
    requireAdmin(body.token);
    const dateKey = normalizeDateKey(body.dateKey);
    const grade = clean(body.grade);
    const room = clean(body.room);
    const removed = [];
    records = records.filter((r) => {
      const match = r.dateKey === dateKey && (!grade || r.grade === grade) && (!room || r.room === room);
      if (match) removed.push(r);
      return !match;
    });
    if (grade && room) emitChange({ dateKey, grade, room, type: "today_reset" });
    else io.to("admin").emit("appDataChanged", { type: "today_reset", scope: { dateKey, grade, room }, data: null });
    return { ok: true, removed: removed.length };
  }

  if (!action) {
    throw new Error("ไม่พบ action ในคำขอ: เว็บอาจยังไม่ได้ส่ง JSON หรือใช้ไฟล์ app.js ตัวเก่า");
  }
  throw new Error("ไม่รู้จัก action: " + action);
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "PPK Duty Node Backend",
    realtime: "Socket.IO ready",
    status: "running",
    api: "Apps Script compatible action API ready",
    version: "4.0.0-no-admin-in-users",
    adminStorage: "system-only"
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, serverTime: new Date().toISOString() });
});

app.post("/", async (req, res) => {
  try {
    const result = await handleAction(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || "เกิดข้อผิดพลาด" });
  }
});

app.post("/api", async (req, res) => {
  try {
    const result = await handleAction(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || "เกิดข้อผิดพลาด" });
  }
});

// REST endpoint เผื่อทดสอบง่าย
app.get("/api/room-progress", (req, res) => {
  const grade = clean(req.query.grade);
  const room = clean(req.query.room);
  const dateKey = normalizeDateKey(req.query.dateKey || req.query.date);
  if (!grade || !room) return res.status(400).json({ ok: false, error: "ต้องระบุ grade และ room" });
  res.json(roomPayload(dateKey, grade, room));
});

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("join_room", (data) => {
    const grade = clean(data && data.grade);
    const room = clean(data && data.room);
    const dateKey = normalizeDateKey(data && data.dateKey || data && data.date);
    if (!grade || !room) return;
    const key = roomKey(grade, room);
    socket.join(key);
    socket.emit("joined_room", { ok: true, roomKey: key, grade, room, dateKey });
    socket.emit("room_progress", roomPayload(dateKey, grade, room));
  });

  socket.on("join_admin", () => {
    socket.join("admin");
    socket.emit("joined_admin", { ok: true });
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`PPK Duty Node Backend running on port ${PORT}`);
});
