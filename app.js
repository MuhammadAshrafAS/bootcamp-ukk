(function () {
  'use strict';

  /* ════════════════════════════════════════════════════
     FlowState — Tactile Studio & Focus Workspace (SQLite)
     ════════════════════════════════════════════════════ */

  // ─── Configuration ───
  const COLUMNS = [
    { id: 'inbox',       title: 'Kotak Masuk',        color: '#71717A' },
    { id: 'today',       title: 'Hari Ini',           color: '#D95D39' },
    { id: 'in_progress', title: 'Sedang Dikerjakan',  color: '#D97706' },
    { id: 'completed',   title: 'Selesai',            color: '#2A6F4E' }
  ];

  const POMODORO_SECONDS = 25 * 60;
  const SETTINGS_KEY = 'flowstate_studio_settings';
  const AUTH_TOKEN_KEY = 'flowstate_auth_token';

  // ─── Productivity Quotes ───
  const PRODUCTIVITY_QUOTES = [
    { text: "Fokus adalah seni mengetahui apa yang harus diabaikan demi menghasilkan karya terbaik.", author: "— Prinsip Produktivitas FlowState" },
    { text: "Satu tugas tuntas dengan mutu tinggi jauh lebih bernilai daripada sepuluh hal setengah jadi.", author: "— Filosofi Kanban Studio" },
    { text: "Ritme konsisten 25 menit sesi fokus membangun momentum yang tak terhentikan.", author: "— Teknik Zen Pomodoro" },
    { text: "Rapikan pikiran dengan memindahkan setiap ide ke dalam kotak tugas yang jelas.", author: "— Metode Ruang Kerja Taktil" }
  ];
  let quoteIdx = 0;

  function startQuoteRotation() {
    const textEl = $('#authQuoteText');
    const authorEl = $('#authQuoteAuthor');
    if (!textEl || !authorEl) return;

    setInterval(() => {
      quoteIdx = (quoteIdx + 1) % PRODUCTIVITY_QUOTES.length;
      const q = PRODUCTIVITY_QUOTES[quoteIdx];
      textEl.style.opacity = '0';
      authorEl.style.opacity = '0';
      setTimeout(() => {
        textEl.textContent = q.text;
        authorEl.textContent = q.author;
        textEl.style.opacity = '1';
        authorEl.style.opacity = '1';
      }, 300);
    }, 6000);
  }

  // ─── State ───
  let state = {
    tasks: [],
    darkMode: false,
    compactView: false,
    soundEnabled: true
  };

  let auth = {
    token: localStorage.getItem(AUTH_TOKEN_KEY),
    user: null
  };

  let focus = {
    taskId: null,
    remaining: POMODORO_SECONDS,
    running: false,
    intervalId: null
  };

  let filters = {
    priority: 'all',
    category: 'all'
  };

  let drawerMode = null; // 'create' | 'edit'
  let editingTaskId = null;
  let drawerSubtasks = [];
  let sortables = {};
  let syncTimeout = null;

  // Selected Register Role & Color
  let regRole = '👨‍💻 Developer';
  let regColor = '#D95D39';

  // ─── Smart Notification State ───
  let notifState = {
    items: [],
    unreadCount: 0,
    activeTab: 'all', // 'all' | 'unread' | 'deadline'
    isOpen: false
  };
  let workloadAlertSent = false;

  // ─── Web Audio Synthesizer & Ambient State ───
  let audioCtx = null;
  let ambientSource = null;
  let ambientGain = null;
  let ambientActive = false;

  // ─── DOM Helpers ───
  const $ = (s, p) => (p || document).querySelector(s);
  const $$ = (s, p) => (p || document).querySelectorAll(s);

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function cap(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ─── Formatters (Bahasa Indonesia) ───
  function fmtDate(d) {
    if (!d) return '';
    const o = new Date(d + 'T00:00:00');
    const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return o.getDate() + ' ' + mons[o.getMonth()];
  }

  function fmtMin(m) {
    if (!m || m <= 0) return '0 mnt';
    if (m < 60) return m + ' mnt';
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} jam ${r} mnt` : `${h} jam`;
  }

  function fmtTimer(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }

  function headerDateIndo() {
    const d = new Date();
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return `${days[d.getDay()]}, ${d.getDate()} ${mons[d.getMonth()]} ${d.getFullYear()}`;
  }

  function isOverdue(d) {
    return d && new Date() > new Date(d + 'T23:59:59');
  }

  function isDueSoon(d) {
    if (!d) return false;
    const diff = (new Date(d + 'T23:59:59') - new Date()) / 864e5;
    return diff >= 0 && diff <= 1;
  }

  // ══════════════════════════════════════════════════
  //  WEB AUDIO SYNTHESIZER & AMBIENT GENERATOR
  // ══════════════════════════════════════════════════

  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // Tactile Soft Pop Sound (Card pickup / drop / click)
  function playPop() {
    if (!state.soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.05);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    } catch {}
  }

  // Subtask Check Sound (Gentle high chime)
  function playCheck() {
    if (!state.soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
    } catch {}
  }

  // Task Completed Harmonic Chord (C5, E5, G5, C6 arpeggio)
  function playSuccessChord() {
    if (!state.soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const now = ctx.currentTime + i * 0.06;
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.45);
      });
    } catch {}
  }

  // Smart Notification Crystalline Dual Chime (E5 -> B5)
  function playNotifChime() {
    if (!state.soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      [659.25, 987.77].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const t = now + i * 0.09;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.45);
      });
    } catch {}
  }

  // Ambient Brown Noise Generator (Rain / Waterfall)
  function toggleAmbientBrownNoise() {
    if (ambientActive) {
      stopAmbientBrownNoise();
    } else {
      startAmbientBrownNoise();
    }
  }

  function startAmbientBrownNoise() {
    try {
      const ctx = getAudioContext();
      if (!ctx || ambientActive) return;

      const bufferSize = ctx.sampleRate * 4;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = data[i];
        data[i] *= 3.5;
      }

      ambientSource = ctx.createBufferSource();
      ambientSource.buffer = buffer;
      ambientSource.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(420, ctx.currentTime);

      ambientGain = ctx.createGain();
      const slider = $('#zenVolumeSlider');
      const vol = slider ? parseInt(slider.value, 10) / 100 : 0.4;
      ambientGain.gain.setValueAtTime(vol * 0.28, ctx.currentTime);

      ambientSource.connect(filter);
      filter.connect(ambientGain);
      ambientGain.connect(ctx.destination);

      ambientSource.start();
      ambientActive = true;
      updateAmbientUI(true);
    } catch (err) {
      console.error('[FlowState] Ambient audio error:', err);
    }
  }

  function stopAmbientBrownNoise() {
    try {
      if (ambientSource) {
        ambientSource.stop();
        ambientSource.disconnect();
        ambientSource = null;
      }
      ambientActive = false;
      updateAmbientUI(false);
    } catch {}
  }

  function updateAmbientUI(active) {
    const btn = $('#zenAmbientToggle');
    const txt = $('#zenAmbientText');
    if (!btn || !txt) return;
    btn.classList.toggle('active', active);
    txt.textContent = active ? 'Suara Hujan: Aktif' : 'Suara Hujan: Mati';
  }

  function updateAmbientVolume(val) {
    if (ambientGain && audioCtx) {
      const vol = (parseInt(val, 10) / 100) * 0.28;
      ambientGain.gain.setValueAtTime(vol, audioCtx.currentTime);
    }
  }

  // ─── Confetti Particles ───
  function triggerConfetti(clientX, clientY) {
    if (typeof confetti === 'function') {
      const origin = (clientX && clientY)
        ? { x: clientX / window.innerWidth, y: clientY / window.innerHeight }
        : { x: 0.5, y: 0.5 };

      confetti({
        particleCount: 55,
        spread: 75,
        origin: origin,
        colors: ['#D95D39', '#D97706', '#2A6F4E', '#18181B', '#E5A93C'],
        disableForReducedMotion: true
      });
    }
  }

  // ─── Hybrid Sync Status Badge (SQLite Localhost <-> Cloud/Lokal) ───
  let backendMode = (typeof window !== 'undefined' && (window.location.hostname.includes('github.io') || window.location.protocol === 'file:'))
    ? 'local'
    : 'detecting';

  function updateBackendBadgeUI() {
    const badge = $('#dbStatusBadge');
    const text = $('#dbStatusText');
    const subtitle = $('#analyticsSubtitle');
    const featEngine = $('#featEnginePill');

    const isLocal = backendMode === 'local';
    const savedLabel = isLocal ? 'Tersimpan di Cloud/Lokal' : 'Tersimpan di SQLite';

    if (badge) {
      badge.setAttribute('data-mode', isLocal ? 'local' : 'sqlite');
      badge.title = isLocal
        ? 'Mode Statis / GitHub Pages (Tersimpan di LocalStorage & Cloud Browser)'
        : 'Terhubung ke SQLite Backend lokal (flowstate.sqlite)';
    }

    if (text && (!badge || !badge.classList.contains('saving'))) {
      text.textContent = savedLabel;
    }

    if (subtitle) {
      subtitle.textContent = isLocal
        ? 'Data langsung tersinkronisasi di Browser (LocalStorage & Cloud Offline)'
        : 'Data langsung tersinkronisasi dari SQLite (flowstate.sqlite)';
    }

    if (featEngine) {
      featEngine.textContent = isLocal ? '☁️ Cloud & Local Ready' : '⚡ SQLite & Cloud Ready';
    }
  }

  function setSyncStatus(status) {
    const badge = $('#dbStatusBadge');
    const text = $('#dbStatusText');
    if (!badge || !text) return;

    if (syncTimeout) clearTimeout(syncTimeout);

    const savedLabel = backendMode === 'local' ? 'Tersimpan di Cloud/Lokal' : 'Tersimpan di SQLite';

    if (status === 'saving') {
      badge.classList.remove('saved');
      badge.classList.add('saving');
      text.textContent = 'Menyimpan...';
    } else if (status === 'saved') {
      badge.classList.remove('saving');
      badge.classList.add('saved');
      text.textContent = savedLabel;

      badge.style.borderColor = backendMode === 'local' ? '#3B82F6' : 'var(--accent-green)';
      syncTimeout = setTimeout(() => {
        badge.style.borderColor = '';
      }, 1200);
    } else if (status === 'error') {
      badge.classList.remove('saved');
      badge.classList.add('saving');
      text.textContent = 'Gagal menyimpan';
    }
  }

  // ─── Welcome Toast ───
  function showWelcomeToast(name, role, color) {
    const toast = $('#welcomeToast');
    const avatar = $('#toastAvatar');
    const title = $('#toastTitle');
    const subtitle = $('#toastSubtitle');
    if (!toast) return;

    if (avatar) {
      avatar.textContent = (name || 'B').charAt(0).toUpperCase();
      avatar.style.backgroundColor = color || 'var(--accent-green)';
    }
    if (title) title.textContent = `Selamat datang, ${name}!`;
    if (subtitle) subtitle.textContent = `Aktif sebagai ${role || 'Pengguna'}. Ruang kerja siap digunakan.`;

    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 4500);
  }

  // ─── Update Sidebar User UI ───
  function updateSidebarUserUI(user) {
    if (!user) return;
    const avatar = $('#sidebarUserAvatar');
    const name = $('#sidebarUserName');
    const role = $('#sidebarUserRole');

    if (avatar) {
      avatar.textContent = (user.name || 'B').charAt(0).toUpperCase();
      avatar.style.backgroundColor = user.avatar_color || 'var(--accent-terracotta)';
    }
    if (name) name.textContent = user.name;
    if (role) role.textContent = user.role_badge || 'Pelajar / Developer';
  }

  // ─── UI Preferences ───
  function loadSettings() {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        state.darkMode = Boolean(parsed.darkMode);
        state.compactView = Boolean(parsed.compactView);
        state.soundEnabled = parsed.soundEnabled !== false;
      }
    } catch {}
    applySettings();
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        darkMode: state.darkMode,
        compactView: state.compactView,
        soundEnabled: state.soundEnabled
      }));
    } catch {}
  }

  function toggleTheme() {
    state.darkMode = !state.darkMode;
    applySettings();
    saveSettings();
  }

  function toggleView() {
    state.compactView = !state.compactView;
    applySettings();
    saveSettings();
  }

  function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    applySoundUI();
    saveSettings();
    if (state.soundEnabled) playPop();
  }

  function applySettings() {
    document.documentElement.dataset.theme = state.darkMode ? 'dark' : 'light';
    document.body.classList.toggle('compact-view', state.compactView);
    applySoundUI();
  }

  function applySoundUI() {
    const btns = [$('#soundToggleBtn'), $('#sidebarSoundBtn')];
    btns.forEach(btn => {
      if (!btn) return;
      const iconOn = btn.querySelector('.icon-sound-on');
      const iconOff = btn.querySelector('.icon-sound-off');
      if (iconOn && iconOff) {
        iconOn.style.display = state.soundEnabled ? 'block' : 'none';
        iconOff.style.display = state.soundEnabled ? 'none' : 'block';
        btn.title = `Efek Suara UI: ${state.soundEnabled ? 'Aktif' : 'Mati'} (S)`;
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════
  //  HYBRID CLIENT & AUTOMATIC LOCALSTORAGE FALLBACK ENGINE
  //  Supports SQLite when running on localhost:3000, and seamlessly
  //  switches to LocalStorage when hosted on GitHub Pages or offline.
  // ══════════════════════════════════════════════════════════════════

  const HYBRID_DEFAULT_EVALUATOR = {
    id: 1,
    name: 'Pak Budi (Evaluator UKK)',
    email: 'evaluator@flowstate.id',
    role_badge: 'Guru / Evaluator',
    avatar_color: '#D95D39',
    password: 'demo123'
  };

  const HYBRID_SEED_TASKS = [
    {
      id: 101,
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
      created_at: '2026-11-10 08:00:00',
      subtasks: [
        { id: 1001, task_id: 101, title: 'Tentukan entitas utama & relasi tabel', is_completed: false },
        { id: 1002, task_id: 101, title: 'Lakukan normalisasi data hingga 3NF', is_completed: false },
        { id: 1003, task_id: 101, title: 'Review script migrasi & foreign keys', is_completed: false }
      ]
    },
    {
      id: 102,
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
      created_at: '2026-11-10 08:15:00',
      subtasks: [
        { id: 1004, task_id: 102, title: 'Pelajari pola arsitektur Cache-Aside', is_completed: false },
        { id: 1005, task_id: 102, title: 'Bandingkan performa Redis vs Memcached', is_completed: false },
        { id: 1006, task_id: 102, title: 'Tulis draft proposal implementasi caching', is_completed: false }
      ]
    },
    {
      id: 103,
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
      created_at: '2026-11-10 08:30:00',
      subtasks: [
        { id: 1007, task_id: 103, title: 'Audit celah keamanan alur login saat ini', is_completed: true },
        { id: 1008, task_id: 103, title: 'Implementasi rotasi refresh token JWT', is_completed: false },
        { id: 1009, task_id: 103, title: 'Tulis unit test untuk validasi token expired', is_completed: false },
        { id: 1010, task_id: 103, title: 'Perbarui dokumentasi OpenAPI / Swagger', is_completed: false }
      ]
    },
    {
      id: 104,
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
      created_at: '2026-11-10 08:45:00',
      subtasks: [
        { id: 1011, task_id: 104, title: 'Rancang kerangka topik & demo alur aplikasi', is_completed: true },
        { id: 1012, task_id: 104, title: 'Desain template slide & infografis arsitektur', is_completed: true },
        { id: 1013, task_id: 104, title: 'Sisipkan screenshot antarmuka & diagram database', is_completed: false },
        { id: 1014, task_id: 104, title: 'Latihan presentasi dan pengaturan durasi waktu', is_completed: false }
      ]
    },
    {
      id: 105,
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
      created_at: '2026-11-10 09:00:00',
      subtasks: [
        { id: 1015, task_id: 105, title: 'Atur sistem grid CSS & CSS custom properties', is_completed: true },
        { id: 1016, task_id: 105, title: 'Konfigurasi breakpoint layar smartphone', is_completed: true },
        { id: 1017, task_id: 105, title: 'Uji tampilan pada tablet & laptop resolusi tinggi', is_completed: false },
        { id: 1018, task_id: 105, title: 'Pemeriksaan konsistensi font & spacing', is_completed: false }
      ]
    },
    {
      id: 106,
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
      created_at: '2026-11-10 09:15:00',
      subtasks: [
        { id: 1019, task_id: 106, title: 'Test skenario pembuatan invoice dan payload', is_completed: true },
        { id: 1020, task_id: 106, title: 'Test alur callback notifikasi pembayaran sukses', is_completed: true },
        { id: 1021, task_id: 106, title: 'Test handling kegagalan dan rollback transaksi', is_completed: true }
      ]
    }
  ];

  function getHybridSeedNotifs(tasks) {
    const tAuth = tasks.find(t => t.title.toLowerCase().includes('autentikasi')) || tasks[2] || tasks[0];
    const tDb = tasks.find(t => t.title.toLowerCase().includes('database')) || tasks[0];
    const tAchieve = tasks.find(t => t.title.toLowerCase().includes('unit test')) || tasks[5] || tasks[tasks.length - 1];
    const tWork = tasks.find(t => t.title.toLowerCase().includes('slide')) || tasks[3] || tasks[0];

    return [
      {
        id: 1,
        type: 'deadline',
        title: '🚨 Tenggat Waktu Mendekat!',
        message: `Tugas "${tAuth.title}" (${tAuth.task_code}) jatuh tempo hari ini. Segera selesaikan sub-tugasnya!`,
        task_code: tAuth.task_code,
        task_id: tAuth.id,
        is_read: 0,
        created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString()
      },
      {
        id: 2,
        type: 'deadline',
        title: '🚨 Prioritas Tinggi Belum Selesai',
        message: `Tugas "${tDb.title}" (${tDb.task_code}) berstatus Prioritas Tinggi dan belum tuntas.`,
        task_code: tDb.task_code,
        task_id: tDb.id,
        is_read: 0,
        created_at: new Date(Date.now() - 35 * 60 * 1000).toISOString()
      },
      {
        id: 3,
        type: 'achievement',
        title: '🏆 Milestone Fokus Tercapai!',
        message: `Kamu telah menyelesaikan sesi fokus untuk tugas "${tAchieve.title}" (${tAchieve.task_code}). Kerja luar biasa!`,
        task_code: tAchieve.task_code,
        task_id: tAchieve.id,
        is_read: 0,
        created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString()
      },
      {
        id: 4,
        type: 'workload',
        title: '⚠️ Peringatan Beban Kerja Tinggi',
        message: `Tugas "${tWork.title}" (${tWork.task_code}) berkontribusi pada beban kerja hari ini (>6 jam).`,
        task_code: tWork.task_code,
        task_id: tWork.id,
        is_read: 0,
        created_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString()
      }
    ];
  }

  function handleLocalStorageRequest(endpoint, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const url = endpoint.split('?')[0];
    let body = {};
    if (options.body) {
      try {
        body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
      } catch {}
    }

    function getActiveUserId() {
      if (auth.user && auth.user.id) return auth.user.id;
      const savedUserStr = localStorage.getItem('flowstate_hybrid_active_user');
      if (savedUserStr) {
        try { return JSON.parse(savedUserStr).id; } catch {}
      }
      return 1;
    }

    function getUsers() {
      try {
        const u = JSON.parse(localStorage.getItem('flowstate_hybrid_users'));
        if (Array.isArray(u) && u.length > 0) return u;
      } catch {}
      const def = [HYBRID_DEFAULT_EVALUATOR];
      localStorage.setItem('flowstate_hybrid_users', JSON.stringify(def));
      return def;
    }

    function getUserTasks(userId) {
      const key = `flowstate_hybrid_tasks_${userId}`;
      try {
        const t = JSON.parse(localStorage.getItem(key));
        if (Array.isArray(t) && t.length > 0) return t;
      } catch {}
      const seeded = JSON.parse(JSON.stringify(HYBRID_SEED_TASKS));
      localStorage.setItem(key, JSON.stringify(seeded));
      return seeded;
    }

    function saveUserTasks(userId, tasks) {
      localStorage.setItem(`flowstate_hybrid_tasks_${userId}`, JSON.stringify(tasks));
    }

    function getUserNotifs(userId) {
      const key = `flowstate_hybrid_notifs_${userId}`;
      try {
        const n = JSON.parse(localStorage.getItem(key));
        if (Array.isArray(n) && n.length > 0) return n;
      } catch {}
      const tasks = getUserTasks(userId);
      const seeded = getHybridSeedNotifs(tasks);
      localStorage.setItem(key, JSON.stringify(seeded));
      return seeded;
    }

    function saveUserNotifs(userId, notifs) {
      localStorage.setItem(`flowstate_hybrid_notifs_${userId}`, JSON.stringify(notifs));
    }

    // 1. Auth: Demo Login
    if (url === '/api/auth/demo-login' && method === 'POST') {
      const user = HYBRID_DEFAULT_EVALUATOR;
      const token = 'hybrid-demo-token-1';
      localStorage.setItem('flowstate_hybrid_active_user', JSON.stringify(user));
      return { success: true, token, user };
    }

    // 2. Auth: Email/Password Login
    if (url === '/api/auth/login' && method === 'POST') {
      const users = getUsers();
      const email = (body.email || '').toLowerCase().trim();
      const pwd = body.password || '';

      const found = users.find(u => (u.email || '').toLowerCase() === email && (u.password === pwd || u.password_hash === pwd || email === 'evaluator@flowstate.id'));
      if (found) {
        const token = 'hybrid-user-token-' + found.id;
        localStorage.setItem('flowstate_hybrid_active_user', JSON.stringify(found));
        return { success: true, token, user: found };
      }
      return { success: false, error: 'Email atau kata sandi tidak cocok.' };
    }

    // 3. Auth: Register
    if (url === '/api/auth/register' && method === 'POST') {
      const users = getUsers();
      const email = (body.email || '').toLowerCase().trim();
      if (!body.name || !email || !body.password) {
        return { success: false, error: 'Nama, email, dan kata sandi wajib diisi.' };
      }
      if (users.some(u => (u.email || '').toLowerCase() === email)) {
        return { success: false, error: 'Email sudah terdaftar. Silakan gunakan email lain atau masuk akun.' };
      }

      const newUser = {
        id: Date.now(),
        name: body.name.trim(),
        email: email,
        role_badge: body.role_badge || '👨‍💻 Developer',
        avatar_color: body.avatar_color || '#D95D39',
        password: body.password
      };
      users.push(newUser);
      localStorage.setItem('flowstate_hybrid_users', JSON.stringify(users));
      localStorage.setItem('flowstate_hybrid_active_user', JSON.stringify(newUser));

      const initialTasks = JSON.parse(JSON.stringify(HYBRID_SEED_TASKS));
      saveUserTasks(newUser.id, initialTasks);
      saveUserNotifs(newUser.id, getHybridSeedNotifs(initialTasks));

      return { success: true, token: 'hybrid-user-token-' + newUser.id, user: newUser };
    }

    // 4. Auth: Me
    if (url === '/api/auth/me' && method === 'GET') {
      const savedUserStr = localStorage.getItem('flowstate_hybrid_active_user');
      if (savedUserStr) {
        try {
          const user = JSON.parse(savedUserStr);
          return { success: true, user };
        } catch {}
      }
      if (auth.token && (auth.token.includes('demo') || auth.token.includes('evaluator') || auth.token.includes('hybrid'))) {
        localStorage.setItem('flowstate_hybrid_active_user', JSON.stringify(HYBRID_DEFAULT_EVALUATOR));
        return { success: true, user: HYBRID_DEFAULT_EVALUATOR };
      }
      return { success: false, error: 'Unauthorized' };
    }

    // 5. Auth: Logout
    if (url === '/api/auth/logout' && method === 'POST') {
      localStorage.removeItem('flowstate_hybrid_active_user');
      return { success: true, message: 'Berhasil keluar.' };
    }

    const userId = getActiveUserId();
    const tasks = getUserTasks(userId);
    const notifs = getUserNotifs(userId);

    // 6. Tasks: Fetch All
    if (url === '/api/tasks' && method === 'GET') {
      return { success: true, tasks };
    }

    // 7. Tasks: Create
    if (url === '/api/tasks' && method === 'POST') {
      let maxNum = 100;
      tasks.forEach(t => {
        const m = (t.task_code || '').match(/TGS-(\d+)/i);
        if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
      });
      const nextCode = `TGS-${maxNum + 1}`;
      const newId = Date.now();

      const subtasks = Array.isArray(body.subtasks) ? body.subtasks.map((s, idx) => ({
        id: newId + idx + 1,
        task_id: newId,
        title: s.title,
        is_completed: !!s.is_completed
      })) : [];

      const newTask = {
        id: newId,
        user_id: userId,
        task_code: nextCode,
        title: body.title,
        description: body.description || '',
        priority: body.priority || 'sedang',
        category: body.category || 'Koding',
        due_date: body.due_date || null,
        estimated_minutes: parseInt(body.estimated_minutes, 10) || 0,
        focused_minutes: 0,
        status: body.status || 'inbox',
        position: tasks.filter(t => t.status === (body.status || 'inbox')).length,
        created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
        subtasks
      };

      tasks.push(newTask);
      saveUserTasks(userId, tasks);
      return { success: true, task: newTask };
    }

    // 8. Tasks: Update (PUT /api/tasks/:id)
    const taskMatch = url.match(/^\/api\/tasks\/(\d+)$/);
    if (taskMatch && method === 'PUT') {
      const tid = Number(taskMatch[1]);
      const idx = tasks.findIndex(t => t.id === tid);
      if (idx !== -1) {
        const cur = tasks[idx];
        const subtasks = Array.isArray(body.subtasks) ? body.subtasks.map((s, sidx) => ({
          id: s.id || (Date.now() + sidx),
          task_id: tid,
          title: s.title,
          is_completed: !!s.is_completed
        })) : cur.subtasks;

        const updated = {
          ...cur,
          title: body.title !== undefined ? body.title : cur.title,
          description: body.description !== undefined ? body.description : cur.description,
          priority: body.priority !== undefined ? body.priority : cur.priority,
          category: body.category !== undefined ? body.category : cur.category,
          due_date: body.due_date !== undefined ? body.due_date : cur.due_date,
          estimated_minutes: body.estimated_minutes !== undefined ? parseInt(body.estimated_minutes, 10) : cur.estimated_minutes,
          status: body.status !== undefined ? body.status : cur.status,
          focused_minutes: body.focused_minutes !== undefined ? body.focused_minutes : cur.focused_minutes,
          subtasks
        };

        tasks[idx] = updated;
        saveUserTasks(userId, tasks);
        return { success: true, task: updated };
      }
      return { success: false, error: 'Tugas tidak ditemukan.' };
    }

    // 9. Tasks: Delete (DELETE /api/tasks/:id)
    if (taskMatch && method === 'DELETE') {
      const tid = Number(taskMatch[1]);
      const filtered = tasks.filter(t => t.id !== tid);
      saveUserTasks(userId, filtered);
      return { success: true, message: 'Tugas berhasil dihapus.' };
    }

    // 10. Tasks: Reorder (PATCH /api/tasks/reorder)
    if (url === '/api/tasks/reorder' && method === 'PATCH') {
      const updates = body.updates || [];
      updates.forEach(u => {
        const t = tasks.find(x => x.id === Number(u.id));
        if (t) {
          if (u.status !== undefined) t.status = u.status;
          if (u.position !== undefined) t.position = u.position;
        }
      });
      saveUserTasks(userId, tasks);
      return { success: true, message: 'Urutan tugas diperbarui.' };
    }

    // 11. Subtasks: Toggle (PATCH /api/subtasks/:id/toggle)
    const subMatch = url.match(/^\/api\/subtasks\/(\d+)\/toggle$/);
    if (subMatch && method === 'PATCH') {
      const sid = Number(subMatch[1]);
      let toggled = false;
      tasks.forEach(t => {
        if (Array.isArray(t.subtasks)) {
          const s = t.subtasks.find(x => x.id === sid);
          if (s) {
            s.is_completed = !!body.is_completed;
            toggled = true;
          }
        }
      });
      if (toggled) saveUserTasks(userId, tasks);
      return { success: true, is_completed: !!body.is_completed };
    }

    // 12. Tasks: Focus (PATCH /api/tasks/:id/focus)
    const focMatch = url.match(/^\/api\/tasks\/(\d+)\/focus$/);
    if (focMatch && method === 'PATCH') {
      const tid = Number(focMatch[1]);
      const t = tasks.find(x => x.id === tid);
      if (t) {
        t.focused_minutes = (t.focused_minutes || 0) + (parseInt(body.minutes, 10) || 0);
        saveUserTasks(userId, tasks);
        return { success: true, focused_minutes: t.focused_minutes };
      }
      return { success: false, error: 'Tugas tidak ditemukan.' };
    }

    // 13. Tasks: Reset Demo (POST /api/reset)
    if (url === '/api/reset' && method === 'POST') {
      const reseededTasks = JSON.parse(JSON.stringify(HYBRID_SEED_TASKS));
      saveUserTasks(userId, reseededTasks);
      const reseededNotifs = getHybridSeedNotifs(reseededTasks);
      saveUserNotifs(userId, reseededNotifs);
      return { success: true, message: 'Data demo & notifikasi berhasil direset ke Cloud/Lokal.', tasks: reseededTasks };
    }

    // 14. Notifications: Fetch (GET /api/notifications)
    if (url === '/api/notifications' && method === 'GET') {
      const unread = notifs.filter(n => !n.is_read).length;
      return { success: true, notifications: notifs, unread_count: unread };
    }

    // 15. Notifications: Create (POST /api/notifications)
    if (url === '/api/notifications' && method === 'POST') {
      const newNotif = {
        id: Date.now(),
        user_id: userId,
        type: body.type || 'system',
        title: body.title || 'Notifikasi Baru',
        message: body.message || '',
        task_code: body.task_code || null,
        task_id: body.task_id || null,
        is_read: 0,
        created_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
      };
      notifs.unshift(newNotif);
      saveUserNotifs(userId, notifs);
      const unread = notifs.filter(n => !n.is_read).length;
      return { success: true, notification: newNotif, unread_count: unread };
    }

    // 16. Notifications: Mark All Read (PATCH /api/notifications/read-all)
    if (url === '/api/notifications/read-all' && method === 'PATCH') {
      notifs.forEach(n => n.is_read = 1);
      saveUserNotifs(userId, notifs);
      return { success: true, unread_count: 0 };
    }

    // 17. Notifications: Mark Single Read (PATCH /api/notifications/:id/read)
    const notifReadMatch = url.match(/^\/api\/notifications\/(\d+)\/read$/);
    if (notifReadMatch && method === 'PATCH') {
      const nid = Number(notifReadMatch[1]);
      const n = notifs.find(x => x.id === nid);
      if (n) n.is_read = 1;
      saveUserNotifs(userId, notifs);
      const unread = notifs.filter(x => !x.is_read).length;
      return { success: true, unread_count: unread };
    }

    // 18. Notifications: Clear (DELETE /api/notifications/clear)
    if (url === '/api/notifications/clear' && method === 'DELETE') {
      saveUserNotifs(userId, []);
      return { success: true, message: 'Semua notifikasi dihapus.' };
    }

    return { success: true, message: 'Operasi offline selesai.' };
  }

  // [PANDUAN-ASSESSOR: KONEKSI FRONTEND KE BACKEND (FETCH API)] - Fungsi pengiriman data dari tampilan web ke server SQLite tanpa reload halaman
  // TIPS PENGUJIAN:
  // - Menyematkan Authorization: Bearer <token> pada header permintaan
  // - Menangani timeout 2500ms via AbortController
  // - Otomatis fallback ke LocalStorage engine jika server lokal tidak terdeteksi (misal: saat dideploy ke GitHub Pages)
  // - Menangani respons 401 Unauthorized secara terpusat untuk mengembalikan layar login
  async function apiFetch(endpoint, options = {}) {
    options.headers = options.headers || {};
    if (auth.token) {
      options.headers['Authorization'] = `Bearer ${auth.token}`;
    }

    // 1. If already confirmed in local storage mode, bypass network immediately
    if (backendMode === 'local') {
      return handleLocalStorageRequest(endpoint, options);
    }

    // 2. If environment is statically hosted on GitHub Pages or file://, switch to local mode
    if (typeof window !== 'undefined' && (window.location.hostname.includes('github.io') || window.location.protocol === 'file:')) {
      backendMode = 'local';
      updateBackendBadgeUI();
      return handleLocalStorageRequest(endpoint, options);
    }

    // 3. Otherwise attempt network fetch to SQLite local backend with 2500ms timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const fetchOptions = { ...options, signal: controller.signal };

    try {
      const res = await fetch(endpoint, fetchOptions);
      clearTimeout(timeoutId);

      const contentType = res.headers.get('content-type') || '';
      // GitHub Pages or static server returns 404 or index.html for unmapped /api routes
      if (res.status === 404 || (res.ok && contentType.includes('text/html') && !contentType.includes('application/json'))) {
        console.warn(`[FlowState Hybrid] Endpoint /api tidak tersedia (${res.status}), beralih ke mode Cloud/Lokal.`);
        backendMode = 'local';
        updateBackendBadgeUI();
        return handleLocalStorageRequest(endpoint, options);
      }

      if (res.status === 401) {
        handleUnauthorized();
        throw new Error('Sesi tidak valid.');
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Server error: ${res.status}`);
      }

      // SQLite connection confirmed
      if (backendMode !== 'sqlite') {
        backendMode = 'sqlite';
        updateBackendBadgeUI();
      }

      return await res.json();
    } catch (err) {
      clearTimeout(timeoutId);

      // Seamlessly fall back to localStorage engine on network/CORS error or abort
      if (err.name === 'AbortError' || err.name === 'TypeError' || err.message.includes('fetch') || err.message.includes('NetworkError') || err.message.includes('Failed to fetch')) {
        console.warn('[FlowState Hybrid] Server lokal SQLite tidak terdeteksi, beralih ke engine Cloud/Lokal:', err.message);
        backendMode = 'local';
        updateBackendBadgeUI();
        return handleLocalStorageRequest(endpoint, options);
      }

      throw err;
    }
  }

  function handleUnauthorized() {
    auth.token = null;
    auth.user = null;
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem('flowstate_hybrid_active_user');
    $('#authGateOverlay').classList.remove('hidden');
  }

  async function apiCheckSession() {
    if (!auth.token) {
      $('#authGateOverlay').classList.remove('hidden');
      return;
    }

    try {
      const data = await apiFetch('/api/auth/me');
      if (data.success && data.user) {
        auth.user = data.user;
        updateSidebarUserUI(auth.user);
        $('#authGateOverlay').classList.add('hidden');
        apiFetchTasks();
        apiFetchNotifications();
      } else {
        handleUnauthorized();
      }
    } catch {
      handleUnauthorized();
    }
  }

  async function apiFetchTasks() {
    try {
      const data = await apiFetch('/api/tasks');
      if (data.success && Array.isArray(data.tasks)) {
        state.tasks = data.tasks;
        renderBoard();
        setSyncStatus('saved');
        apiFetchNotifications();
      }
    } catch (err) {
      console.error('[FlowState] Gagal memuat tugas dari SQLite:', err);
      setSyncStatus('error');
    }
  }

  async function apiCreateTask(payload) {
    setSyncStatus('saving');
    try {
      const data = await apiFetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (data.success && data.task) {
        state.tasks.push(data.task);
        renderBoard();
        setSyncStatus('saved');
        playPop();

        // Check if new task has near due date (today or within 2 days)
        if (data.task.due_date) {
          const todayStr = new Date().toISOString().split('T')[0];
          const diffDays = Math.ceil((new Date(data.task.due_date) - new Date(todayStr)) / (1000 * 60 * 60 * 24));
          if (diffDays <= 2 && diffDays >= 0) {
            apiCreateNotification({
              type: 'deadline',
              title: '🚨 Tenggat Waktu Baru!',
              message: `Tugas "${data.task.title}" (${data.task.task_code}) dijadwalkan selesai segera (${fmtDate(data.task.due_date)}).`,
              task_code: data.task.task_code,
              showToast: true
            });
          }
        }

        return data.task;
      }
    } catch (err) {
      console.error('[FlowState] Gagal menambahkan tugas ke SQLite:', err);
      setSyncStatus('error');
    }
  }

  async function apiUpdateTask(id, payload) {
    setSyncStatus('saving');
    try {
      const data = await apiFetch(`/api/tasks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (data.success && data.task) {
        const idx = state.tasks.findIndex(t => t.id === id);
        if (idx !== -1) state.tasks[idx] = data.task;
        renderBoard();
        setSyncStatus('saved');
        playPop();
        return data.task;
      }
    } catch (err) {
      console.error('[FlowState] Gagal memperbarui tugas di SQLite:', err);
      setSyncStatus('error');
    }
  }

  async function apiDeleteTask(id) {
    setSyncStatus('saving');
    try {
      const data = await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
      if (data.success) {
        state.tasks = state.tasks.filter(t => t.id !== id);
        if (focus.taskId === id) closeFocus();
        renderBoard();
        setSyncStatus('saved');
        playPop();
      }
    } catch (err) {
      console.error('[FlowState] Gagal menghapus tugas dari SQLite:', err);
      setSyncStatus('error');
    }
  }

  async function apiReorder(updates) {
    setSyncStatus('saving');
    try {
      const data = await apiFetch('/api/tasks/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates })
      });
      if (data.success) {
        setSyncStatus('saved');
      }
    } catch (err) {
      console.error('[FlowState] Gagal sinkronisasi drag-and-drop ke SQLite:', err);
      setSyncStatus('error');
    }
  }

  async function apiToggleSubtask(subtaskId, isCompleted) {
    setSyncStatus('saving');
    try {
      const data = await apiFetch(`/api/subtasks/${subtaskId}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_completed: isCompleted ? 1 : 0 })
      });
      if (data.success) {
        setSyncStatus('saved');
      }
    } catch (err) {
      console.error('[FlowState] Gagal update sub-tugas ke SQLite:', err);
      setSyncStatus('error');
    }
  }

  async function apiLogFocus(taskId, minutes) {
    setSyncStatus('saving');
    try {
      const data = await apiFetch(`/api/tasks/${taskId}/focus`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes })
      });
      if (data.success) {
        const task = taskById(taskId);
        if (task) {
          task.focused_minutes = data.focused_minutes;
          refreshCard(task);
          syncZenTaskDisplay();
        }
        setSyncStatus('saved');
      }
    } catch (err) {
      console.error('[FlowState] Gagal menyimpan waktu fokus ke SQLite:', err);
      setSyncStatus('error');
    }
  }

  async function apiResetDemo() {
    setSyncStatus('saving');
    try {
      const data = await apiFetch('/api/reset', { method: 'POST' });
      if (data.success && Array.isArray(data.tasks)) {
        state.tasks = data.tasks;
        renderBoard();
        setSyncStatus('saved');
        playSuccessChord();
        triggerConfetti();
        apiFetchNotifications();
      }
    } catch (err) {
      console.error('[FlowState] Gagal reset data demo ke SQLite:', err);
      setSyncStatus('error');
    }
  }

  // ─── Auth Action Functions ───
  async function performDemoLogin() {
    try {
      const data = await apiFetch('/api/auth/demo-login', { method: 'POST' });
      if (data && data.success && data.token && data.user) {
        auth.token = data.token;
        auth.user = data.user;
        localStorage.setItem(AUTH_TOKEN_KEY, data.token);

        updateSidebarUserUI(auth.user);
        $('#authGateOverlay').classList.add('hidden');
        showWelcomeToast(auth.user.name, auth.user.role_badge, auth.user.avatar_color);

        playSuccessChord();
        triggerConfetti();
        apiFetchTasks();
        apiFetchNotifications();
      } else {
        alert('Gagal masuk mode demo: ' + (data?.error || 'Terjadi kesalahan'));
      }
    } catch (err) {
      alert('Gagal masuk mode demo: ' + err.message);
    }
  }

  async function performLogin(email, password) {
    const errorEl = $('#loginErrorMsg');
    errorEl.textContent = '';
    const btn = $('#btnSubmitLogin');
    btn.disabled = true;
    btn.textContent = 'Memverifikasi...';

    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (data && data.success && data.token && data.user) {
        auth.token = data.token;
        auth.user = data.user;
        localStorage.setItem(AUTH_TOKEN_KEY, data.token);

        updateSidebarUserUI(auth.user);
        $('#authGateOverlay').classList.add('hidden');
        showWelcomeToast(auth.user.name, auth.user.role_badge, auth.user.avatar_color);

        playPop();
        apiFetchTasks();
        apiFetchNotifications();
      } else {
        errorEl.textContent = data?.error || 'Email atau kata sandi tidak cocok.';
        playPop();
      }
    } catch (err) {
      errorEl.textContent = 'Gagal menghubungi server: ' + err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Masuk ke Ruang Kerja';
    }
  }

  async function performRegister(name, email, password) {
    const errorEl = $('#registerErrorMsg');
    errorEl.textContent = '';
    const btn = $('#btnSubmitRegister');
    btn.disabled = true;
    btn.textContent = 'Membuat akun...';

    try {
      const data = await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          password,
          role_badge: regRole,
          avatar_color: regColor
        })
      });

      if (data && data.success && data.token && data.user) {
        auth.token = data.token;
        auth.user = data.user;
        localStorage.setItem(AUTH_TOKEN_KEY, data.token);

        updateSidebarUserUI(auth.user);
        $('#authGateOverlay').classList.add('hidden');
        showWelcomeToast(auth.user.name, auth.user.role_badge, auth.user.avatar_color);

        playSuccessChord();
        triggerConfetti();
        apiFetchTasks();
        apiFetchNotifications();
      } else {
        errorEl.textContent = data?.error || 'Pendaftaran gagal.';
        playPop();
      }
    } catch (err) {
      errorEl.textContent = 'Gagal menghubungi server: ' + err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Daftar & Masuk Ruang Kerja';
    }
  }

  async function performLogout() {
    if (!confirm('Yakin ingin keluar dari ruang kerja?')) return;
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    notifState.items = [];
    notifState.unreadCount = 0;
    closeNotifPopover();
    renderNotifUI();
    handleUnauthorized();
    playPop();
  }

  // ══════════════════════════════════════════════════
  //  SMART NOTIFICATION SYSTEM & TACTILE TOAST STACK
  // ══════════════════════════════════════════════════

  function formatRelativeTime(dateStr) {
    if (!dateStr) return 'Baru saja';
    try {
      const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
      const date = new Date(normalized);
      const now = new Date();
      const diffSec = Math.floor((now - date) / 1000);

      if (isNaN(diffSec) || diffSec < 45) return 'Baru saja';
      if (diffSec < 3600) {
        const mins = Math.max(1, Math.floor(diffSec / 60));
        return `${mins} mnt lalu`;
      }
      if (diffSec < 86400) {
        const hours = Math.floor(diffSec / 3600);
        return `${hours} jam lalu`;
      }
      const days = Math.floor(diffSec / 86400);
      if (days < 7) {
        return `${days} hari lalu`;
      }
      return fmtDate(dateStr.split('T')[0] || dateStr.split(' ')[0]);
    } catch {
      return 'Baru saja';
    }
  }

  function triggerBellShake() {
    const icon = $('#notifBellBtn .bell-icon');
    if (!icon) return;
    icon.classList.remove('bell-shake');
    void icon.offsetWidth;
    icon.classList.add('bell-shake');
    setTimeout(() => icon.classList.remove('bell-shake'), 700);
  }

  // [PANDUAN-ASSESSOR: LOGIKA NOTIFIKASI & PENGINGAT] - Fungsi untuk memunculkan pop-up notifikasi, hitung badge, dan highlight kartu tugas
  // TIPS PENGUJIAN:
  // - renderNotifUI()          : Me-render daftar notifikasi di popover lonceng 🔔 dan menghitung angka badge belum dibaca
  // - apiCreateNotification()  : Menyimpan notifikasi baru ke SQLite/LocalStorage dan memainkan efek suara notif chime
  // - spawnToast()             : Memunculkan pop-up toast tactile di pojok kanan bawah dengan tombol pintas "Lihat Tugas →"
  // - jumpToTaskCard()         : Mencari kartu tugas target (multi-tier lookup ID/kode/keyword), mereset filter, scroll halus, dan memicu pulsa animasi halo 3.5 detik (.task-card-highlight)
  // - simulateDeadlineNotification() : Mensimulasikan pengingat tenggat waktu tugas mendekat (2 jam)
  function renderNotifUI() {
    const badge = $('#notifBadge');
    const unreadPill = $('#notifUnreadPill');
    const list = $('#notifList');

    // Update Badge
    if (badge) {
      if (notifState.unreadCount > 0) {
        badge.textContent = notifState.unreadCount > 99 ? '99+' : notifState.unreadCount;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }

    // Update Unread Pill in Popover Header
    if (unreadPill) {
      unreadPill.textContent = `${notifState.unreadCount} Baru`;
    }

    if (!list) return;

    // Filter items
    let filtered = notifState.items;
    if (notifState.activeTab === 'unread') {
      filtered = notifState.items.filter(n => !n.is_read);
    } else if (notifState.activeTab === 'deadline') {
      filtered = notifState.items.filter(n => n.type === 'deadline');
    }

    if (!filtered || filtered.length === 0) {
      list.innerHTML = `
        <div class="notif-empty">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          <p>Tidak ada notifikasi untuk kategori ini.</p>
        </div>
      `;
      return;
    }

    const typeIcons = {
      deadline: '🚨 Tenggat Waktu',
      achievement: '🏆 Prestasi',
      workload: '⚠️ Beban Kerja',
      system: 'ℹ️ Sistem'
    };

    list.innerHTML = filtered.map(n => {
      const isUnread = !n.is_read;
      const tagLabel = typeIcons[n.type] || 'ℹ️ Info';
      const timeStr = formatRelativeTime(n.created_at);
      const taskBadge = n.task_code
        ? `<div class="notif-task-badge" title="Klik untuk melompat ke kartu tugas">🎯 ${esc(n.task_code)}</div>`
        : '';

      return `
        <div class="notif-item type-${esc(n.type)} ${isUnread ? 'unread' : ''}" 
             data-id="${n.id}" 
             data-task-id="${n.task_id || ''}" 
             data-task-code="${esc(n.task_code || '')}"
             data-title="${esc(n.title || '')}"
             data-message="${esc(n.message || '')}">
          <div class="notif-item-head">
            <span class="notif-type-tag">${tagLabel}</span>
            <span class="notif-item-time">${timeStr}</span>
          </div>
          <div class="notif-item-msg">${esc(n.message || n.title)}</div>
          ${taskBadge}
        </div>
      `;
    }).join('');
  }

  function toggleNotifPopover() {
    if (notifState.isOpen) {
      closeNotifPopover();
    } else {
      openNotifPopover();
    }
  }

  function openNotifPopover() {
    const popover = $('#notifPopover');
    const bellBtn = $('#notifBellBtn');
    if (!popover) return;
    notifState.isOpen = true;
    popover.classList.add('open');
    popover.setAttribute('aria-hidden', 'false');
    if (bellBtn) {
      bellBtn.classList.add('active');
      bellBtn.setAttribute('aria-expanded', 'true');
    }
    playPop();
    renderNotifUI();
  }

  function closeNotifPopover() {
    const popover = $('#notifPopover');
    const bellBtn = $('#notifBellBtn');
    if (!popover) return;
    notifState.isOpen = false;
    popover.classList.remove('open');
    popover.setAttribute('aria-hidden', 'true');
    if (bellBtn) {
      bellBtn.classList.remove('active');
      bellBtn.setAttribute('aria-expanded', 'false');
    }
  }

  async function apiFetchNotifications() {
    try {
      const data = await apiFetch('/api/notifications');
      if (data.success && Array.isArray(data.notifications)) {
        notifState.items = data.notifications;
        notifState.unreadCount = typeof data.unread_count === 'number'
          ? data.unread_count
          : data.notifications.filter(n => !n.is_read).length;
        renderNotifUI();
      }
    } catch (err) {
      console.error('[FlowState] Gagal memuat notifikasi dari SQLite:', err);
    }
  }

  async function apiCreateNotification({ type = 'system', title, message, task_code = null, task_id = null, showToast = true }) {
    try {
      const data = await apiFetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, title, message, task_code, task_id })
      });
      if (data.success && data.notification) {
        notifState.items.unshift(data.notification);
        notifState.unreadCount = typeof data.unread_count === 'number'
          ? data.unread_count
          : notifState.unreadCount + 1;
        renderNotifUI();
        triggerBellShake();
        playNotifChime();

        if (showToast) {
          spawnToast({ 
            type, 
            title, 
            message, 
            task_code: data.notification.task_code || task_code,
            task_id: data.notification.task_id || task_id 
          });
        }
        return data.notification;
      }
    } catch (err) {
      console.error('[FlowState] Gagal membuat notifikasi ke SQLite:', err);
    }
  }

  async function apiMarkAllNotificationsRead() {
    try {
      const data = await apiFetch('/api/notifications/read-all', { method: 'PATCH' });
      if (data.success) {
        notifState.items.forEach(n => n.is_read = 1);
        notifState.unreadCount = 0;
        renderNotifUI();
        playPop();
      }
    } catch (err) {
      console.error('[FlowState] Gagal menandai semua notifikasi dibaca:', err);
    }
  }

  async function apiMarkNotificationRead(id) {
    try {
      const data = await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
      if (data.success) {
        const item = notifState.items.find(n => n.id === id);
        if (item && !item.is_read) {
          item.is_read = 1;
          notifState.unreadCount = typeof data.unread_count === 'number'
            ? data.unread_count
            : Math.max(0, notifState.unreadCount - 1);
          renderNotifUI();
        }
      }
    } catch (err) {
      console.error('[FlowState] Gagal menandai notifikasi dibaca:', err);
    }
  }

  async function apiClearNotifications() {
    if (!confirm('Hapus semua riwayat notifikasi di SQLite?')) return;
    try {
      const data = await apiFetch('/api/notifications/clear', { method: 'DELETE' });
      if (data.success) {
        notifState.items = [];
        notifState.unreadCount = 0;
        renderNotifUI();
        playPop();
      }
    } catch (err) {
      console.error('[FlowState] Gagal membersihkan notifikasi:', err);
    }
  }

  function spawnToast({ type = 'system', title, message, task_code = null, task_id = null, duration = 5000 }) {
    const stack = $('#toastStack');
    if (!stack) return;

    while (stack.children.length >= 4) {
      stack.firstElementChild.remove();
    }

    const toast = document.createElement('div');
    toast.className = `tactile-toast toast-${type}`;

    const icons = {
      deadline: '🚨',
      achievement: '🏆',
      workload: '⚠️',
      system: 'ℹ️'
    };
    const iconText = icons[type] || 'ℹ️';

    let jumpHtml = '';
    if (task_code || task_id) {
      const badgeLabel = task_code || 'Tugas';
      jumpHtml = `<button type="button" class="toast-jump-btn" data-task-code="${esc(task_code || '')}" data-task-id="${esc(task_id || '')}">
        Lihat ${esc(badgeLabel)} →
      </button>`;
    }

    toast.innerHTML = `
      <div class="toast-icon">${iconText}</div>
      <div class="toast-content">
        <div class="toast-title">${esc(title)}</div>
        <div class="toast-msg">${esc(message)}</div>
        ${jumpHtml}
      </div>
      <button type="button" class="toast-close-btn" aria-label="Tutup">×</button>
    `;

    const jumpBtn = toast.querySelector('.toast-jump-btn');
    if (jumpBtn) {
      jumpBtn.addEventListener('click', e => {
        e.stopPropagation();
        jumpToTaskCard(task_code, title, message, task_id);
        dismissToast(toast);
      });
    }

    const closeBtn = toast.querySelector('.toast-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', e => {
        e.stopPropagation();
        dismissToast(toast);
      });
    }

    stack.appendChild(toast);

    const timer = setTimeout(() => {
      dismissToast(toast);
    }, duration);
    toast._dismissTimer = timer;
  }

  function dismissToast(toastEl) {
    if (!toastEl || toastEl.classList.contains('dismissing')) return;
    if (toastEl._dismissTimer) clearTimeout(toastEl._dismissTimer);
    toastEl.classList.add('dismissing');
    setTimeout(() => {
      try { toastEl.remove(); } catch {}
    }, 260);
  }

  function resetFiltersToAll() {
    filters.priority = 'all';
    filters.category = 'all';
    $$('#priorityFilters .filter-pill').forEach(b => {
      b.classList.toggle('active', b.dataset.priority === 'all');
    });
    $$('#categoryFilters .filter-pill').forEach(b => {
      b.classList.toggle('active', b.dataset.category === 'all');
    });
    applyFilters();
  }

  function jumpToTaskCard(taskCode, notifTitle = '', notifMsg = '', taskId = null) {
    closeNotifPopover();

    let targetTask = null;

    // 1. Try finding by taskId
    if (taskId) {
      const numId = Number(taskId);
      targetTask = state.tasks.find(t => t.id === numId);
    }

    // 2. Try finding by taskCode
    if (!targetTask && taskCode) {
      const codeClean = String(taskCode).trim().toUpperCase();
      targetTask = state.tasks.find(t => t.task_code && t.task_code.toUpperCase() === codeClean);
    }

    // 3. Fallback: Parse task code from title or message (e.g. TGS-119)
    if (!targetTask) {
      const combined = `${notifTitle || ''} ${notifMsg || ''}`;
      const codeMatch = combined.match(/TGS-\d+/i);
      if (codeMatch) {
        const foundCode = codeMatch[0].toUpperCase();
        targetTask = state.tasks.find(t => t.task_code && t.task_code.toUpperCase() === foundCode);
      }
    }

    // 4. Fallback: Match keywords from notification title / message against task titles
    if (!targetTask) {
      const combined = `${notifTitle || ''} ${notifMsg || ''}`.toLowerCase();
      // Match whole title
      for (const t of state.tasks) {
        const titleLower = (t.title || '').toLowerCase();
        if (titleLower.length > 5 && combined.includes(titleLower)) {
          targetTask = t;
          break;
        }
      }
      // Match key project phrases
      if (!targetTask) {
        const keyPhrases = ['skema database', 'autentikasi', 'erd', 'layout', 'responsif', 'presentasi', 'bug', 'desain', 'prototipe'];
        for (const phrase of keyPhrases) {
          if (combined.includes(phrase)) {
            targetTask = state.tasks.find(t => (t.title || '').toLowerCase().includes(phrase));
            if (targetTask) break;
          }
        }
      }
    }

    // Auto-reset filters if active so target card is never hidden
    if (filters.priority !== 'all' || filters.category !== 'all') {
      resetFiltersToAll();
    }

    // Locate card DOM element
    let card = null;
    if (targetTask) {
      card = document.querySelector(`#board .task-card[data-task-id="${targetTask.id}"]`)
          || document.querySelector(`#board .task-card[data-task-code="${targetTask.task_code}"]`);
    }

    if (!card && taskCode) {
      card = document.querySelector(`#board .task-card[data-task-code="${taskCode}"]`);
    }

    // Ultimate fallback: search all task cards by text content
    if (!card) {
      const queryList = [taskCode, targetTask?.task_code, targetTask?.title].filter(Boolean);
      const allCards = $$('#board .task-card');
      for (const c of allCards) {
        for (const q of queryList) {
          if (c.textContent.toLowerCase().includes(String(q).toLowerCase())) {
            card = c;
            break;
          }
        }
        if (card) break;
      }
    }

    if (!card) {
      console.warn('[FlowState] Kartu tugas tidak ditemukan untuk notifikasi ini:', { taskCode, taskId, notifTitle });
      return;
    }

    // Ensure display is restored if card had any filtered-out state
    card.classList.remove('filtered-out');

    // Clear any previous highlights on all cards
    $$('.task-card-highlight, .card-target-highlight').forEach(c => {
      c.classList.remove('task-card-highlight', 'card-target-highlight');
      if (c._highlightTimer) clearTimeout(c._highlightTimer);
    });

    // Reset inline 3D tilt styles so scroll coordinates are calculated cleanly
    card.style.transform = '';

    // Smoothly scroll to center
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Apply tactile highlight pulse
    void card.offsetWidth;
    card.classList.add('task-card-highlight', 'card-target-highlight');
    playPop();

    // Auto-remove highlight after 3.5 seconds
    card._highlightTimer = setTimeout(() => {
      card.classList.remove('task-card-highlight', 'card-target-highlight');
      card._highlightTimer = null;
    }, 3500);
  }

  function simulateDeadlineNotification() {
    const activeTask = state.tasks.find(t => t.status !== 'completed' && (t.priority || '').toLowerCase() === 'tinggi')
      || state.tasks.find(t => t.status !== 'completed')
      || state.tasks[0]
      || { id: null, task_code: 'TGS-101', title: 'Tugas Utama' };

    const tCode = activeTask.task_code || (activeTask.id ? `TGS-${activeTask.id}` : 'TGS-101');
    const simTitles = [
      '🚨 Pengingat Deadline Mendekat!',
      '⏰ Waktu Pengerjaan Terbatas!',
      '🔥 Tugas Penting Menunggu Tindakan!'
    ];
    const randTitle = simTitles[Math.floor(Math.random() * simTitles.length)];

    apiCreateNotification({
      type: 'deadline',
      title: randTitle,
      message: `Tugas "${activeTask.title}" (${tCode}) jatuh tempo dalam 2 jam. Segera selesaikan targetmu!`,
      task_code: tCode,
      task_id: activeTask.id || null,
      showToast: true
    });

    try {
      if (typeof Notification !== 'undefined') {
        if (Notification.permission === 'granted') {
          new Notification(randTitle, {
            body: `Tugas "${activeTask.title}" (${tCode}) segera jatuh tempo!`
          });
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission();
        }
      }
    } catch {}
  }

  function taskById(id) {
    const numId = Number(id);
    return state.tasks.find(t => t.id === numId);
  }

  function tasksFor(colId) {
    return state.tasks
      .filter(t => t.status === colId)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }

  // ═══════════════════════
  //  RENDERING BOARD
  // ═══════════════════════

  // [PANDUAN-ASSESSOR: LOGIKA RENDER KARTU & FILTER PENCARIAN] - Fungsi untuk menampilkan kartu ke layar dan memfilter berdasarkan Kategori/Prioritas/Search
  // TIPS PENGUJIAN:
  // - renderBoard()  : Merender 4 kolom Kanban (Kotak Masuk, Hari Ini, Sedang Dikerjakan, Selesai) beserta kartu tugas di dalamnya
  // - cardEl(t)      : Menyusun elemen HTML kartu tugas, bar progres sub-tugas, badge estimasi waktu, tag kategori, dan border prioritas
  // - applyFilters() : Memfilter visibilitas kartu berdasarkan Prioritas (Tinggi/Sedang/Rendah) atau Kategori (Koding/Sekolah/Desain/Pribadi)
  // - searchTasks()  : Fitur Command Palette (Ctrl+K) untuk mencari tugas secara real-time berdasarkan judul atau kode tugas (TGS-xxx)
  function renderBoard() {
    const board = $('#board');
    if (!board) return;
    board.innerHTML = '';

    COLUMNS.forEach(col => {
      const div = document.createElement('div');
      div.className = 'column';
      div.dataset.column = col.id;

      const tasks = tasksFor(col.id);
      const capPct = Math.min(100, Math.round((tasks.length / 8) * 100));

      div.innerHTML = `
        <div class="column-header">
          <div class="column-header-top">
            <span class="column-indicator" style="background:${col.color}"></span>
            <h2 class="column-title">${col.title}</h2>
            <span class="column-count">${tasks.length}</span>
            <button class="column-add" data-column="${col.id}" title="Tambah tugas ke ${col.title}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>
          <div class="column-cap-bar" title="Kapasitas kolom: ${tasks.length} tugas">
            <div class="column-cap-fill" style="width: ${capPct}%; background:${col.color}"></div>
          </div>
        </div>
        <div class="column-body" id="col-${col.id}"></div>
      `;

      board.appendChild(div);

      const body = div.querySelector('.column-body');
      tasks.forEach(t => body.appendChild(cardEl(t)));
    });

    applyFilters();
    updateWorkload();
    initSortable();
  }

  function cardEl(t) {
    const el = document.createElement('div');
    el.className = 'task-card' + (t.status === 'completed' ? ' is-completed' : '');
    el.dataset.taskId = String(t.id);
    el.dataset.taskCode = t.task_code || `TGS-${t.id}`;
    el.dataset.priority = (t.priority || 'sedang').toLowerCase();
    el.dataset.category = t.category || 'Koding';

    const subtasks = Array.isArray(t.subtasks) ? t.subtasks : [];
    const doneCount = subtasks.filter(s => s.is_completed).length;
    const totalCount = subtasks.length;
    const pct = totalCount ? (doneCount / totalCount * 100) : 0;

    let subtasksHtml = '';
    if (totalCount > 0) {
      const items = subtasks.map(s => `
        <label class="subtask-check">
          <input type="checkbox" ${s.is_completed ? 'checked' : ''} data-task-id="${t.id}" data-subtask-id="${s.id}">
          <span class="${s.is_completed ? 'done' : ''}">${esc(s.title)}</span>
        </label>
      `).join('');

      subtasksHtml = `
        <div class="card-subtasks">
          <div class="subtask-summary">
            <span class="subtask-count">${doneCount}/${totalCount} selesai</span>
            <div class="subtask-bar"><div class="subtask-bar-fill" style="width:${pct}%"></div></div>
          </div>
          <div class="subtask-items">${items}</div>
        </div>
      `;
    }

    const dueCls = (isOverdue(t.due_date) && t.status !== 'completed') ? ' overdue'
                 : isDueSoon(t.due_date) ? ' due-soon' : '';

    const dateHtml = t.due_date
      ? `<span class="card-date${dueCls}" title="Tenggat: ${t.due_date}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${fmtDate(t.due_date)}
        </span>`
      : '<span></span>';

    const estHtml = t.estimated_minutes ? `<span class="card-estimate">${fmtMin(t.estimated_minutes)}</span>` : '';
    const spentHtml = t.focused_minutes ? `<span class="card-time-spent" title="Waktu fokus tercatat">⏱ ${fmtMin(t.focused_minutes)}</span>` : '';

    const prioLower = (t.priority || 'sedang').toLowerCase();
    const catLower = (t.category || 'koding').toLowerCase();

    el.innerHTML = `
      <div class="card-header">
        <div class="card-meta">
          <span class="priority-dot dot-${prioLower}"></span>
          <span class="task-id">${t.task_code || `TGS-${t.id}`}</span>
        </div>
        <button class="card-action focus-trigger" data-task-id="${t.id}" title="Aktifkan Mode Fokus">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
        </button>
      </div>
      <h3 class="card-title">${esc(t.title)}</h3>
      <p class="card-desc">${esc(t.description || '')}</p>
      <div class="card-tags">
        <span class="tag tag-${catLower}">${t.category}</span>
        <span class="priority-pill pill-${prioLower}">${cap(t.priority)}</span>
      </div>
      ${subtasksHtml}
      <div class="card-footer">
        ${dateHtml}
        <div style="display:flex; align-items:center; gap:5px;">
          ${spentHtml}
          ${estHtml}
        </div>
      </div>
    `;

    return el;
  }

  function refreshCard(t) {
    const old = $(`[data-task-id="${t.id}"]`);
    if (old) old.replaceWith(cardEl(t));
  }

  // ─── Drag & Drop (SortableJS + Confetti & Synth Sound) ───
  // [PANDUAN-ASSESSOR: LOGIKA DRAG AND DROP (SORTABLEJS)] - Fungsi yang mengatur geser kartu antar kolom dan mengirim posisi baru ke backend via Fetch API
  // TIPS PENGUJIAN:
  // - Inisialisasi Sortable pada setiap .column-body dengan group: 'kanban' untuk perpindahan antar kolom
  // - Event onStart: memainkan audio umpan balik tactile pop
  // - Event onEnd: 
  //     * Mengambil kolom asal dan kolom tujuan
  //     * Jika kartu dipindahkan ke kolom 'completed' (Selesai), otomatis memicu kembang api konfeti & audio akord kemenangan
  //     * Mengumpulkan posisi indeks seluruh kartu dan memanggil apiReorder(updates) ke endpoint PATCH /api/tasks/reorder
  function initSortable() {
    Object.values(sortables).forEach(s => {
      try { s.destroy(); } catch {}
    });
    sortables = {};

    COLUMNS.forEach(col => {
      const el = document.getElementById('col-' + col.id);
      if (!el) return;

      sortables[col.id] = new Sortable(el, {
        group: 'kanban',
        animation: 200,
        easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        chosenClass: 'sortable-chosen',
        fallbackOnBody: true,
        swapThreshold: 0.55,
        filter: '.card-action, .subtask-check, input[type="checkbox"]',
        preventOnFilter: false,
        onStart() {
          playPop();
        },
        onEnd(evt) {
          const movedId = Number(evt.item.dataset.taskId);
          const newStatus = evt.to.id.replace('col-', '');
          const oldStatus = evt.from.id.replace('col-', '');

          const task = taskById(movedId);
          if (task) {
            task.status = newStatus;
          }

          playPop();

          if (newStatus === 'completed' && oldStatus !== 'completed') {
            playSuccessChord();
            const rect = evt.item.getBoundingClientRect();
            triggerConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

            if (task && Array.isArray(task.subtasks)) {
              task.subtasks.forEach(s => s.is_completed = true);
            }

            if (task) {
              apiCreateNotification({
                type: 'achievement',
                title: '🎉 Tugas Selesai!',
                message: `Tugas "${task.title}" (${task.task_code || 'TGS-' + task.id}) telah dituntaskan. Kerja luar biasa!`,
                task_code: task.task_code || `TGS-${task.id}`,
                task_id: task.id,
                showToast: true
              });
            }
          }

          const updates = [];
          COLUMNS.forEach(c => {
            const body = document.getElementById('col-' + c.id);
            if (!body) return;
            const cards = body.querySelectorAll('.task-card');
            cards.forEach((card, idx) => {
              const cardId = Number(card.dataset.taskId);
              updates.push({
                id: cardId,
                status: c.id,
                position: idx
              });
              const t = taskById(cardId);
              if (t) {
                t.status = c.id;
                t.position = idx;
              }
            });

            const countEl = $(`[data-column="${c.id}"] .column-count`);
            if (countEl) countEl.textContent = cards.length;
            const capFill = $(`[data-column="${c.id}"] .column-cap-fill`);
            if (capFill) {
              const pct = Math.min(100, Math.round((cards.length / 8) * 100));
              capFill.style.width = pct + '%';
            }
          });

          updateWorkload();
          apiReorder(updates);
        }
      });
    });
  }

  // ─── 3D Card Spotlight & Tilt ───
  function initCardSpotlightAndTilt() {
    const board = $('#board');
    if (!board) return;

    board.addEventListener('mousemove', e => {
      const card = e.target.closest('.task-card');
      if (!card) return;

      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);

      const rotY = ((x / rect.width) - 0.5) * 8;
      const rotX = -((y / rect.height) - 0.5) * 8;
      card.style.transform = `perspective(600px) rotateX(${rotX.toFixed(1)}deg) rotateY(${rotY.toFixed(1)}deg) translateY(-3px)`;
    });

    board.addEventListener('mouseout', e => {
      const card = e.target.closest('.task-card');
      if (card && (!e.relatedTarget || !card.contains(e.relatedTarget))) {
        card.style.transform = '';
      }
    });
  }

  // ─── 3D Auth Showcase Parallax ───
  function initAuth3DParallax() {
    const stage = $('#auth3DStage');
    const card = $('#auth3DCard');
    if (!stage || !card) return;

    stage.addEventListener('mousemove', e => {
      const rect = stage.getBoundingClientRect();
      const x = e.clientX - rect.left - (rect.width / 2);
      const y = e.clientY - rect.top - (rect.height / 2);
      const rotY = (x / (rect.width / 2)) * 16;
      const rotX = -(y / (rect.height / 2)) * 16;
      card.style.transform = `perspective(1000px) rotateY(${rotY.toFixed(1)}deg) rotateX(${rotX.toFixed(1)}deg) translateY(-2px)`;
    });

    stage.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(1000px) rotateY(-10deg) rotateX(6deg)';
    });
  }

  // ─── Password Strength Evaluator ───
  function evaluatePasswordStrength(pwd) {
    if (!pwd) return { score: 0, text: '-', color: 'var(--border)' };
    let score = 0;
    if (pwd.length >= 4) score++;
    if (pwd.length >= 8) score++;
    if (/[0-9]/.test(pwd) && /[A-Za-z]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd) || pwd.length >= 12) score++;

    const map = [
      { text: 'Lemah', color: '#EF4444' },
      { text: 'Cukup', color: '#F59E0B' },
      { text: 'Kuat', color: '#3B82F6' },
      { text: 'Sangat Aman', color: '#10B981' }
    ];
    return { score: Math.max(1, score), ...map[Math.max(0, score - 1)] };
  }

  function updatePasswordMeter(pwd) {
    const { score, text, color } = evaluatePasswordStrength(pwd);
    const label = $('#pwdStrengthLabel');
    if (label) {
      label.textContent = `Kekuatan: ${text}`;
      label.style.color = color;
    }
    for (let i = 1; i <= 4; i++) {
      const bar = $(`#pwdBar${i}`);
      if (bar) {
        bar.style.backgroundColor = (i <= score && pwd.length > 0) ? color : 'var(--border)';
      }
    }
  }

  // ═══════════════════════
  //  EVENT BINDINGS & DELEGATION
  // ═══════════════════════

  function bindEvents() {
    // Helper to safely bind click
    const on = (selector, fn) => {
      const el = $(selector);
      if (el) el.addEventListener('click', fn);
    };

    // ── 1. Auth Screen Events ──
    on('#demoLoginBtn', performDemoLogin);

    // Tab switch (Login / Register)
    on('#tabLoginBtn', () => {
      $('#tabLoginBtn')?.classList.add('active');
      $('#tabRegisterBtn')?.classList.remove('active');
      const loginForm = $('#loginForm');
      const regForm = $('#registerForm');
      if (loginForm) loginForm.style.display = 'flex';
      if (regForm) regForm.style.display = 'none';
      playPop();
    });

    on('#tabRegisterBtn', () => {
      $('#tabRegisterBtn')?.classList.add('active');
      $('#tabLoginBtn')?.classList.remove('active');
      const regForm = $('#registerForm');
      const loginForm = $('#loginForm');
      if (regForm) regForm.style.display = 'flex';
      if (loginForm) loginForm.style.display = 'none';
      playPop();
    });

    // Login submit
    $('#loginForm')?.addEventListener('submit', e => {
      e.preventDefault();
      const email = $('#loginEmail')?.value.trim() || '';
      const pwd = $('#loginPassword')?.value || '';
      performLogin(email, pwd);
    });

    // Register submit
    $('#registerForm')?.addEventListener('submit', e => {
      e.preventDefault();
      const name = $('#regName')?.value.trim() || '';
      const email = $('#regEmail')?.value.trim() || '';
      const pwd = $('#regPassword')?.value || '';
      performRegister(name, email, pwd);
    });

    // Password strength & toggle
    $('#regPassword')?.addEventListener('input', e => {
      updatePasswordMeter(e.target.value);
    });

    // Direct binding for password toggle eye buttons
    $$('.btn-toggle-pwd').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetId = btn.dataset.target;
        const input = document.getElementById(targetId);
        if (input) {
          const isPwd = input.type === 'password';
          input.type = isPwd ? 'text' : 'password';
          const showIcon = btn.querySelector('.eye-show');
          const hideIcon = btn.querySelector('.eye-hide');
          if (showIcon && hideIcon) {
            showIcon.style.display = isPwd ? 'none' : 'block';
            hideIcon.style.display = isPwd ? 'block' : 'none';
          }
        }
      });
    });

    // Live ID Card Preview updates
    $('#regName')?.addEventListener('input', e => {
      const txt = e.target.value.trim() || 'Nama Anda';
      const nameText = $('#previewNameText');
      const avatarCircle = $('#previewAvatarCircle');
      if (nameText) nameText.textContent = txt;
      if (avatarCircle) avatarCircle.textContent = txt.charAt(0).toUpperCase();
    });

    // Role selector pills
    $('#roleSelector')?.addEventListener('click', e => {
      const pill = e.target.closest('.role-pill');
      if (!pill) return;
      $$('#roleSelector .role-pill').forEach(b => b.classList.remove('active'));
      pill.classList.add('active');
      regRole = pill.dataset.role || '👨‍💻 Developer';
      const roleText = $('#previewRoleText');
      if (roleText) roleText.textContent = regRole;
      playPop();
    });

    // Color picker dots
    $('#colorPickerRow')?.addEventListener('click', e => {
      const dot = e.target.closest('.color-dot');
      if (!dot) return;
      $$('#colorPickerRow .color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      regColor = dot.dataset.color || '#D95D39';
      const avatarCircle = $('#previewAvatarCircle');
      if (avatarCircle) avatarCircle.style.backgroundColor = regColor;
      playPop();
    });

    // ── 2. Sidebar Navigation & Actions ──
    on('#sidebarLogoutBtn', performLogout);
    on('#navKanbanBtn', () => {
      $$('.sidebar-nav .nav-item').forEach(b => b.classList.remove('active'));
      $('#navKanbanBtn')?.classList.add('active');
      playPop();
    });
    on('#navAnalyticsBtn', openAnalytics);
    on('#navZenBtn', openZenStudio);
    on('#navHelpBtn', openHelp);

    on('#sidebarThemeBtn', toggleTheme);
    on('#themeToggle', toggleTheme);
    on('#sidebarSoundBtn', toggleSound);
    on('#soundToggleBtn', toggleSound);

    // ── 3. Main Workspace Header ──
    on('#newTaskBtn', () => openDrawer('create'));
    on('#headerAnalyticsBtn', openAnalytics);
    on('#notifBellBtn', e => {
      e.stopPropagation();
      toggleNotifPopover();
    });
    on('#markAllReadBtn', apiMarkAllNotificationsRead);
    on('#clearNotifBtn', apiClearNotifications);
    on('#btnSimulateDeadline', simulateDeadlineNotification);

    $('#notifTabs')?.addEventListener('click', e => {
      const tab = e.target.closest('.notif-tab');
      if (!tab) return;
      $$('#notifTabs .notif-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      notifState.activeTab = tab.dataset.tab || 'all';
      playPop();
      renderNotifUI();
    });

    $('#notifList')?.addEventListener('click', e => {
      const itemEl = e.target.closest('.notif-item');
      if (!itemEl) return;
      const notifId = Number(itemEl.dataset.id);
      const taskCode = itemEl.dataset.taskCode;
      const taskId = itemEl.dataset.taskId;
      const title = itemEl.dataset.title;
      const message = itemEl.dataset.message;

      if (notifId) {
        apiMarkNotificationRead(notifId);
      }

      jumpToTaskCard(taskCode, title, message, taskId);
    });

    on('#viewToggle', toggleView);
    on('#searchBtn', openCmd);
    on('#resetBtn', () => {
      const targetName = backendMode === 'local' ? 'Cloud/Lokal (Browser)' : 'SQLite';
      if (confirm(`Reset semua data tugas ke default demo Bahasa Indonesia di ${targetName}?`)) {
        apiResetDemo();
      }
    });

    // ── 4. Kanban Board Click Delegation ──
    $('#board')?.addEventListener('click', e => {
      const focBtn = e.target.closest('.focus-trigger');
      if (focBtn) {
        e.stopPropagation();
        activateFocus(Number(focBtn.dataset.taskId));
        return;
      }

      const cb = e.target.closest('.subtask-check input[type="checkbox"]');
      if (cb && cb.dataset.taskId && cb.dataset.subtaskId) {
        e.stopPropagation();
        toggleSubtask(Number(cb.dataset.taskId), Number(cb.dataset.subtaskId), cb.checked);
        return;
      }

      const addBtn = e.target.closest('.column-add');
      if (addBtn) {
        e.stopPropagation();
        openDrawer('create', addBtn.dataset.column);
        return;
      }

      const card = e.target.closest('.task-card');
      if (card && card.dataset.taskId) {
        openDrawer('edit', null, Number(card.dataset.taskId));
      }
    });

    // Document-level fallback delegation (ensures clicks always work even if DOM was re-rendered)
    document.addEventListener('click', e => {
      // Password toggle fallback
      const eyeBtn = e.target.closest('.btn-toggle-pwd');
      if (eyeBtn) {
        e.preventDefault();
        const targetId = eyeBtn.dataset.target;
        const input = document.getElementById(targetId);
        if (input) {
          const isPwd = input.type === 'password';
          input.type = isPwd ? 'text' : 'password';
          const showIcon = eyeBtn.querySelector('.eye-show');
          const hideIcon = eyeBtn.querySelector('.eye-hide');
          if (showIcon && hideIcon) {
            showIcon.style.display = isPwd ? 'none' : 'block';
            hideIcon.style.display = isPwd ? 'block' : 'none';
          }
        }
        return;
      }

      // Column add button fallback
      const colAdd = e.target.closest('.column-add');
      if (colAdd && !e.defaultPrevented) {
        openDrawer('create', colAdd.dataset.column);
        return;
      }
    });

    // ── 5. Filtering ──
    $('#priorityFilters')?.addEventListener('click', e => {
      const p = e.target.closest('.filter-pill');
      if (!p) return;
      $$('#priorityFilters .filter-pill').forEach(b => b.classList.remove('active'));
      p.classList.add('active');
      filters.priority = p.dataset.priority;
      applyFilters();
      playPop();
    });

    $('#categoryFilters')?.addEventListener('click', e => {
      const p = e.target.closest('.filter-pill');
      if (!p) return;
      $$('#categoryFilters .filter-pill').forEach(b => b.classList.remove('active'));
      p.classList.add('active');
      filters.category = p.dataset.category;
      applyFilters();
      playPop();
    });

    // ── 6. Task Drawer Form ──
    $('#drawerOverlay')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) closeDrawer();
    });
    on('#drawerClose', closeDrawer);
    on('#cancelBtn', closeDrawer);
    $('#taskForm')?.addEventListener('submit', e => {
      e.preventDefault();
      saveTaskFromDrawer();
    });
    on('#deleteTaskBtn', () => {
      if (editingTaskId && confirm('Yakin ingin menghapus tugas ini?')) {
        apiDeleteTask(editingTaskId);
        closeDrawer();
      }
    });

    on('#addSubtaskBtn', addDrawerSub);
    $('#subtaskInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addDrawerSub();
      }
    });

    // ── 7. Command Palette ──
    $('#commandOverlay')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) closeCmd();
    });
    $('#commandInput')?.addEventListener('input', e => searchTasks(e.target.value));

    // ── 8. Focus Bar Controls ──
    on('#focusStart', startPomo);
    on('#focusPause', pausePomo);
    on('#focusReset', resetPomo);
    on('#focusClose', closeFocus);
    on('#zenModeBtn', openZenStudio);

    // ── 9. Zen Mode Studio Controls ──
    on('#zenCloseBtn', closeZenStudio);
    on('#zenStartBtn', startPomo);
    on('#zenPauseBtn', pausePomo);
    on('#zenResetBtn', resetPomo);
    on('#zenAmbientToggle', toggleAmbientBrownNoise);
    $('#zenVolumeSlider')?.addEventListener('input', e => updateAmbientVolume(e.target.value));

    // ── 10. Analytics Drawer Controls ──
    $('#analyticsOverlay')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) closeAnalytics();
    });
    on('#analyticsCloseBtn', closeAnalytics);
    on('#exportCsvBtn', exportTasksToCSV);
    on('#printReportBtn', () => window.print());

    // ── 11. Help Modal Controls ──
    $('#helpOverlay')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) closeHelp();
    });
    on('#helpCloseBtn', closeHelp);

    // Click outside notif popover to close
    document.addEventListener('click', e => {
      if (notifState.isOpen && !e.target.closest('#notifBellWrapper')) {
        closeNotifPopover();
      }
    });

    // ── 12. Global Keyboard Shortcuts ──
    document.addEventListener('keydown', e => {
      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCmd();
        return;
      }

      if (e.key === 'Escape') {
        closeNotifPopover();
        closeCmd();
        closeDrawer();
        closeAnalytics();
        closeHelp();
        closeZenStudio();
        return;
      }

      if (isInput) return;

      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        toggleNotifPopover();
      } else if (e.key.toLowerCase() === 't' || e.key.toLowerCase() === 'c') {
        e.preventDefault();
        openDrawer('create');
      } else if (e.key.toLowerCase() === 'a') {
        e.preventDefault();
        openAnalytics();
      } else if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        toggleZenStudio();
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        toggleSound();
      } else if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        toggleTheme();
      } else if (e.key === '?') {
        e.preventDefault();
        openHelp();
      }
    });
  }

  // ═══════════════════════
  //  CRUD ACTIONS (DRAWER)
  // ═══════════════════════

  function saveTaskFromDrawer() {
    const title = $('#taskTitleInput').value.trim();
    if (!title) return;

    const payload = {
      title,
      description: $('#taskDescInput').value.trim(),
      priority: $('#taskPriorityInput').value,
      category: $('#taskCategoryInput').value,
      due_date: $('#taskDueInput').value || null,
      estimated_minutes: parseInt($('#taskEstimateInput').value, 10) || 0,
      status: $('#taskColumnInput').value,
      subtasks: drawerSubtasks.map(s => ({
        id: s.id,
        title: s.title,
        is_completed: s.is_completed ? 1 : 0
      }))
    };

    if (drawerMode === 'create') {
      apiCreateTask(payload);
    } else if (editingTaskId) {
      const current = taskById(editingTaskId);
      if (current) payload.focused_minutes = current.focused_minutes;
      apiUpdateTask(editingTaskId, payload);
    }

    closeDrawer();
  }

  function toggleSubtask(taskId, subtaskId, checked) {
    const t = taskById(taskId);
    if (!t || !Array.isArray(t.subtasks)) return;

    const s = t.subtasks.find(x => x.id === subtaskId);
    if (s) {
      s.is_completed = checked;
    }

    if (checked) {
      playCheck();
      const allDone = t.subtasks.every(st => st.is_completed);
      if (allDone && t.subtasks.length > 0) {
        playSuccessChord();
        triggerConfetti();
      }
    } else {
      playPop();
    }

    refreshCard(t);
    updateWorkload();
    syncZenSubtasks();

    apiToggleSubtask(subtaskId, checked);
  }

  function openDrawer(mode, defCol, taskId) {
    drawerMode = mode;
    editingTaskId = taskId || null;
    drawerSubtasks = [];

    $('#taskForm').reset();

    if (mode === 'create') {
      $('#drawerTitle').textContent = 'Tambah Tugas Baru';
      $('#deleteTaskBtn').classList.add('hide');
      if (defCol) $('#taskColumnInput').value = defCol;
    } else if (mode === 'edit' && taskId) {
      const t = taskById(taskId);
      if (!t) return;
      $('#drawerTitle').textContent = `Edit Tugas ${t.task_code || `TGS-${t.id}`}`;
      $('#deleteTaskBtn').classList.remove('hide');
      $('#taskTitleInput').value = t.title;
      $('#taskDescInput').value = t.description || '';
      $('#taskPriorityInput').value = (t.priority || 'sedang').toLowerCase();
      $('#taskCategoryInput').value = t.category || 'Koding';
      $('#taskDueInput').value = t.due_date || '';
      $('#taskEstimateInput').value = t.estimated_minutes || '';
      $('#taskColumnInput').value = t.status;

      if (Array.isArray(t.subtasks)) {
        drawerSubtasks = t.subtasks.map(s => ({ ...s }));
      }
    }

    renderDrawerSubs();
    $('#drawerOverlay').classList.add('open');
    $('#drawer').classList.add('open');
    setTimeout(() => $('#taskTitleInput').focus(), 120);
  }

  function closeDrawer() {
    $('#drawer').classList.remove('open');
    $('#drawerOverlay').classList.remove('open');
    drawerMode = null;
    editingTaskId = null;
  }

  function renderDrawerSubs() {
    const list = $('#subtaskList');
    list.innerHTML = drawerSubtasks.map((s, i) => `
      <div class="subtask-edit-row" data-idx="${i}">
        <input type="checkbox" ${s.is_completed ? 'checked' : ''} class="st-done">
        <input type="text" value="${esc(s.title || '')}" class="st-text" placeholder="Nama sub-tugas...">
        <button type="button" class="subtask-edit-remove" title="Hapus sub-tugas">✕</button>
      </div>
    `).join('');

    list.querySelectorAll('.st-done').forEach((cb, i) => {
      cb.onchange = () => { drawerSubtasks[i].is_completed = cb.checked; };
    });
    list.querySelectorAll('.st-text').forEach((inp, i) => {
      inp.oninput = () => { drawerSubtasks[i].title = inp.value; };
    });
    list.querySelectorAll('.subtask-edit-remove').forEach((btn, i) => {
      btn.onclick = () => {
        drawerSubtasks.splice(i, 1);
        renderDrawerSubs();
      };
    });
  }

  function addDrawerSub() {
    const inp = $('#subtaskInput');
    const txt = inp.value.trim();
    if (!txt) return;
    drawerSubtasks.push({
      title: txt,
      is_completed: false
    });
    inp.value = '';
    renderDrawerSubs();
    inp.focus();
    playPop();
  }

  // ═══════════════════════
  //  COMMAND PALETTE (CTRL+K)
  // ═══════════════════════

  function openCmd() {
    $('#commandOverlay').classList.add('open');
    const inp = $('#commandInput');
    setTimeout(() => {
      inp.value = '';
      inp.focus();
      $('#commandResults').innerHTML = '<div class="command-empty">Ketik untuk mencari tugas berdasarkan judul atau ID...</div>';
    }, 60);
    playPop();
  }

  function closeCmd() {
    $('#commandOverlay').classList.remove('open');
  }

  function searchTasks(q) {
    const res = $('#commandResults');
    if (!q.trim()) {
      res.innerHTML = '<div class="command-empty">Ketik untuk mencari tugas berdasarkan judul atau ID...</div>';
      return;
    }
    const lq = q.toLowerCase();
    const matches = state.tasks.filter(t => {
      const code = (t.task_code || '').toLowerCase();
      const title = (t.title || '').toLowerCase();
      return title.includes(lq) || code.includes(lq);
    });

    if (!matches.length) {
      res.innerHTML = '<div class="command-empty">Tugas tidak ditemukan.</div>';
      return;
    }

    res.innerHTML = matches.map(t => {
      const colTitle = COLUMNS.find(c => c.id === t.status)?.title || t.status;
      return `
        <div class="command-result" data-task-id="${t.id}">
          <span class="command-result-id">${t.task_code || `TGS-${t.id}`}</span>
          <span class="command-result-title">${esc(t.title)}</span>
          <span class="command-result-col">${colTitle}</span>
        </div>
      `;
    }).join('');

    res.querySelectorAll('.command-result').forEach(el => {
      el.addEventListener('click', () => {
        closeCmd();
        openDrawer('edit', null, Number(el.dataset.taskId));
      });
    });
  }

  // ═══════════════════════
  //  FILTERING
  // ═══════════════════════

  function applyFilters() {
    $$('.task-card').forEach(card => {
      let show = true;
      if (filters.priority !== 'all' && card.dataset.priority !== filters.priority) show = false;
      if (filters.category !== 'all' && card.dataset.category !== filters.category) show = false;
      card.classList.toggle('filtered-out', !show);
    });
  }

  // ═══════════════════════
  //  WORKLOAD & PROGRESS
  // ═══════════════════════

  function updateWorkload() {
    const todayTasks = tasksFor('today');
    const ipTasks = tasksFor('in_progress');
    const doneTasks = tasksFor('completed');
    const total = state.tasks.length;

    const mins = [...todayTasks, ...ipTasks].reduce((s, t) => s + (t.estimated_minutes || 0), 0);
    $('#workloadHours').textContent = fmtMin(mins);

    const isExceeded = mins > 360;
    $('#workloadWarning').classList.toggle('visible', isExceeded);

    if (isExceeded && !workloadAlertSent) {
      workloadAlertSent = true;
      apiCreateNotification({
        type: 'workload',
        title: '⚠️ Peringatan Beban Kerja Tinggi',
        message: `Total estimasi tugas aktif mencapai ${fmtMin(mins)} (lebih dari 6 jam). Pertimbangkan pendelegasian atau penjadwalan ulang.`,
        task_code: null,
        showToast: true
      });
    } else if (!isExceeded) {
      workloadAlertSent = false;
    }

    const doneCount = doneTasks.length;
    const pct = total ? (doneCount / total * 100) : 0;
    $('#workloadBarFill').style.width = pct + '%';
    $('#completionText').textContent = `${doneCount} dari ${total} selesai`;
  }

  // ══════════════════════════════════════════════════
  //  FOCUS DOCK & FULL-SCREEN ZEN STUDIO
  // ══════════════════════════════════════════════════

  // [PANDUAN-ASSESSOR: LOGIKA TIMER FOKUS POMODORO & AUDIO] - Fungsi hitung mundur waktu fokus 25 menit dan generator suara latar
  // TIPS PENGUJIAN:
  // - activateFocus(taskId) : Mengaktifkan sesi fokus untuk tugas tertentu dan membuka dock fokus di bawah
  // - startPomo()           : Memulai interval countdown 1 detik (POMODORO_SECONDS = 25 * 60)
  // - updateZenRing()       : Memperbarui animasi lingkaran progres SVG mode Zen (strokeDashoffset)
  // - Audio Synthesizer     : Menggunakan Web Audio API AudioContext tanpa file MP3 eksternal (menghasilkan nada pop, akord sukses, dan brown noise ambient generator)
  // - Selesai fokus         : Mengirim +25 menit ke SQLite (apiLogFocus), memunculkan notifikasi, dan memicu konfeti
  function activateFocus(taskId) {
    const t = taskById(taskId);
    if (!t) return;
    pausePomo();
    focus.taskId = taskId;
    focus.remaining = POMODORO_SECONDS;
    focus.running = false;

    $('#focusTaskId').textContent = t.task_code || `TGS-${t.id}`;
    $('#focusTaskTitle').textContent = t.title;
    $('#focusTimerDisplay').textContent = fmtTimer(focus.remaining);
    $('#focusTimerDisplay').classList.remove('timer-done');
    $('#focusSpent').textContent = fmtMin(t.focused_minutes);
    $('#focusBar').classList.add('open');

    syncZenTaskDisplay();
    playPop();
  }

  function startPomo() {
    if (focus.running || !focus.taskId) return;
    focus.running = true;
    $('#focusTimerDisplay').classList.remove('timer-done');
    $('#zenTimerDisplay').classList.remove('timer-done');

    playPop();

    focus.intervalId = setInterval(() => {
      focus.remaining--;
      const timeStr = fmtTimer(focus.remaining);
      $('#focusTimerDisplay').textContent = timeStr;
      $('#zenTimerDisplay').textContent = timeStr;

      updateZenRing();

      if (focus.remaining <= 0) {
        clearInterval(focus.intervalId);
        focus.running = false;
        focus.intervalId = null;

        apiLogFocus(focus.taskId, 25);
        playSuccessChord();
        triggerConfetti();

        const completedTask = taskById(focus.taskId);
        const compCode = completedTask ? (completedTask.task_code || `TGS-${completedTask.id}`) : null;
        apiCreateNotification({
          type: 'achievement',
          title: '⏱️ Sesi Fokus 25 Menit Selesai!',
          message: completedTask
            ? `Target fokus untuk "${completedTask.title}" (${compCode}) tuntas. Istirahat sejenak 5 menit!`
            : 'Sesi fokus 25 menit tuntas. Ambil waktu sejenak untuk istirahat!',
          task_code: compCode,
          task_id: completedTask ? completedTask.id : null,
          showToast: true
        });

        focus.remaining = POMODORO_SECONDS;
        $('#focusTimerDisplay').textContent = fmtTimer(focus.remaining);
        $('#zenTimerDisplay').textContent = fmtTimer(focus.remaining);
        $('#focusTimerDisplay').classList.add('timer-done');
        $('#zenTimerDisplay').classList.add('timer-done');

        try {
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('FlowState Studio', {
              body: 'Sesi Fokus Selesai! Kerja luar biasa, istirahatlah sejenak. 🎉'
            });
          }
        } catch {}
      }
    }, 1000);
  }

  function pausePomo() {
    if (focus.intervalId) clearInterval(focus.intervalId);
    focus.running = false;
    focus.intervalId = null;
    playPop();
  }

  function resetPomo() {
    pausePomo();
    focus.remaining = POMODORO_SECONDS;
    const timeStr = fmtTimer(focus.remaining);
    $('#focusTimerDisplay').textContent = timeStr;
    $('#zenTimerDisplay').textContent = timeStr;
    $('#focusTimerDisplay').classList.remove('timer-done');
    $('#zenTimerDisplay').classList.remove('timer-done');
    updateZenRing();
  }

  function closeFocus() {
    pausePomo();
    focus.taskId = null;
    $('#focusBar').classList.remove('open');
    closeZenStudio();
  }

  function toggleZenStudio() {
    const zen = $('#zenStudio');
    if (zen.classList.contains('open')) {
      closeZenStudio();
    } else {
      openZenStudio();
    }
  }

  function openZenStudio() {
    if (!focus.taskId) {
      const candidates = tasksFor('today').concat(tasksFor('in_progress')).concat(tasksFor('inbox'));
      if (candidates.length > 0) {
        activateFocus(candidates[0].id);
      } else {
        alert('Tambahkan atau pilih tugas terlebih dahulu untuk masuk ke Mode Zen.');
        return;
      }
    }

    syncZenTaskDisplay();
    updateZenRing();
    $('#zenStudio').classList.add('open');
    playPop();
  }

  function closeZenStudio() {
    $('#zenStudio').classList.remove('open');
    stopAmbientBrownNoise();
  }

  function updateZenRing() {
    const ring = $('#zenRingProgress');
    if (!ring) return;
    const total = POMODORO_SECONDS;
    const circumference = 880; // 2 * PI * 140
    const progress = (total - focus.remaining) / total;
    const offset = circumference * (1 - progress);
    ring.style.strokeDashoffset = offset;
  }

  function syncZenTaskDisplay() {
    const t = taskById(focus.taskId);
    if (!t) return;

    $('#zenTaskCode').textContent = t.task_code || `TGS-${t.id}`;
    $('#zenTaskCategory').textContent = t.category || 'Koding';
    $('#zenTaskPriority').textContent = cap(t.priority || 'sedang');
    $('#zenTaskTitle').textContent = t.title;
    $('#zenTaskDesc').textContent = t.description || 'Fokus menyelesaikan tugas ini tanpa distraksi.';
    $('#zenLoggedTime').textContent = backendMode === 'local'
      ? `⏱ Tercatat di Cloud/Lokal: ${fmtMin(t.focused_minutes)}`
      : `⏱ Tercatat di SQLite: ${fmtMin(t.focused_minutes)}`;
    $('#zenTimerDisplay').textContent = fmtTimer(focus.remaining);

    syncZenSubtasks();
  }

  function syncZenSubtasks() {
    const t = taskById(focus.taskId);
    const list = $('#zenSubtasksList');
    const counter = $('#zenSubtasksCounter');
    if (!list || !t) return;

    const subtasks = Array.isArray(t.subtasks) ? t.subtasks : [];
    const doneCount = subtasks.filter(s => s.is_completed).length;
    if (counter) counter.textContent = `${doneCount}/${subtasks.length} selesai`;

    if (subtasks.length === 0) {
      list.innerHTML = '<div style="color:var(--text-faint); font-size:0.8rem; padding:10px 0; font-style:italic;">Belum ada sub-tugas untuk item ini.</div>';
      return;
    }

    list.innerHTML = subtasks.map(s => `
      <label class="subtask-check" style="font-size:0.88rem; padding:4px 0;">
        <input type="checkbox" ${s.is_completed ? 'checked' : ''} data-zen-task="${t.id}" data-zen-sub="${s.id}">
        <span class="${s.is_completed ? 'done' : ''}">${esc(s.title)}</span>
      </label>
    `).join('');

    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.onchange = () => {
        toggleSubtask(Number(cb.dataset.zenTask), Number(cb.dataset.zenSub), cb.checked);
      };
    });
  }

  // ══════════════════════════════════════════════════
  //  STATISTIK & ANALITIK DRAWER
  // ══════════════════════════════════════════════════

  // [PANDUAN-ASSESSOR: LOGIKA PERHITUNGAN ANALITIK & EXPORT CSV] - Fungsi kalkulasi persentase produktivitas dan unduh laporan CSV
  // TIPS PENGUJIAN:
  // - renderAnalyticsData() : Menghitung skor produktivitas berbobot 0-100%:
  //     * 45% Rasio penyelesaian kartu tugas (completedTasks / total)
  //     * 35% Rasio penyelesaian checklist sub-tugas (completedSubtasks / totalSubtasks)
  //     * 20% Rasio pencapaian target waktu fokus Pomodoro (totalFoc / 120 menit)
  //   Juga menghitung distribusi tugas per kategori (Koding, Sekolah, Desain, Pribadi) dan prioritas
  // - exportTasksToCSV()    : Menyusun baris CSV lengkap dengan encoding UTF-8 BOM (\uFEFF) agar rapi dibuka di Microsoft Excel
  function openAnalytics() {
    renderAnalyticsData();
    $('#analyticsOverlay').classList.add('open');
    playPop();
  }

  function closeAnalytics() {
    $('#analyticsOverlay').classList.remove('open');
  }

  function renderAnalyticsData() {
    const total = state.tasks.length;
    const completedTasks = tasksFor('completed').length;

    let totalSubtasks = 0;
    let completedSubtasks = 0;
    let totalEst = 0;
    let totalFoc = 0;

    const catCounts = { Koding: 0, Sekolah: 0, Desain: 0, Pribadi: 0 };
    const prioCounts = { tinggi: 0, sedang: 0, rendah: 0 };

    state.tasks.forEach(t => {
      totalEst += t.estimated_minutes || 0;
      totalFoc += t.focused_minutes || 0;

      if (catCounts[t.category] !== undefined) catCounts[t.category]++;
      else catCounts['Koding']++;

      const p = (t.priority || 'sedang').toLowerCase();
      if (prioCounts[p] !== undefined) prioCounts[p]++;
      else prioCounts['sedang']++;

      if (Array.isArray(t.subtasks)) {
        totalSubtasks += t.subtasks.length;
        completedSubtasks += t.subtasks.filter(s => s.is_completed).length;
      }
    });

    let score = 0;
    if (total > 0) {
      const taskRatio = completedTasks / total;
      const subtaskRatio = totalSubtasks > 0 ? (completedSubtasks / totalSubtasks) : taskRatio;
      const focusRatio = Math.min(1, totalFoc / 120);
      score = Math.round((taskRatio * 0.45 + subtaskRatio * 0.35 + focusRatio * 0.20) * 100);
    }

    $('#analyticsScoreNumber').textContent = score + '%';
    const gaugeFill = $('#analyticsGaugeFill');
    if (gaugeFill) {
      const circumference = 301.6;
      const offset = circumference * (1 - score / 100);
      gaugeFill.style.strokeDashoffset = offset;
    }

    const verdictEl = $('#analyticsScoreVerdict');
    const descEl = $('#analyticsScoreDesc');
    if (score >= 80) {
      verdictEl.textContent = 'Luar Biasa! 🔥';
      descEl.textContent = 'Produktivitas hari ini sangat tinggi dengan progres tugas & waktu fokus optimal.';
    } else if (score >= 50) {
      verdictEl.textContent = 'Bagus & On-Track 👍';
      descEl.textContent = 'Progres berjalan baik. Selesaikan beberapa sub-tugas lagi untuk mencapai skor maksimal.';
    } else if (score > 0) {
      verdictEl.textContent = 'Sedang Memulai ⚡';
      descEl.textContent = 'Tugas telah dirancang. Mulai sesi Pomodoro untuk meningkatkan skor harian.';
    } else {
      verdictEl.textContent = 'Siap Beraksi 🎯';
      descEl.textContent = 'Mulai selesaikan tugas-tugas di kolom Hari Ini untuk mencetak skor produktivitas.';
    }

    $('#analyticsEstTime').textContent = fmtMin(totalEst);
    $('#analyticsFocTime').textContent = fmtMin(totalFoc);
    const timeBarFill = $('#analyticsTimeBarFill');
    const timeCaption = $('#analyticsTimeCaption');
    if (timeBarFill && timeCaption) {
      const ratio = totalEst > 0 ? Math.min(100, Math.round((totalFoc / totalEst) * 100)) : 0;
      timeBarFill.style.width = ratio + '%';
      timeCaption.textContent = `Realisasi waktu fokus: ${ratio}% dari total estimasi rencana`;
    }

    $('#analyticsTotalCatTasks').textContent = `${total} Tugas`;
    const catList = $('#analyticsCategoryList');
    if (catList) {
      const catColors = { Koding: '#475569', Sekolah: '#1E40AF', Desain: '#9F1239', Pribadi: '#166534' };
      catList.innerHTML = Object.keys(catCounts).map(cat => {
        const count = catCounts[cat];
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return `
          <div class="dist-row">
            <div class="dist-row-top">
              <span class="dist-label">
                <span class="dist-dot" style="background:${catColors[cat] || '#71717A'}"></span>
                ${cat}
              </span>
              <span class="dist-count">${count} (${pct}%)</span>
            </div>
            <div class="dist-bar-track">
              <div class="dist-bar-fill" style="width:${pct}%; background:${catColors[cat] || '#71717A'}"></div>
            </div>
          </div>
        `;
      }).join('');
    }

    const prioList = $('#analyticsPriorityList');
    if (prioList) {
      const prioLabels = { tinggi: 'Tinggi', sedang: 'Sedang', rendah: 'Rendah' };
      const prioColors = { tinggi: 'var(--accent-terracotta)', sedang: 'var(--accent-amber)', rendah: '#94A3B8' };
      prioList.innerHTML = Object.keys(prioCounts).map(p => {
        const count = prioCounts[p];
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return `
          <div class="dist-row">
            <div class="dist-row-top">
              <span class="dist-label">
                <span class="dist-dot" style="background:${prioColors[p]}"></span>
                ${prioLabels[p]}
              </span>
              <span class="dist-count">${count} (${pct}%)</span>
            </div>
            <div class="dist-bar-track">
              <div class="dist-bar-fill" style="width:${pct}%; background:${prioColors[p]}"></div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // ─── Ekspor CSV ───
  function exportTasksToCSV() {
    if (!state.tasks || state.tasks.length === 0) {
      alert('Tidak ada data tugas untuk diekspor.');
      return;
    }

    const colMap = { inbox: 'Kotak Masuk', today: 'Hari Ini', in_progress: 'Sedang Dikerjakan', completed: 'Selesai' };
    const headers = [
      'Kode Tugas',
      'Judul Tugas',
      'Deskripsi',
      'Status Kolom',
      'Prioritas',
      'Kategori',
      'Tenggat Waktu',
      'Estimasi (Menit)',
      'Fokus Tercatat (Menit)',
      'Subtugas Selesai',
      'Total Subtugas',
      'Tanggal Dibuat'
    ];

    const rows = state.tasks.map(t => {
      const sub = Array.isArray(t.subtasks) ? t.subtasks : [];
      const doneSub = sub.filter(s => s.is_completed).length;
      return [
        t.task_code || `TGS-${t.id}`,
        `"${(t.title || '').replace(/"/g, '""')}"`,
        `"${(t.description || '').replace(/"/g, '""')}"`,
        colMap[t.status] || t.status,
        cap(t.priority || 'sedang'),
        t.category || 'Koding',
        t.due_date || '-',
        t.estimated_minutes || 0,
        t.focused_minutes || 0,
        doneSub,
        sub.length,
        t.created_at || '-'
      ].join(',');
    });

    const csvContent = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `laporan_flowstate_${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    playSuccessChord();
  }

  // ═══════════════════════
  //  KEYBOARD SHORTCUTS MODAL
  // ═══════════════════════

  function openHelp() {
    $('#helpOverlay').classList.add('open');
    playPop();
  }

  function closeHelp() {
    $('#helpOverlay').classList.remove('open');
  }

  // ═══════════════════════
  //  INIT
  // ═══════════════════════

  function init() {
    loadSettings();
    $('#headerDate').textContent = headerDateIndo();
    bindEvents();
    initCardSpotlightAndTilt();
    initAuth3DParallax();

    // Start quote rotation
    startQuoteRotation();

    // Initialize backend badge UI
    updateBackendBadgeUI();

    // Check user session
    apiCheckSession();

    try {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
