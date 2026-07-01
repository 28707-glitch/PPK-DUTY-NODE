const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json({ limit: "15mb" }));

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"]
  }
});

// -----------------------------------------------------------------------------
// Demo in-memory database
// หมายเหตุ: ตัวนี้เอาไว้ทดสอบ Node.js + WebSocket บน Render ก่อน
// ถ้าใช้งานจริง ควรเปลี่ยน duties/users ไปเก็บใน Supabase หรือฐานข้อมูลจริง
// -----------------------------------------------------------------------------

const users = [
  {
    studentId: "10001",
    password: "1234",
    name: "นักเรียนทดสอบ 1",
    grade: 6,
    room: 1,
    role: "student"
  },
  {
    studentId: "10002",
    password: "1234",
    name: "นักเรียนทดสอบ 2",
    grade: 6,
    room: 1,
    role: "student"
  },
  {
    studentId: "admin",
    password: "admin1234",
    name: "Admin",
    grade: null,
    room: null,
    role: "admin"
  }
];

// duties key = `${date}|${grade}|${room}`
// value = array of duty records
const duties = new Map();

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDate(date) {
  return date || todayIsoDate();
}

function roomKey(grade, room) {
  return `g${grade}-r${room}`;
}

function dutyGroupKey(date, grade, room) {
  return `${normalizeDate(date)}|${Number(grade)}|${Number(room)}`;
}

function getDutyList(date, grade, room) {
  const key = dutyGroupKey(date, grade, room);
  if (!duties.has(key)) {
    duties.set(key, []);
  }
  return duties.get(key);
}

function findDuty({ date, grade, room, studentId, dutyName }) {
  const list = getDutyList(date, grade, room);
  return list.find((item) => {
    const sameStudent = String(item.studentId) === String(studentId);
    const sameDuty = String(item.dutyName) === String(dutyName);
    return sameStudent && sameDuty;
  });
}

function calculateProgress(list) {
  const total = list.length;
  const selected = list.filter((item) => item.status === "selected" || item.status === "done").length;
  const done = list.filter((item) => item.status === "done").length;
  const pendingProof = list.filter((item) => item.status === "selected").length;

  return {
    total,
    selected,
    done,
    pendingProof,
    percent: total === 0 ? 0 : Math.round((done / total) * 100)
  };
}

function publicDutyRecord(item) {
  return {
    id: item.id,
    date: item.date,
    grade: item.grade,
    room: item.room,
    studentId: item.studentId,
    studentName: item.studentName,
    dutyName: item.dutyName,
    status: item.status,
    photoUrl: item.photoUrl || "",
    selectedAt: item.selectedAt || "",
    submittedAt: item.submittedAt || "",
    updatedAt: item.updatedAt || ""
  };
}

function emitRoomProgress(date, grade, room) {
  const list = getDutyList(date, grade, room);
  const payload = {
    ok: true,
    date: normalizeDate(date),
    grade: Number(grade),
    room: Number(room),
    progress: calculateProgress(list),
    duties: list.map(publicDutyRecord),
    serverTime: new Date().toISOString()
  };

  io.to(roomKey(grade, room)).emit("room_progress", payload);
  io.to("admin").emit("admin_room_progress", payload);

  return payload;
}

function isValidCameraJpeg(photoDataUrl) {
  if (typeof photoDataUrl !== "string") return false;
  if (!photoDataUrl.startsWith("data:image/jpeg;base64,")) return false;

  const base64 = photoDataUrl.split(",")[1] || "";
  // กันรูปเล็กผิดปกติ และกัน payload ใหญ่เกินไปแบบง่าย ๆ
  if (base64.length < 20000) return false;
  if (base64.length > 12000000) return false;

  return true;
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "PPK Duty Node Backend",
    realtime: "Socket.IO ready",
    status: "running"
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, serverTime: new Date().toISOString() });
});

app.post("/api/login", (req, res) => {
  const { loginId, studentId, username, password } = req.body || {};
  const id = String(loginId || studentId || username || "").trim();
  const pass = String(password || "").trim();

  const user = users.find((item) => {
    return String(item.studentId) === id && String(item.password) === pass;
  });

  if (!user) {
    return res.status(401).json({ ok: false, message: "เลขประจำตัวหรือรหัสผ่านไม่ถูกต้อง" });
  }

  return res.json({
    ok: true,
    user: {
      studentId: user.studentId,
      name: user.name,
      grade: user.grade,
      room: user.room,
      role: user.role
    }
  });
});

app.get("/api/room-progress", (req, res) => {
  const grade = Number(req.query.grade);
  const room = Number(req.query.room);
  const date = normalizeDate(req.query.date);

  if (!grade || !room) {
    return res.status(400).json({ ok: false, message: "ต้องระบุ grade และ room" });
  }

  return res.json(emitRoomProgress(date, grade, room));
});

