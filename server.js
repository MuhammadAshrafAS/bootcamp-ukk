const express = require('express');
const path = require('path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'flowstate.sqlite');

// ─── Initialize SQLite Database ───
// [PANDUAN-ASSESSOR: KONEKSI DATABASE SQLITE] - Kode untuk membuat dan menyambungkan file database flowstate.sqlite
// TIPS PENGUJIAN:
// - Menggunakan built-in Node.js SQLite API (node:sqlite DatabaseSync)
// - File database disimpan secara lokal di: path.join(__dirname, 'flowstate.sqlite')
// - PRAGMA journal_mode = WAL mengaktifkan Write-Ahead Logging untuk konkurensi tinggi & performa baca-tulis optimal
// - PRAGMA foreign_keys = ON menjamin integritas relasi antar tabel (ON DELETE CASCADE)
const db = new DatabaseSync(DB_PATH);

// [PANDUAN-ASSESSOR: STRUKTUR TABEL DATABASE (CREATE TABLE)] - Skema pembuatan tabel users, tasks, subtasks, dan notifications
// TIPS PENGUJIAN:
// - Tabel `users`: menyimpan data pengguna, hash password (PBKDF2 SHA-256), lencana peran, & warna avatar
// - Tabel `sessions`: token autentikasi sesi aktif berbasis Bearer token
// - Tabel `tasks`: kartu tugas (kode TGS-xxx, judul, deskripsi, kolom status: inbox/today/in_progress/completed, prioritas, estimasi, fokus)
// - Tabel `subtasks`: checklist sub-tugas yang berelasi ke tasks(id) dengan ON DELETE CASCADE
// - Tabel `notifications`: riwayat notifikasi cerdas yang terhubung ke tasks(task_code, task_id)
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role_badge TEXT DEFAULT 'Pelajar',
    avatar_color TEXT DEFAULT '#D95D39',
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER DEFAULT 1,
    task_code TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'inbox',
    position INTEGER NOT NULL DEFAULT 0,
    priority TEXT NOT NULL DEFAULT 'sedang',
    category TEXT NOT NULL DEFAULT 'Koding',
    due_date TEXT,
    estimated_minutes INTEGER DEFAULT 0,
    focused_minutes INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS subtasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    is_completed INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    task_code TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Migration: Ensure user_id column exists in tasks if created in previous version
try {
  const taskCols = db.prepare("PRAGMA table_info(tasks)").all();
  const hasUserId = taskCols.some(c => c.name === 'user_id');
  if (!hasUserId) {
    db.exec("ALTER TABLE tasks ADD COLUMN user_id INTEGER DEFAULT 1;");
  }
} catch (e) {
  console.log('[SQLite Migration tasks]', e.message);
}

// Migration: Ensure task_id column exists in notifications
try {
  const notifCols = db.prepare("PRAGMA table_info(notifications)").all();
  const hasTaskId = notifCols.some(c => c.name === 'task_id');
  if (!hasTaskId) {
    db.exec("ALTER TABLE notifications ADD COLUMN task_id INTEGER;");
  }
} catch (e) {
  console.log('[SQLite Migration notifications]', e.message);
}

// ─── Password Helper ───
function hashPassword(pwd) {
  const salt = 'flowstate_salt_2026';
  return crypto.pbkdf2Sync(pwd, salt, 1000, 32, 'sha256').toString('hex');
}

// ─── Pre-seed Default Evaluator Demo Account ───
function ensureEvaluatorAccount() {
  const demoEmail = 'evaluator@flowstate.id';
  let demoUser = db.prepare('SELECT * FROM users WHERE email = ?').get(demoEmail);
  if (!demoUser) {
    const pwdHash = hashPassword('demo123');
    const res = db.prepare(`
      INSERT INTO users (name, email, role_badge, avatar_color, password_hash)
      VALUES (?, ?, ?, ?, ?)
    `).run('Pak Budi (Evaluator UKK)', demoEmail, 'Guru / Evaluator', '#D95D39', pwdHash);
    const userId = Number(res.lastInsertRowid);
    demoUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    console.log('[SQLite] Akun demo evaluator berhasil dibuat:', demoEmail);
  }
  return demoUser;
}

const defaultEvaluator = ensureEvaluatorAccount();

// ─── Indonesian Seed Data ───
const INDO_SEED_TASKS = [
  {
    task_code: 'TGS-101',
    title: 'Merancang skema database & ERD',
    description: 'Analisis kebutuhan entitas relasi untuk sistem bootcamp dan buat diagram ERD konseptual.',
    status: 'inbox',
    position: 0,
    priority: 'rendah',
    category: 'Koding',
    due_date: '2026-11-14',
    estimated_minutes: 45,
    focused_minutes: 0,
    subtasks: [
      { title: 'Tentukan entitas utama & relasi tabel', is_completed: 0 },
      { title: 'Lakukan normalisasi data hingga 3NF', is_completed: 0 },
      { title: 'Review script migrasi & foreign keys', is_completed: 0 }
    ]
  },
  {
    task_code: 'TGS-102',
    title: 'Riset strategi caching API Redis',
    description: 'Bandingkan arsitektur caching in-memory untuk mengurangi latency query database.',
    status: 'inbox',
    position: 1,
    priority: 'sedang',
    category: 'Sekolah',
    due_date: '2026-11-15',
    estimated_minutes: 60,
    focused_minutes: 0,
    subtasks: [
      { title: 'Pelajari pola arsitektur Cache-Aside', is_completed: 0 },
      { title: 'Bandingkan performa Redis vs Memcached', is_completed: 0 },
      { title: 'Tulis draft proposal implementasi caching', is_completed: 0 }
    ]
  },
  {
    task_code: 'TGS-103',
    title: 'Memperbaiki bug autentikasi API',
    description: 'Perbarui middleware otentikasi dengan JWT refresh token dan standardisasi response error.',
    status: 'today',
    position: 0,
    priority: 'tinggi',
    category: 'Koding',
    due_date: '2026-11-12',
    estimated_minutes: 90,
    focused_minutes: 25,
    subtasks: [
      { title: 'Audit celah keamanan alur login saat ini', is_completed: 1 },
      { title: 'Implementasi rotasi refresh token JWT', is_completed: 0 },
      { title: 'Tulis unit test untuk validasi token expired', is_completed: 0 },
      { title: 'Perbarui dokumentasi OpenAPI / Swagger', is_completed: 0 }
    ]
  },
  {
    task_code: 'TGS-104',
    title: 'Menyiapkan slide presentasi proyek',
    description: 'Susun materi presentasi progres aplikasi UKK untuk evaluasi akhir semester.',
    status: 'today',
    position: 1,
    priority: 'tinggi',
    category: 'Pribadi',
    due_date: '2026-11-10',
    estimated_minutes: 60,
    focused_minutes: 15,
    subtasks: [
      { title: 'Rancang kerangka topik & demo alur aplikasi', is_completed: 1 },
      { title: 'Desain template slide & infografis arsitektur', is_completed: 1 },
      { title: 'Sisipkan screenshot antarmuka & diagram database', is_completed: 0 },
      { title: 'Latihan presentasi dan pengaturan durasi waktu', is_completed: 0 }
    ]
  },
  {
    task_code: 'TGS-105',
    title: 'Membuat layout UI responsif',
    description: 'Selesaikan grid CSS sistem modular dan pastikan fleksibilitas layout di semua perangkat.',
    status: 'in_progress',
    position: 0,
    priority: 'sedang',
    category: 'Desain',
    due_date: '2026-11-11',
    estimated_minutes: 120,
    focused_minutes: 50,
    subtasks: [
      { title: 'Atur sistem grid CSS & CSS custom properties', is_completed: 1 },
      { title: 'Konfigurasi breakpoint layar smartphone', is_completed: 1 },
      { title: 'Uji tampilan pada tablet & laptop resolusi tinggi', is_completed: 0 },
      { title: 'Pemeriksaan konsistensi font & spacing', is_completed: 0 }
    ]
  },
  {
    task_code: 'TGS-106',
    title: 'Tulis unit test modul pembayaran',
    description: 'Tingkatkan coverage unit test untuk proses transaksi dan handling error webhook gateway.',
    status: 'completed',
    position: 0,
    priority: 'sedang',
    category: 'Koding',
    due_date: '2026-11-09',
    estimated_minutes: 75,
    focused_minutes: 75,
    subtasks: [
      { title: 'Test skenario pembuatan invoice dan payload', is_completed: 1 },
      { title: 'Test alur callback notifikasi pembayaran sukses', is_completed: 1 },
      { title: 'Test handling kegagalan dan rollback transaksi', is_completed: 1 }
    ]
  }
];

function seedTasksForUser(userId) {
  db.exec('BEGIN TRANSACTION;');
  try {
    const existing = db.prepare('SELECT id FROM tasks WHERE user_id = ?').all(userId);
    for (const t of existing) {
      db.prepare('DELETE FROM subtasks WHERE task_id = ?').run(t.id);
    }
    db.prepare('DELETE FROM tasks WHERE user_id = ?').run(userId);

    const insertTask = db.prepare(`
      INSERT INTO tasks (user_id, task_code, title, description, status, position, priority, category, due_date, estimated_minutes, focused_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSubtask = db.prepare(`
      INSERT INTO subtasks (task_id, title, is_completed)
      VALUES (?, ?, ?)
    `);

    for (const t of INDO_SEED_TASKS) {
      const taskCode = generateNextTaskCode();
      const res = insertTask.run(
        userId,
        taskCode,
        t.title,
        t.description,
        t.status,
        t.position,
        t.priority,
        t.category,
        t.due_date,
        t.estimated_minutes,
        t.focused_minutes
      );
      const taskId = Number(res.lastInsertRowid);
      for (const st of t.subtasks) {
        insertSubtask.run(taskId, st.title, st.is_completed ? 1 : 0);
      }
    }
    db.exec('COMMIT;');
    console.log(`[SQLite] Seed data tugas dimuat untuk user ID: ${userId}`);
  } catch (err) {
    db.exec('ROLLBACK;');
    console.error('[SQLite] Gagal seed tugas user:', err);
  }
}

// ─── Dynamic Indonesian Seed Notifications (Linked to Real User Tasks) ───
function seedNotificationsForUser(userId) {
  try {
    let userTasks = db.prepare('SELECT id, task_code, title, priority, status, estimated_minutes FROM tasks WHERE user_id = ? ORDER BY position ASC, id ASC').all(userId);
    if (!userTasks || userTasks.length === 0) {
      seedTasksForUser(userId);
      userTasks = db.prepare('SELECT id, task_code, title, priority, status, estimated_minutes FROM tasks WHERE user_id = ? ORDER BY position ASC, id ASC').all(userId);
    }

    if (!userTasks || userTasks.length === 0) return;

    // Dynamically match 4 real user tasks
    const tAuth = userTasks.find(t => t.title.toLowerCase().includes('autentikasi'))
      || userTasks.find(t => t.status === 'today')
      || userTasks[2] || userTasks[0];

    const tDb = userTasks.find(t => t.title.toLowerCase().includes('database'))
      || userTasks.find(t => t.priority === 'tinggi')
      || userTasks[0];

    const tAchieve = userTasks.find(t => t.title.toLowerCase().includes('unit test'))
      || userTasks.find(t => t.title.toLowerCase().includes('layout'))
      || userTasks.find(t => t.status === 'completed')
      || userTasks[userTasks.length - 1];

    const tWork = userTasks.find(t => t.title.toLowerCase().includes('slide'))
      || [...userTasks].sort((a, b) => (b.estimated_minutes || 0) - (a.estimated_minutes || 0))[0]
      || userTasks[3] || userTasks[0];

    const notificationsToSeed = [
      {
        type: 'deadline',
        title: '🚨 Tenggat Waktu Mendekat!',
        message: `Tugas "${tAuth.title}" (${tAuth.task_code}) jatuh tempo hari ini. Segera selesaikan sub-tugasnya!`,
        task_code: tAuth.task_code,
        task_id: tAuth.id,
        offset: '-10 minutes'
      },
      {
        type: 'deadline',
        title: '🚨 Prioritas Tinggi Belum Selesai',
        message: `Tugas "${tDb.title}" (${tDb.task_code}) berstatus Prioritas Tinggi dan belum tuntas.`,
        task_code: tDb.task_code,
        task_id: tDb.id,
        offset: '-35 minutes'
      },
      {
        type: 'achievement',
        title: '🏆 Milestone Fokus Tercapai!',
        message: `Kamu telah menyelesaikan sesi fokus untuk tugas "${tAchieve.title}" (${tAchieve.task_code}). Kerja luar biasa!`,
        task_code: tAchieve.task_code,
        task_id: tAchieve.id,
        offset: '-2 hours'
      },
      {
        type: 'workload',
        title: '⚠️ Peringatan Beban Kerja Tinggi',
        message: `Tugas "${tWork.title}" (${tWork.task_code}) berkontribusi pada beban kerja hari ini (>6 jam).`,
        task_code: tWork.task_code,
        task_id: tWork.id,
        offset: '-5 hours'
      }
    ];

    const insertStmt = db.prepare(`
      INSERT INTO notifications (user_id, type, title, message, task_code, task_id, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now', ?))
    `);

    for (const n of notificationsToSeed) {
      insertStmt.run(userId, n.type, n.title, n.message, n.task_code, n.task_id, n.offset);
    }
    console.log(`[SQLite] Seed notifikasi dinamis berhasil dimuat untuk user ID: ${userId}`);
  } catch (err) {
    console.error('[SQLite] Gagal seed notifikasi user:', err);
  }
}

// ─── Auto-Repair & Re-sync Broken Notification Task References ───
function autoRepairUserNotifications(userId) {
  try {
    const userTasks = db.prepare('SELECT id, task_code, title FROM tasks WHERE user_id = ? ORDER BY id ASC').all(userId);
    if (!userTasks || userTasks.length === 0) return;

    const notifs = db.prepare('SELECT id, title, message, task_code, task_id FROM notifications WHERE user_id = ?').all(userId);
    if (!notifs || notifs.length === 0) return;

    const updateStmt = db.prepare(`
      UPDATE notifications
      SET task_code = ?, task_id = ?, message = ?
      WHERE id = ?
    `);

    for (const n of notifs) {
      let matchingTask = userTasks.find(t => t.task_code === n.task_code);
      if (!matchingTask || !n.task_code || !n.task_id) {
        const combined = ((n.title || '') + ' ' + (n.message || '')).toLowerCase();
        matchingTask = userTasks.find(t => combined.includes(t.title.toLowerCase()));

        if (!matchingTask) {
          if (combined.includes('database') || combined.includes('erd')) {
            matchingTask = userTasks.find(t => t.title.toLowerCase().includes('database'));
          } else if (combined.includes('autentikasi') || combined.includes('auth')) {
            matchingTask = userTasks.find(t => t.title.toLowerCase().includes('autentikasi'));
          } else if (combined.includes('presentasi') || combined.includes('slide')) {
            matchingTask = userTasks.find(t => t.title.toLowerCase().includes('slide'));
          } else if (combined.includes('layout') || combined.includes('responsif')) {
            matchingTask = userTasks.find(t => t.title.toLowerCase().includes('layout'));
          } else if (combined.includes('unit test') || combined.includes('pembayaran')) {
            matchingTask = userTasks.find(t => t.title.toLowerCase().includes('pembayaran'));
          } else if (combined.includes('caching') || combined.includes('redis')) {
            matchingTask = userTasks.find(t => t.title.toLowerCase().includes('redis'));
          }
        }

        if (!matchingTask) {
          matchingTask = userTasks[Math.abs(n.id) % userTasks.length];
        }

        if (matchingTask) {
          let updatedMsg = n.message || '';
          if (/TGS-\d+/i.test(updatedMsg)) {
            updatedMsg = updatedMsg.replace(/TGS-\d+/gi, matchingTask.task_code);
          } else if (!updatedMsg.includes(matchingTask.task_code)) {
            updatedMsg += ` (${matchingTask.task_code})`;
          }
          updateStmt.run(matchingTask.task_code, matchingTask.id, updatedMsg, n.id);
        }
      }
    }
  } catch (err) {
    console.error('[SQLite] Gagal auto-repair notifikasi:', err);
  }
}

// Initial seed for default user if empty
const countRow = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE user_id = ?').get(defaultEvaluator.id);
if (countRow.count === 0) {
  seedTasksForUser(defaultEvaluator.id);
}

const notifCountRow = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ?').get(defaultEvaluator.id);
if (notifCountRow.count === 0) {
  seedNotificationsForUser(defaultEvaluator.id);
} else {
  autoRepairUserNotifications(defaultEvaluator.id);
}

// ─── Middleware ───
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Auth Middleware: extracts user from Bearer token
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
  let token = null;

  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else {
      token = authHeader.trim();
    }
  }

  if (token) {
    const session = db.prepare(`
      SELECT sessions.token, users.id, users.name, users.email, users.role_badge, users.avatar_color
      FROM sessions
      JOIN users ON sessions.user_id = users.id
      WHERE sessions.token = ?
    `).get(token);

    if (session) {
      req.user = session;
      return next();
    }
  }

  // Fallback to demo evaluator if no auth provided (to maintain backwards compatibility)
  req.user = defaultEvaluator;
  next();
}

// ─── Helper Functions ───
function getAllTasksWithSubtasks(userId, hasRetried = false) {
  const tasks = db.prepare(`
    SELECT * FROM tasks WHERE user_id = ? ORDER BY status, position ASC, id ASC
  `).all(userId);

  if (tasks.length === 0 && !hasRetried) {
    // Auto-seed for this user so their board is never empty
    seedTasksForUser(userId);
    return getAllTasksWithSubtasks(userId, true);
  }

  const subtasks = db.prepare(`
    SELECT subtasks.* FROM subtasks
    JOIN tasks ON subtasks.task_id = tasks.id
    WHERE tasks.user_id = ?
    ORDER BY subtasks.id ASC
  `).all(userId);

  const subtaskMap = new Map();
  for (const st of subtasks) {
    if (!subtaskMap.has(st.task_id)) {
      subtaskMap.set(st.task_id, []);
    }
    subtaskMap.get(st.task_id).push({
      id: st.id,
      task_id: st.task_id,
      title: st.title,
      is_completed: Boolean(st.is_completed)
    });
  }

  return tasks.map(t => ({
    id: t.id,
    task_code: t.task_code,
    title: t.title,
    description: t.description || '',
    status: t.status,
    position: t.position,
    priority: t.priority,
    category: t.category,
    due_date: t.due_date,
    estimated_minutes: t.estimated_minutes,
    focused_minutes: t.focused_minutes,
    created_at: t.created_at,
    subtasks: subtaskMap.get(t.id) || []
  }));
}

function generateNextTaskCode(userId) {
  const codes = db.prepare("SELECT task_code FROM tasks WHERE task_code LIKE 'TGS-%'").all();
  let maxNum = 100;
  for (const row of codes) {
    const match = row.task_code.match(/^TGS-(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  return `TGS-${maxNum + 1}`;
}

// ══════════════════════════════════════════════════
//  AUTH API ROUTES
// ══════════════════════════════════════════════════

// [PANDUAN-ASSESSOR: FITUR LOGIN & REGISTER (AUTH API)] - Logika pengecekan akun login, enkripsi/validasi password, dan pembuatan akun baru
// TIPS PENGUJIAN:
// - POST /api/auth/register : Enkripsi password dengan crypto.pbkdf2Sync(sha256), simpan ke tabel `users`, dan buat token sesi di `sessions`
// - POST /api/auth/login    : Cek kecocokan email dan hash password di SQLite, kembalikan Bearer token
// - POST /api/auth/demo-login: Mode Instan 1-klik untuk akun Pak Budi (Evaluator UKK) tanpa ketik password
// - GET /api/auth/me        : Validasi token sesi aktif yang dikirim dari browser
// - POST /api/auth/logout   : Menghapus token dari tabel `sessions`
// POST /api/auth/register — Pendaftaran Pengguna Baru
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, role_badge = 'Pelajar', avatar_color = '#D95D39' } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Nama lengkap wajib diisi.' });
  }
  if (!email || !email.trim()) {
    return res.status(400).json({ success: false, error: 'Email wajib diisi.' });
  }
  if (!password || password.length < 4) {
    return res.status(400).json({ success: false, error: 'Kata sandi minimal 4 karakter.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) {
    return res.status(400).json({ success: false, error: 'Email ini sudah terdaftar. Silakan masuk.' });
  }

  try {
    const pwdHash = hashPassword(password);
    const insertUser = db.prepare(`
      INSERT INTO users (name, email, role_badge, avatar_color, password_hash)
      VALUES (?, ?, ?, ?, ?)
    `).run(name.trim(), cleanEmail, role_badge, avatar_color, pwdHash);

    const userId = Number(insertUser.lastInsertRowid);

    // Auto-seed Indonesian tasks for new user
    seedTasksForUser(userId);
    seedNotificationsForUser(userId);

    // Create session token
    const token = crypto.randomUUID();
    db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);

    const user = {
      id: userId,
      name: name.trim(),
      email: cleanEmail,
      role_badge,
      avatar_color
    };

    res.status(201).json({
      success: true,
      message: 'Pendaftaran berhasil.',
      token,
      user
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/auth/login — Masuk Akun
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email dan kata sandi wajib diisi.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

  if (!user || user.password_hash !== hashPassword(password)) {
    return res.status(401).json({ success: false, error: 'Email atau kata sandi tidak cocok.' });
  }

  const token = crypto.randomUUID();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);

  res.json({
    success: true,
    message: 'Berhasil masuk.',
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role_badge: user.role_badge,
      avatar_color: user.avatar_color
    }
  });
});

// POST /api/auth/demo-login — 1-Click Instant Evaluator Login
app.post('/api/auth/demo-login', (req, res) => {
  const demoUser = ensureEvaluatorAccount();
  const token = crypto.randomUUID();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, demoUser.id);

  res.json({
    success: true,
    message: 'Masuk sebagai akun demo evaluator.',
    token,
    user: {
      id: demoUser.id,
      name: demoUser.name,
      email: demoUser.email,
      role_badge: demoUser.role_badge,
      avatar_color: demoUser.avatar_color
    }
  });
});

// GET /api/auth/me — Periksa Sesi Pengguna
app.get('/api/auth/me', authMiddleware, (req, res) => {
  if (req.user) {
    res.json({
      success: true,
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role_badge: req.user.role_badge,
        avatar_color: req.user.avatar_color
      }
    });
  } else {
    res.status(401).json({ success: false, error: 'Belum masuk.' });
  }
});

// POST /api/auth/logout — Keluar Akun
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  res.json({ success: true, message: 'Berhasil keluar.' });
});

// ══════════════════════════════════════════════════
//  TASK API ROUTES (PER-USER SQLITE FILTERED)
// ══════════════════════════════════════════════════

// [PANDUAN-ASSESSOR: CRUD TUGAS (TAMBAH, BACA, EDIT, HAPUS)] - Endpoint REST API untuk mengambil, menyimpan, mengubah, dan menghapus tugas di SQLite
// TIPS PENGUJIAN:
// - READ  : GET /api/tasks          -> Mengambil seluruh tugas milik user aktif beserta checklist sub-tugasnya
// - CREATE: POST /api/tasks         -> Menambahkan tugas baru dengan auto-increment kode TGS-xxx dan menyimpan sub-tugas dalam satu transaksi
// - UPDATE: PUT /api/tasks/:id      -> Memperbarui data judul, deskripsi, kolom status, prioritas, tenggat, dan sub-tugas
// - DELETE: DELETE /api/tasks/:id   -> Menghapus tugas dari tabel `tasks` (sub-tugas otomatis terhapus via CASCADE)
// GET /api/tasks — Ambil tugas user saat ini
app.get('/api/tasks', authMiddleware, (req, res) => {
  try {
    const tasks = getAllTasksWithSubtasks(req.user.id);
    res.json({ success: true, tasks, user: req.user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/tasks — Tambah tugas baru
app.post('/api/tasks', authMiddleware, (req, res) => {
  const {
    title,
    description = '',
    status = 'inbox',
    priority = 'sedang',
    category = 'Koding',
    due_date = null,
    estimated_minutes = 0,
    subtasks = []
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ success: false, error: 'Judul tugas wajib diisi.' });
  }

  try {
    db.exec('BEGIN TRANSACTION;');

    const task_code = generateNextTaskCode(req.user.id);

    const posRow = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 as nextPos FROM tasks WHERE user_id = ? AND status = ?').get(req.user.id, status);
    const position = posRow ? posRow.nextPos : 0;

    const insertTask = db.prepare(`
      INSERT INTO tasks (user_id, task_code, title, description, status, position, priority, category, due_date, estimated_minutes, focused_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    const result = insertTask.run(
      req.user.id,
      task_code,
      title.trim(),
      description.trim(),
      status,
      position,
      priority,
      category,
      due_date || null,
      parseInt(estimated_minutes, 10) || 0
    );

    const taskId = Number(result.lastInsertRowid);

    if (Array.isArray(subtasks) && subtasks.length > 0) {
      const insertSub = db.prepare(`
        INSERT INTO subtasks (task_id, title, is_completed)
        VALUES (?, ?, ?)
      `);
      for (const st of subtasks) {
        if (st.title && st.title.trim()) {
          insertSub.run(taskId, st.title.trim(), st.is_completed ? 1 : 0);
        }
      }
    }

    db.exec('COMMIT;');

    const createdTask = getAllTasksWithSubtasks(req.user.id).find(t => t.id === taskId);
    res.status(201).json({ success: true, task: createdTask });
  } catch (err) {
    db.exec('ROLLBACK;');
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/tasks/:id — Update detail tugas & sinkronisasi sub-tugas
app.put('/api/tasks/:id', authMiddleware, (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  const {
    title,
    description = '',
    status,
    priority,
    category,
    due_date = null,
    estimated_minutes = 0,
    focused_minutes,
    subtasks = []
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ success: false, error: 'Judul tugas wajib diisi.' });
  }

  try {
    db.exec('BEGIN TRANSACTION;');

    const currentTask = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, req.user.id);
    if (!currentTask) {
      db.exec('ROLLBACK;');
      return res.status(404).json({ success: false, error: 'Tugas tidak ditemukan.' });
    }

    const newStatus = status || currentTask.status;
    const newFocused = typeof focused_minutes === 'number' ? focused_minutes : currentTask.focused_minutes;

    db.prepare(`
      UPDATE tasks
      SET title = ?, description = ?, status = ?, priority = ?, category = ?, due_date = ?, estimated_minutes = ?, focused_minutes = ?
      WHERE id = ? AND user_id = ?
    `).run(
      title.trim(),
      description.trim(),
      newStatus,
      priority || currentTask.priority,
      category || currentTask.category,
      due_date || null,
      parseInt(estimated_minutes, 10) || 0,
      newFocused,
      taskId,
      req.user.id
    );

    // Update sub-tugas
    db.prepare('DELETE FROM subtasks WHERE task_id = ?').run(taskId);

    if (Array.isArray(subtasks) && subtasks.length > 0) {
      const insertSub = db.prepare(`
        INSERT INTO subtasks (task_id, title, is_completed)
        VALUES (?, ?, ?)
      `);
      for (const st of subtasks) {
        if (st.title && st.title.trim()) {
          insertSub.run(taskId, st.title.trim(), st.is_completed ? 1 : 0);
        }
      }
    }

    db.exec('COMMIT;');

    const updatedTask = getAllTasksWithSubtasks(req.user.id).find(t => t.id === taskId);
    res.json({ success: true, task: updatedTask });
  } catch (err) {
    db.exec('ROLLBACK;');
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/tasks/:id — Hapus tugas
app.delete('/api/tasks/:id', authMiddleware, (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  try {
    db.exec('BEGIN TRANSACTION;');
    db.prepare('DELETE FROM subtasks WHERE task_id = ?').run(taskId);
    const result = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(taskId, req.user.id);
    db.exec('COMMIT;');

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Tugas tidak ditemukan.' });
    }
    res.json({ success: true, message: 'Tugas berhasil dihapus.' });
  } catch (err) {
    db.exec('ROLLBACK;');
    res.status(500).json({ success: false, error: err.message });
  }
});

// [PANDUAN-ASSESSOR: SIMPAN POSISI DRAG & DROP KE DATABASE] - Endpoint PATCH /api/tasks/reorder untuk memperbarui kolom status dan urutan posisi kartu di SQLite
// TIPS PENGUJIAN:
// - Dipanggil setiap kali kartu selesai digeser oleh SortableJS di frontend
// - Menggunakan transaksi SQLite (BEGIN TRANSACTION ... COMMIT) sehingga batch update posisi 100% atomik & cepat
// - Memperbarui kolom `status` (inbox, today, in_progress, completed) dan `position` (indeks urutan kartu vertikal)
// PATCH /api/tasks/reorder — Drag & Drop sinkronisasi status kolom dan urutan posisi
app.patch('/api/tasks/reorder', authMiddleware, (req, res) => {
  const { updates } = req.body;
  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ success: false, error: 'Daftar pembaruan posisi kosong.' });
  }

  try {
    db.exec('BEGIN TRANSACTION;');
    const updateStmt = db.prepare(`
      UPDATE tasks
      SET status = ?, position = ?
      WHERE id = ? AND user_id = ?
    `);

    for (const item of updates) {
      if (item.id != null && item.status != null && item.position != null) {
        updateStmt.run(item.status, parseInt(item.position, 10), parseInt(item.id, 10), req.user.id);
      }
    }

    db.exec('COMMIT;');
    res.json({ success: true, message: 'Urutan tugas berhasil diperbarui.' });
  } catch (err) {
    db.exec('ROLLBACK;');
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/subtasks/:id/toggle — Centang / uncentang sub-tugas
app.patch('/api/subtasks/:id/toggle', authMiddleware, (req, res) => {
  const subtaskId = parseInt(req.params.id, 10);
  const { is_completed } = req.body;

  try {
    const val = is_completed ? 1 : 0;
    const result = db.prepare('UPDATE subtasks SET is_completed = ? WHERE id = ?').run(val, subtaskId);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Sub-tugas tidak ditemukan.' });
    }
    res.json({ success: true, is_completed: Boolean(val) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/tasks/:id/focus — Catat waktu Pomodoro
app.patch('/api/tasks/:id/focus', authMiddleware, (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  const { minutes = 25 } = req.body;

  try {
    const result = db.prepare(`
      UPDATE tasks
      SET focused_minutes = focused_minutes + ?
      WHERE id = ? AND user_id = ?
    `).run(parseInt(minutes, 10) || 0, taskId, req.user.id);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Tugas tidak ditemukan.' });
    }

    const updated = db.prepare('SELECT focused_minutes FROM tasks WHERE id = ?').get(taskId);
    res.json({ success: true, focused_minutes: updated.focused_minutes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════
//  NOTIFICATION API ROUTES (SQLITE NOTIFICATIONS)
// ══════════════════════════════════════════════════

// GET /api/notifications — Ambil notifikasi user
app.get('/api/notifications', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const count = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ?').get(userId).count;
    if (count === 0) {
      seedNotificationsForUser(userId);
    } else {
      // Auto-repair any broken/null task references for existing users
      autoRepairUserNotifications(userId);
    }

    const notifications = db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 50
    `).all(userId);

    const unreadCount = db.prepare(`
      SELECT COUNT(*) as count FROM notifications
      WHERE user_id = ? AND is_read = 0
    `).get(userId).count;

    res.json({
      success: true,
      unread_count: unreadCount,
      notifications
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/notifications — Buat notifikasi baru
app.post('/api/notifications', authMiddleware, (req, res) => {
  const { type = 'system', title, message, task_code = null, task_id = null } = req.body;
  if (!title || !message) {
    return res.status(400).json({ success: false, error: 'Judul dan pesan notifikasi wajib diisi.' });
  }

  try {
    let resolvedCode = task_code;
    let resolvedId = task_id;
    if (resolvedId && !resolvedCode) {
      const t = db.prepare('SELECT task_code FROM tasks WHERE id = ?').get(resolvedId);
      if (t) resolvedCode = t.task_code;
    } else if (resolvedCode && !resolvedId) {
      const t = db.prepare('SELECT id FROM tasks WHERE task_code = ?').get(resolvedCode);
      if (t) resolvedId = t.id;
    }

    const result = db.prepare(`
      INSERT INTO notifications (user_id, type, title, message, task_code, task_id, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
    `).run(req.user.id, type, title, message, resolvedCode || null, resolvedId || null);

    const notifId = Number(result.lastInsertRowid);
    const newNotif = db.prepare('SELECT * FROM notifications WHERE id = ?').get(notifId);
    const unreadCount = db.prepare(`
      SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0
    `).get(req.user.id).count;

    res.status(201).json({
      success: true,
      unread_count: unreadCount,
      notification: newNotif
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/notifications/read-all — Tandai semua dibaca
app.patch('/api/notifications/read-all', authMiddleware, (req, res) => {
  try {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ success: true, message: 'Semua notifikasi ditandai dibaca.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/notifications/:id/read — Tandai 1 dibaca
app.patch('/api/notifications/:id/read', authMiddleware, (req, res) => {
  const notifId = parseInt(req.params.id, 10);
  try {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(notifId, req.user.id);
    const unreadCount = db.prepare(`
      SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0
    `).get(req.user.id).count;
    res.json({ success: true, unread_count: unreadCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/notifications/clear — Bersihkan riwayat notifikasi
app.delete('/api/notifications/clear', authMiddleware, (req, res) => {
  try {
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
    res.json({ success: true, message: 'Riwayat notifikasi berhasil dibersihkan.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/reset — Reset data demo Bahasa Indonesia ke SQLite
app.post('/api/reset', authMiddleware, (req, res) => {
  try {
    seedTasksForUser(req.user.id);
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
    seedNotificationsForUser(req.user.id);
    const tasks = getAllTasksWithSubtasks(req.user.id);
    res.json({ success: true, message: 'Data demo & notifikasi berhasil direset ke SQLite.', tasks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/health — Status backend & database
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: 'flowstate.sqlite', engine: 'SQLite3' });
});

// ─── Start Server ───
app.listen(PORT, () => {
  console.log(`[FlowState Studio] Server aktif di http://localhost:${PORT}`);
  console.log(`[FlowState Studio] Database SQLite: ${DB_PATH}`);
});
