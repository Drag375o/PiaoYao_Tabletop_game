// Start page: presents the game, collects the commanders' names and board style,
// and switches between the start page and the game screen.
(() => {
  const NAMES_KEY = 'piaoyao.names';
  const SETTINGS_KEY = 'piaoyao.settings';
  const DEFAULT_NAMES = { red: 'Red', blue: 'Blue' };
  const DEFAULT_SETTINGS = { mode: 'cpu', level: 'normal' };
  const CPU_NAME = 'Computer';

  const RULES = [
    ['Pick your opponent', 'Play the computer, or a friend on the same screen. Red always plays first.'],
    ['Choose your army', 'Each side picks up to 5 units. Repeats are allowed: three Cavalry is a plan.'],
    ['Set your formation', 'Drag your units anywhere in your half, then press Ready.'],
    ['Aim and launch', 'Press one of your units, pull back like a slingshot and let go. A longer pull hits harder.'],
    ['Knock them off', 'Collisions push units around. Any unit whose centre crosses the board edge is out.'],
    ['Last army standing', 'Wipe out every enemy unit to win. If both armies fall on the same turn, it\'s a draw.'],
  ];

  const homeEl = document.getElementById('home');
  const gameEl = document.getElementById('game');
  const nameInputs = { red: document.getElementById('name-red'), blue: document.getElementById('name-blue') };

  function loadNames() {
    try {
      const saved = JSON.parse(localStorage.getItem(NAMES_KEY));
      if (saved && typeof saved.red === 'string' && typeof saved.blue === 'string') return saved;
    } catch (e) { /* storage blocked or bad data */ }
    return { ...DEFAULT_NAMES };
  }

  function saveNames(names) {
    try { localStorage.setItem(NAMES_KEY, JSON.stringify(names)); } catch (e) { /* storage blocked */ }
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (saved && typeof saved === 'object') return { ...DEFAULT_SETTINGS, ...saved };
    } catch (e) { /* storage blocked or bad data */ }
    return { ...DEFAULT_SETTINGS };
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* storage blocked */ }
  }

  function readNames() {
    const names = {};
    for (const team of ['red', 'blue']) {
      names[team] = nameInputs[team].value.trim() || DEFAULT_NAMES[team];
    }
    if (settings.mode === 'cpu') names.blue = `${CPU_NAME}`;
    // two identical names would make every message ambiguous
    if (names.red.toLowerCase() === names.blue.toLowerCase()) {
      names.red += ' (Red)';
      names.blue += ' (Blue)';
    }
    return names;
  }

  // ---------- sections ----------

  let settings = loadSettings();
  let blueName = '';   // the second player's name, kept while the computer has the seat

  // who's playing: mode chips, difficulty and the commander inputs that depend on them
  function renderMode() {
    for (const chip of document.querySelectorAll('#mode-chips .chip')) {
      chip.classList.toggle('selected', chip.dataset.mode === settings.mode);
      chip.setAttribute('aria-pressed', chip.dataset.mode === settings.mode);
    }
    for (const chip of document.querySelectorAll('#level-chips .chip')) {
      chip.classList.toggle('selected', chip.dataset.level === settings.level);
      chip.setAttribute('aria-pressed', chip.dataset.level === settings.level);
    }
    const cpu = settings.mode === 'cpu';
    document.getElementById('level-row').hidden = !cpu;
    document.getElementById('commanders-note').textContent = cpu
      ? 'You command Red. The computer commands Blue.'
      : 'Two players, one screen. Take turns at the same device.';
    document.getElementById('label-blue').textContent = cpu ? `Blue army · computer (${AI.LEVELS[settings.level].name})` : 'Blue army';
    const blue = nameInputs.blue;
    if (cpu && !blue.disabled) {
      blueName = blue.value;
      blue.value = CPU_NAME;
    } else if (!cpu && blue.disabled) {
      blue.value = blueName;
    }
    blue.disabled = cpu;
  }

  document.getElementById('mode-chips').addEventListener('click', evt => {
    const chip = evt.target.closest('[data-mode]');
    if (!chip) return;
    settings.mode = chip.dataset.mode;
    saveSettings();
    renderMode();
  });

  document.getElementById('level-chips').addEventListener('click', evt => {
    const chip = evt.target.closest('[data-level]');
    if (!chip) return;
    settings.level = chip.dataset.level;
    saveSettings();
    renderMode();
  });

  function buildUnitCards() {
    const grid = document.getElementById('unit-cards');
    for (const def of Object.values(UNITS)) {
      const card = document.createElement('div');
      card.className = 'unit-card';
      card.innerHTML = `
        <span class="unit-badge"><b></b><b></b></span>
        <span class="u-name"></span>
        <span class="u-role"></span>
        <span class="u-blurb"></span>`;
      card.querySelectorAll('.unit-badge b').forEach(b => { b.textContent = def.glyph; });
      card.querySelector('.u-name').textContent = def.name;
      card.querySelector('.u-role').textContent = def.role;
      card.querySelector('.u-blurb').textContent = def.blurb;
      grid.append(card);
    }
  }

  // a small picture of the board in a theme, with a few pieces on it
  function drawPreview(canvas, T) {
    const B = window.__piaoyao.BOARD;
    const pad = 24;
    const ctx = canvas.getContext('2d');
    const scale = canvas.width / (B.w + pad * 2);
    canvas.height = Math.round((B.h + pad * 2) * scale);
    ctx.fillStyle = T.void;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, -(B.x - pad) * scale, -(B.y - pad) * scale);
    T.drawBoard(ctx, B, T);
    const dots = [[0.2, 0.32, 'red'], [0.2, 0.7, 'red'], [0.36, 0.5, 'red'], [0.64, 0.38, 'blue'], [0.64, 0.66, 'blue'], [0.8, 0.5, 'blue']];
    for (const [fx, fy, team] of dots) {
      const x = B.x + fx * B.w, y = B.y + fy * B.h, r = 30, color = T.team[team];
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (T.piece === 'metal' || T.piece === 'kit') {
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
      } else if (T.piece === 'disc') {
        ctx.fillStyle = '#f1e6d2';
        ctx.fill();
        ctx.strokeStyle = color;
      } else {
        ctx.fillStyle = Themes.alpha(color, 0.15);
        ctx.fill();
        ctx.strokeStyle = color;
      }
      ctx.lineWidth = 8;
      ctx.stroke();
    }
  }

  function buildThemeCards() {
    const grid = document.getElementById('theme-cards');
    for (const T of Themes.LIST) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'theme-card';
      card.dataset.themeId = T.id;
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      drawPreview(canvas, T);
      const label = document.createElement('span');
      label.textContent = T.name;
      card.append(canvas, label);
      card.addEventListener('click', () => Themes.set(T.id));
      grid.append(card);
    }
    markTheme();
    document.addEventListener('themechange', markTheme);
  }

  function markTheme() {
    for (const card of document.querySelectorAll('.theme-card')) {
      card.classList.toggle('selected', card.dataset.themeId === Themes.current.id);
      card.setAttribute('aria-pressed', card.dataset.themeId === Themes.current.id);
    }
  }

  function buildRules() {
    const list = document.getElementById('rules');
    for (const [title, text] of RULES) {
      const li = document.createElement('li');
      const b = document.createElement('b');
      const span = document.createElement('span');
      b.textContent = title;
      span.textContent = text;
      li.append(b, span);
      list.append(li);
    }
  }

  // ---------- navigation ----------

  function showHome() {
    Game.pause();
    gameEl.hidden = true;
    homeEl.hidden = false;
    document.getElementById('resume-card').hidden = !Game.inProgress();
    homeEl.scrollTop = 0;
  }

  function showGame() {
    homeEl.hidden = true;
    gameEl.hidden = false;
  }

  document.getElementById('start').addEventListener('click', () => {
    const names = readNames();
    const blue = settings.mode === 'cpu' ? blueName : nameInputs.blue.value;
    saveNames({ red: nameInputs.red.value.trim() || DEFAULT_NAMES.red, blue: blue.trim() || DEFAULT_NAMES.blue });
    showGame();
    Game.start({
      mode: settings.mode,
      teams: ['red', 'blue'],
      names,
      cpu: settings.mode === 'cpu' ? { blue: true } : {},
      level: settings.level,
    });
  });

  document.getElementById('resume').addEventListener('click', () => {
    showGame();
    Game.resume();
  });

  document.getElementById('menu').addEventListener('click', showHome);
  document.getElementById('to-menu').addEventListener('click', showHome);

  const names = loadNames();
  nameInputs.red.value = names.red;
  nameInputs.blue.value = names.blue;
  renderMode();
  buildUnitCards();
  buildThemeCards();
  buildRules();
  showHome();
})();