app.post("/api/select-duty", (req, res) => {
  const { date, grade, room, studentId, studentName, dutyName } = req.body || {};

  if (!grade || !room || !studentId || !studentName || !dutyName) {
    return res.status(400).json({ ok: false, message: "ข้อมูลไม่ครบ" });
  }

  const normalizedDate = normalizeDate(date);
  const list = getDutyList(normalizedDate, grade, room);

  const existingForStudent = list.find((item) => String(item.studentId) === String(studentId));
  if (existingForStudent) {
    return res.status(409).json({
      ok: false,
      message: "นักเรียนคนนี้เลือกเวรแล้ว",
      duty: publicDutyRecord(existingForStudent)
    });
  }

  const existingDutyName = list.find((item) => String(item.dutyName) === String(dutyName));
  if (existingDutyName) {
    return res.status(409).json({
      ok: false,
      message: "หน้าที่นี้มีคนเลือกแล้ว",
      duty: publicDutyRecord(existingDutyName)
    });
  }

  const now = new Date().toISOString();
  const record = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    date: normalizedDate,
    grade: Number(grade),
    room: Number(room),
    studentId: String(studentId),
    studentName: String(studentName),
    dutyName: String(dutyName),
    status: "selected", // selected = รับหน้าที่แล้ว แต่ยังไม่เสร็จ
    photoUrl: "",
    selectedAt: now,
    submittedAt: "",
    updatedAt: now
  };

  list.push(record);

  const payload = emitRoomProgress(normalizedDate, grade, room);
  io.to(roomKey(grade, room)).emit("duty_selected", publicDutyRecord(record));
  io.to("admin").emit("duty_selected", publicDutyRecord(record));

  return res.json({ ok: true, duty: publicDutyRecord(record), room: payload });
});

app.post("/api/submit-proof", (req, res) => {
  const { date, grade, room, studentId, dutyName, captureMode, photoDataUrl } = req.body || {};

  if (!grade || !room || !studentId || !dutyName) {
    return res.status(400).json({ ok: false, message: "ข้อมูลไม่ครบ" });
  }

  if (captureMode !== "camera") {
    return res.status(400).json({ ok: false, message: "ต้องถ่ายรูปจากกล้องเท่านั้น" });
  }

  if (!isValidCameraJpeg(photoDataUrl)) {
    return res.status(400).json({ ok: false, message: "รูปไม่ถูกต้อง ต้องเป็นภาพ JPEG จากกล้อง" });
  }

  const record = findDuty({ date, grade, room, studentId, dutyName });
  if (!record) {
    return res.status(404).json({ ok: false, message: "ยังไม่ได้เลือกเวร หรือไม่พบข้อมูลเวร" });
  }

  if (record.status === "done") {
    return res.status(409).json({ ok: false, message: "งานนี้ส่งรูปแล้ว ต้องให้แอดมินปลดล็อกก่อน" });
  }

  const now = new Date().toISOString();

  // สำหรับตัวทดลองนี้เก็บเป็น data URL ใน memory ก่อน
  // ใช้งานจริงควรอัปโหลดรูปไป Supabase Storage แล้วเก็บ URL แทน
  record.photoUrl = photoDataUrl;
  record.status = "done";
  record.submittedAt = now;
  record.updatedAt = now;

  const payload = emitRoomProgress(record.date, record.grade, record.room);
  io.to(roomKey(record.grade, record.room)).emit("proof_uploaded", publicDutyRecord(record));
  io.to("admin").emit("proof_uploaded", publicDutyRecord(record));

  return res.json({ ok: true, duty: publicDutyRecord(record), room: payload });
});

app.post("/api/admin/unlock-proof", (req, res) => {
  const { adminPassword, date, grade, room, studentId, dutyName } = req.body || {};

  if (adminPassword !== "admin1234") {
    return res.status(403).json({ ok: false, message: "รหัสแอดมินไม่ถูกต้อง" });
  }

  const record = findDuty({ date, grade, room, studentId, dutyName });
  if (!record) {
    return res.status(404).json({ ok: false, message: "ไม่พบข้อมูลเวร" });
  }

  record.status = "selected";
  record.photoUrl = "";
  record.submittedAt = "";
  record.updatedAt = new Date().toISOString();

  const payload = emitRoomProgress(record.date, record.grade, record.room);
  io.to(roomKey(record.grade, record.room)).emit("duty_updated_by_admin", publicDutyRecord(record));
  io.to("admin").emit("duty_updated_by_admin", publicDutyRecord(record));

  return res.json({ ok: true, duty: publicDutyRecord(record), room: payload });
});

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("join_room", (data) => {
    const grade = Number(data?.grade);
    const room = Number(data?.room);
    const date = normalizeDate(data?.date);

    if (!grade || !room) return;

    const key = roomKey(grade, room);
    socket.join(key);
    socket.emit("joined_room", { ok: true, roomKey: key, grade, room, date });
    socket.emit("room_progress", emitRoomProgress(date, grade, room));
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
