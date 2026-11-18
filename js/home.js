// Start page: presents the game, collects the commanders' names and board style,
// and switches between the start page and the game screen.
(() => {
  const NAMES_KEY = 'piaoyao.names';
  const DEFAULT_NAMES = { red: 'Red', blue: 'Blue' };

  const RULES = [
    ['Name your commanders', 'Red and Blue share one screen and take turns. Red plays first.'],
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

  function readNames() {
    const names = {};
    for (const team of ['red', 'blue']) {
      names[team] = nameInputs[team].value.trim() || DEFAULT_NAMES[team];
    }
    // two identical names would make every message ambiguous
    if (names.red.toLowerCase() === names.blue.toLowerCase()) {
      names.red += ' (Red)';
      names.blue += ' (Blue)';
    }
    return names;
  }

  // ---------- sections ----------

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
    saveNames({ red: nameInputs.red.value.trim() || DEFAULT_NAMES.red, blue: nameInputs.blue.value.trim() || DEFAULT_NAMES.blue });
    showGame();
    Game.start(names);
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
  buildUnitCards();
  buildThemeCards();
  buildRules();
  showHome();
})();
