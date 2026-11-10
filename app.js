(function () {
  'use strict';

  /* ═══════════════════════════════════════
     FlowState — Application Logic
     ═══════════════════════════════════════ */

  // ─── Configuration ───
  const COLUMNS = [
    { id: 'inbox',       title: 'Inbox',       color: '#71717A' },
    { id: 'today',       title: 'Today',       color: '#D95D39' },
    { id: 'in-progress', title: 'In Progress', color: '#D97706' },
    { id: 'completed',   title: 'Completed',   color: '#2A6F4E' },
  ];
  const POMODORO_SECONDS = 25 * 60;
  const STORAGE_KEY = 'flowstate_v1';

  // ─── State ───
  let state = { tasks: [], nextIdNum: 107, darkMode: false, compactView: false };
  let focus = { taskId: null, remaining: POMODORO_SECONDS, running: false, intervalId: null };
  let filters = { priority: 'all', category: 'all' };
  let drawerMode = null;          // 'create' | 'edit'
  let editingTaskId = null;
  let drawerSubtasks = [];
  let sortables = {};

  // ─── Helpers ───
  const $ = (s, p) => (p || document).querySelector(s);
  const $$ = (s, p) => (p || document).querySelectorAll(s);

  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function fmtDate(d) {
    if (!d) return '';
    const o = new Date(d + 'T00:00:00');
    return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][o.getMonth()] + ' ' + o.getDate();
  }
  function fmtMin(m) {
    if (!m) return '';
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60), r = m % 60;
    return r ? h + 'h ' + r + 'm' : h + 'h';
  }
  function fmtTimer(s) {
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function headerDate() {
    const d = new Date();
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return days[d.getDay()] + ', ' + mons[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }
  function isOverdue(d) { return d && new Date() > new Date(d + 'T23:59:59'); }
  function isDueSoon(d) {
    if (!d) return false;
    const diff = (new Date(d + 'T23:59:59') - new Date()) / 864e5;
    return diff >= 0 && diff <= 1;
  }

  // ─── Seed Data ───
  function seedData() {
    return {
      tasks: [
        {
          id:'FLW-101', title:'Review database schema diagram',
          description:'Analyze the current schema for optimization opportunities and ensure relationships are well defined.',
          priority:'low', category:'Dev', column:'inbox',
          subtasks:[
            {id:'s1',text:'Check table relationships',done:false},
            {id:'s2',text:'Validate indexes',done:false},
            {id:'s3',text:'Review migration scripts',done:false}
          ],
          dueDate:'2026-11-14', estimatedMinutes:45, timeSpent:0, createdAt:'2026-11-09T10:00:00Z'
        },
        {
          id:'FLW-102', title:'Research caching strategies',
          description:'Compare different caching approaches for the API layer and draft an architecture proposal.',
          priority:'medium', category:'Study', column:'inbox',
          subtasks:[
            {id:'s4',text:'Compare Redis vs Memcached',done:false},
            {id:'s5',text:'Read about CDN caching patterns',done:false},
            {id:'s6',text:'Draft caching architecture doc',done:false}
          ],
          dueDate:'2026-11-15', estimatedMinutes:60, timeSpent:0, createdAt:'2026-11-09T11:00:00Z'
        },
        {
          id:'FLW-103', title:'Refactor API authentication middleware',
          description:'Modernize the auth layer with JWT refresh tokens and improved error handling.',
          priority:'high', category:'Dev', column:'today',
          subtasks:[
            {id:'s7',text:'Audit current auth flow',done:true},
            {id:'s8',text:'Implement JWT refresh logic',done:false},
            {id:'s9',text:'Write integration tests',done:false},
            {id:'s10',text:'Update API documentation',done:false}
          ],
          dueDate:'2026-11-12', estimatedMinutes:90, timeSpent:25, createdAt:'2026-11-08T09:00:00Z'
        },
        {
          id:'FLW-104', title:'Prepare presentation deck',
          description:'Create slides for the Q4 team retrospective meeting with charts and talking points.',
          priority:'high', category:'Personal', column:'today',
          subtasks:[
            {id:'s11',text:'Draft outline',done:true},
            {id:'s12',text:'Create slide layouts',done:true},
            {id:'s13',text:'Add charts and visuals',done:false},
            {id:'s14',text:'Practice run-through',done:false}
          ],
          dueDate:'2026-11-10', estimatedMinutes:60, timeSpent:15, createdAt:'2026-11-08T14:00:00Z'
        },
        {
          id:'FLW-105', title:'Finish UI layout & responsive grid',
          description:'Complete the responsive grid system and ensure cross-browser compatibility.',
          priority:'medium', category:'Design', column:'in-progress',
          subtasks:[
            {id:'s15',text:'Set up CSS grid system',done:true},
            {id:'s16',text:'Build mobile breakpoints',done:true},
            {id:'s17',text:'Test on tablet viewport',done:false},
            {id:'s18',text:'Cross-browser testing',done:false}
          ],
          dueDate:'2026-11-11', estimatedMinutes:120, timeSpent:50, createdAt:'2026-11-07T10:00:00Z'
        },
        {
          id:'FLW-106', title:'Write unit tests for payment module',
          description:'Add comprehensive test coverage for the payment processing pipeline.',
          priority:'medium', category:'Dev', column:'completed',
          subtasks:[
            {id:'s19',text:'Test payment processing',done:true},
            {id:'s20',text:'Test refund flow',done:true},
            {id:'s21',text:'Test error handling',done:true}
          ],
          dueDate:'2026-11-09', estimatedMinutes:75, timeSpent:75, createdAt:'2026-11-06T09:00:00Z'
        }
      ],
      nextIdNum: 107,
      darkMode: false,
      compactView: false
    };
  }

  // ─── Persistence ───
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      state = raw ? JSON.parse(raw) : seedData();
    } catch { state = seedData(); }
    save();
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }

  function taskById(id) { return state.tasks.find(t => t.id === id); }
  function tasksFor(col) { return state.tasks.filter(t => t.column === col); }
  function genId() { return 'FLW-' + state.nextIdNum++; }
  function genSid() { return 'st-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7); }

  // ═══════════════════════
  //  RENDERING
  // ═══════════════════════

  function renderBoard() {
    const board = $('#board');
    board.innerHTML = '';

    COLUMNS.forEach(col => {
      const div = document.createElement('div');
      div.className = 'column';
      div.dataset.column = col.id;

      const tasks = tasksFor(col.id);

      div.innerHTML =
        '<div class="column-header">' +
          '<span class="column-indicator" style="background:' + col.color + '"></span>' +
          '<h2 class="column-title">' + col.title + '</h2>' +
          '<span class="column-count">' + tasks.length + '</span>' +
          '<button class="column-add" data-column="' + col.id + '" title="Add task to ' + col.title + '">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="column-body" id="col-' + col.id + '"></div>';

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
    el.className = 'task-card' + (t.column === 'completed' ? ' is-completed' : '');
    el.dataset.taskId = t.id;
    el.dataset.priority = t.priority;
    el.dataset.category = t.category;

    const done = t.subtasks.filter(s => s.done).length;
    const total = t.subtasks.length;
    const pct = total ? (done / total * 100) : 0;

    let subtasksHtml = '';
    if (total) {
      const items = t.subtasks.map(s =>
        '<label class="subtask-check">' +
          '<input type="checkbox"' + (s.done ? ' checked' : '') + ' data-task-id="' + t.id + '" data-subtask-id="' + s.id + '">' +
          '<span class="' + (s.done ? 'done' : '') + '">' + esc(s.text) + '</span>' +
        '</label>'
      ).join('');
      subtasksHtml =
        '<div class="card-subtasks">' +
          '<div class="subtask-summary">' +
            '<span class="subtask-count">' + done + '/' + total + '</span>' +
            '<div class="subtask-bar"><div class="subtask-bar-fill" style="width:' + pct + '%"></div></div>' +
          '</div>' +
          '<div class="subtask-items">' + items + '</div>' +
        '</div>';
    }

    const dueCls = (isOverdue(t.dueDate) && t.column !== 'completed') ? ' overdue'
                 : isDueSoon(t.dueDate) ? ' due-soon' : '';

    const dateHtml = t.dueDate
      ? '<span class="card-date' + dueCls + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ' + fmtDate(t.dueDate) + '</span>'
      : '<span></span>';

    const estHtml = t.estimatedMinutes ? '<span class="card-estimate">' + fmtMin(t.estimatedMinutes) + '</span>' : '';
    const spentHtml = t.timeSpent ? '<span class="card-time-spent">⏱ ' + fmtMin(t.timeSpent) + '</span>' : '';

    el.innerHTML =
      '<div class="card-header">' +
        '<div class="card-meta">' +
          '<span class="priority-dot dot-' + t.priority + '"></span>' +
          '<span class="task-id">' + t.id + '</span>' +
        '</div>' +
        '<button class="card-action focus-trigger" data-task-id="' + t.id + '" title="Focus">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>' +
        '</button>' +
      '</div>' +
      '<h3 class="card-title">' + esc(t.title) + '</h3>' +
      '<p class="card-desc">' + esc(t.description || '') + '</p>' +
      '<div class="card-tags">' +
        '<span class="tag tag-' + t.category.toLowerCase() + '">' + t.category + '</span>' +
        '<span class="priority-pill pill-' + t.priority + '">' + cap(t.priority) + '</span>' +
      '</div>' +
      subtasksHtml +
      '<div class="card-footer">' + dateHtml + '<div>' + spentHtml + estHtml + '</div></div>';

    return el;
  }

  // ─── SortableJS ───
  function initSortable() {
    Object.values(sortables).forEach(s => s.destroy());
    sortables = {};

    COLUMNS.forEach(col => {
      const el = document.getElementById('col-' + col.id);
      if (!el) return;

      sortables[col.id] = new Sortable(el, {
        group: 'kanban',
        animation: 180,
        easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        chosenClass: 'sortable-chosen',
        fallbackOnBody: true,
        swapThreshold: 0.55,
        filter: '.card-action, .subtask-check, input[type="checkbox"]',
        preventOnFilter: false,
        onEnd(evt) {
          const id = evt.item.dataset.taskId;
          const newCol = evt.to.id.replace('col-', '');
          const task = taskById(id);
          if (!task) return;
          task.column = newCol;
          if (newCol === 'completed') task.subtasks.forEach(s => s.done = true);
          syncOrder();
          save();
          renderBoard();
        }
      });
    });
  }

  function syncOrder() {
    const ordered = [];
    COLUMNS.forEach(col => {
      const body = document.getElementById('col-' + col.id);
      if (!body) return;
      body.querySelectorAll('.task-card').forEach(c => {
        const t = taskById(c.dataset.taskId);
        if (t) ordered.push(t);
      });
    });
    if (ordered.length === state.tasks.length) state.tasks = ordered;
  }


  // ═══════════════════════
  //  EVENT HANDLING
  // ═══════════════════════

  function bindEvents() {
    // — New task
    $('#newTaskBtn').addEventListener('click', () => openDrawer('create'));

    // — Board delegation
    $('#board').addEventListener('click', e => {
      const focBtn = e.target.closest('.focus-trigger');
      if (focBtn) { e.stopPropagation(); activateFocus(focBtn.dataset.taskId); return; }

      const cb = e.target.closest('.subtask-check input[type="checkbox"]');
      if (cb) { e.stopPropagation(); toggleSubtask(cb.dataset.taskId, cb.dataset.subtaskId, cb.checked); return; }

      const addBtn = e.target.closest('.column-add');
      if (addBtn) { openDrawer('create', addBtn.dataset.column); return; }

      const card = e.target.closest('.task-card');
      if (card) openDrawer('edit', null, card.dataset.taskId);
    });

    // — Filters
    $('#priorityFilters').addEventListener('click', e => {
      const p = e.target.closest('.filter-pill');
      if (!p) return;
      $$('#priorityFilters .filter-pill').forEach(b => b.classList.remove('active'));
      p.classList.add('active');
      filters.priority = p.dataset.priority;
      applyFilters();
    });
    $('#categoryFilters').addEventListener('click', e => {
      const p = e.target.closest('.filter-pill');
      if (!p) return;
      $$('#categoryFilters .filter-pill').forEach(b => b.classList.remove('active'));
      p.classList.add('active');
      filters.category = p.dataset.category;
      applyFilters();
    });

    // — Header actions
    $('#themeToggle').addEventListener('click', toggleTheme);
    $('#viewToggle').addEventListener('click', toggleView);
    $('#searchBtn').addEventListener('click', openCmd);
    $('#resetBtn').addEventListener('click', () => {
      if (!confirm('Reset all data to demo defaults?')) return;
      localStorage.removeItem(STORAGE_KEY);
      state = seedData();
      save();
      applySettings();
      renderBoard();
    });

    // — Drawer
    $('#drawerOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeDrawer(); });
    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#cancelBtn').addEventListener('click', closeDrawer);
    $('#taskForm').addEventListener('submit', e => { e.preventDefault(); saveTask(); });
    $('#deleteTaskBtn').addEventListener('click', () => {
      if (editingTaskId && confirm('Delete this task?')) { deleteTask(editingTaskId); closeDrawer(); }
    });
    $('#addSubtaskBtn').addEventListener('click', addDrawerSub);
    $('#subtaskInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addDrawerSub(); } });

    // — Command palette
    $('#commandOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeCmd(); });
    $('#commandInput').addEventListener('input', e => searchTasks(e.target.value));

    // — Focus bar
    $('#focusStart').addEventListener('click', startPomo);
    $('#focusPause').addEventListener('click', pausePomo);
    $('#focusReset').addEventListener('click', resetPomo);
    $('#focusClose').addEventListener('click', closeFocus);

    // — Keyboard
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openCmd(); }
      if (e.key === 'Escape') { closeCmd(); closeDrawer(); }
    });
  }


  // ═══════════════════════
  //  TASK CRUD
  // ═══════════════════════

  function saveTask() {
    const title = $('#taskTitleInput').value.trim();
    if (!title) return;

    const data = {
      title,
      description: $('#taskDescInput').value.trim(),
      priority: $('#taskPriorityInput').value,
      category: $('#taskCategoryInput').value,
      dueDate: $('#taskDueInput').value || null,
      estimatedMinutes: parseInt($('#taskEstimateInput').value) || 0,
      column: $('#taskColumnInput').value,
      subtasks: drawerSubtasks.map(s => ({ ...s }))
    };

    if (drawerMode === 'create') {
      state.tasks.push({
        id: genId(),
        ...data,
        timeSpent: 0,
        createdAt: new Date().toISOString()
      });
    } else if (editingTaskId) {
      const t = taskById(editingTaskId);
      if (t) Object.assign(t, data);
    }

    save();
    renderBoard();
    closeDrawer();
  }

  function deleteTask(id) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    if (focus.taskId === id) closeFocus();
    save();
    renderBoard();
  }

  function toggleSubtask(taskId, subId, checked) {
    const t = taskById(taskId);
    if (!t) return;
    const s = t.subtasks.find(x => x.id === subId);
    if (s) s.done = checked;
    save();
    // Re-render just this column
    const col = t.column;
    const body = document.getElementById('col-' + col);
    if (body) {
      body.innerHTML = '';
      tasksFor(col).forEach(task => body.appendChild(cardEl(task)));
      applyFilters();
      updateWorkload();
      // Update count
      const cntEl = $('[data-column="' + col + '"] .column-count');
      if (cntEl) cntEl.textContent = tasksFor(col).length;
    }
  }


  // ═══════════════════════
  //  DRAWER
  // ═══════════════════════

  function openDrawer(mode, defCol, taskId) {
    drawerMode = mode;
    editingTaskId = taskId || null;
    drawerSubtasks = [];

    $('#taskForm').reset();

    if (mode === 'create') {
      $('#drawerTitle').textContent = 'New Task';
      $('#deleteTaskBtn').classList.add('hide');
      if (defCol) $('#taskColumnInput').value = defCol;
    } else if (mode === 'edit' && taskId) {
      const t = taskById(taskId);
      if (!t) return;
      $('#drawerTitle').textContent = 'Edit ' + t.id;
      $('#deleteTaskBtn').classList.remove('hide');
      $('#taskTitleInput').value = t.title;
      $('#taskDescInput').value = t.description || '';
      $('#taskPriorityInput').value = t.priority;
      $('#taskCategoryInput').value = t.category;
      $('#taskDueInput').value = t.dueDate || '';
      $('#taskEstimateInput').value = t.estimatedMinutes || '';
      $('#taskColumnInput').value = t.column;
      drawerSubtasks = t.subtasks.map(s => ({ ...s }));
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
    list.innerHTML = drawerSubtasks.map((s, i) =>
      '<div class="subtask-edit-row" data-idx="' + i + '">' +
        '<input type="checkbox"' + (s.done ? ' checked' : '') + ' class="st-done">' +
        '<input type="text" value="' + esc(s.text) + '" class="st-text">' +
        '<button type="button" class="subtask-edit-remove" title="Remove">✕</button>' +
      '</div>'
    ).join('');

    list.querySelectorAll('.st-done').forEach((cb, i) => {
      cb.onchange = () => { drawerSubtasks[i].done = cb.checked; };
    });
    list.querySelectorAll('.st-text').forEach((inp, i) => {
      inp.oninput = () => { drawerSubtasks[i].text = inp.value; };
    });
    list.querySelectorAll('.subtask-edit-remove').forEach((btn, i) => {
      btn.onclick = () => { drawerSubtasks.splice(i, 1); renderDrawerSubs(); };
    });
  }

  function addDrawerSub() {
    const inp = $('#subtaskInput');
    const txt = inp.value.trim();
    if (!txt) return;
    drawerSubtasks.push({ id: genSid(), text: txt, done: false });
    inp.value = '';
    renderDrawerSubs();
    inp.focus();
  }


  // ═══════════════════════
  //  COMMAND PALETTE
  // ═══════════════════════

  function openCmd() {
    $('#commandOverlay').classList.add('open');
    const inp = $('#commandInput');
    setTimeout(() => { inp.value = ''; inp.focus(); $('#commandResults').innerHTML = ''; }, 60);
  }
  function closeCmd() {
    $('#commandOverlay').classList.remove('open');
  }

  function searchTasks(q) {
    const res = $('#commandResults');
    if (!q.trim()) { res.innerHTML = '<div class="command-empty">Type to search tasks…</div>'; return; }
    const lq = q.toLowerCase();
    const matches = state.tasks.filter(t =>
      t.title.toLowerCase().includes(lq) || t.id.toLowerCase().includes(lq)
    );
    if (!matches.length) { res.innerHTML = '<div class="command-empty">No tasks found</div>'; return; }

    res.innerHTML = matches.map(t => {
      const colTitle = COLUMNS.find(c => c.id === t.column)?.title || t.column;
      return '<div class="command-result" data-task-id="' + t.id + '">' +
        '<span class="command-result-id">' + t.id + '</span>' +
        '<span class="command-result-title">' + esc(t.title) + '</span>' +
        '<span class="command-result-col">' + colTitle + '</span>' +
      '</div>';
    }).join('');

    res.querySelectorAll('.command-result').forEach(el => {
      el.addEventListener('click', () => {
        closeCmd();
        openDrawer('edit', null, el.dataset.taskId);
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
  //  THEME & VIEW
  // ═══════════════════════

  function toggleTheme() {
    state.darkMode = !state.darkMode;
    applySettings();
    save();
  }
  function toggleView() {
    state.compactView = !state.compactView;
    applySettings();
    save();
  }
  function applySettings() {
    document.documentElement.dataset.theme = state.darkMode ? 'dark' : 'light';
    document.body.classList.toggle('compact-view', state.compactView);
  }


  // ═══════════════════════
  //  WORKLOAD
  // ═══════════════════════

  function updateWorkload() {
    const todayTasks = tasksFor('today');
    const ipTasks = tasksFor('in-progress');
    const doneTasks = tasksFor('completed');
    const total = state.tasks.length;

    const mins = [...todayTasks, ...ipTasks].reduce((s, t) => s + (t.estimatedMinutes || 0), 0);
    $('#workloadHours').textContent = fmtMin(mins) || '0m';
    $('#workloadWarning').classList.toggle('visible', mins > 360);

    const doneCount = doneTasks.length;
    const pct = total ? (doneCount / total * 100) : 0;
    $('#workloadBarFill').style.width = pct + '%';
    $('#completionText').textContent = doneCount + ' of ' + total + ' done';
  }


  // ═══════════════════════
  //  FOCUS / POMODORO
  // ═══════════════════════

  function activateFocus(taskId) {
    const t = taskById(taskId);
    if (!t) return;
    pausePomo();
    focus.taskId = taskId;
    focus.remaining = POMODORO_SECONDS;
    focus.running = false;

    $('#focusTaskId').textContent = t.id;
    $('#focusTaskTitle').textContent = t.title;
    $('#focusTimerDisplay').textContent = fmtTimer(focus.remaining);
    $('#focusTimerDisplay').classList.remove('timer-done');
    $('#focusSpent').textContent = fmtMin(t.timeSpent) || '0m';
    $('#focusBar').classList.add('open');
  }

  function startPomo() {
    if (focus.running || !focus.taskId) return;
    focus.running = true;
    $('#focusTimerDisplay').classList.remove('timer-done');

    focus.intervalId = setInterval(() => {
      focus.remaining--;
      $('#focusTimerDisplay').textContent = fmtTimer(focus.remaining);

      if (focus.remaining <= 0) {
        clearInterval(focus.intervalId);
        focus.running = false;
        focus.intervalId = null;

        const t = taskById(focus.taskId);
        if (t) {
          t.timeSpent += 25;
          $('#focusSpent').textContent = fmtMin(t.timeSpent);
          save();
          // Refresh the card on the board
          refreshCard(t);
        }

        focus.remaining = POMODORO_SECONDS;
        $('#focusTimerDisplay').textContent = fmtTimer(focus.remaining);
        $('#focusTimerDisplay').classList.add('timer-done');
        setTimeout(() => $('#focusTimerDisplay').classList.remove('timer-done'), 4000);

        try {
          if (Notification.permission === 'granted') {
            new Notification('FlowState', { body: 'Pomodoro complete! Take a break. 🎉' });
          }
        } catch {}
      }
    }, 1000);
  }

  function pausePomo() {
    if (focus.intervalId) clearInterval(focus.intervalId);
    focus.running = false;
    focus.intervalId = null;
  }

  function resetPomo() {
    pausePomo();
    focus.remaining = POMODORO_SECONDS;
    $('#focusTimerDisplay').textContent = fmtTimer(focus.remaining);
    $('#focusTimerDisplay').classList.remove('timer-done');
  }

  function closeFocus() {
    pausePomo();
    focus.taskId = null;
    $('#focusBar').classList.remove('open');
  }

  function refreshCard(t) {
    const old = $('[data-task-id="' + t.id + '"]');
    if (old) old.replaceWith(cardEl(t));
  }


  // ═══════════════════════
  //  INIT
  // ═══════════════════════

  function init() {
    load();
    applySettings();
    $('#headerDate').textContent = headerDate();
    renderBoard();
    bindEvents();

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

