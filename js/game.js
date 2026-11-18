// Piaoyao Battleboard: match flow, input and rendering.
(() => {
  const WORLD = { w: 1000, h: 680 };
  const MAX_DRAG = 150;        // world px of pull-back for full power
  const MIN_POWER = 0.06;      // releases weaker than this are cancelled
  const GLYPH_FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Hiragino Sans GB", sans-serif';
  const AIM_HELP = 'Drag one of your units backwards and release to launch it.';
  const CPU_THINK_MS = 650;    // pause before the computer aims
  const CPU_AIM_MS = 700;      // how long the computer's pull-back takes to draw

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const statusEl = document.getElementById('status');
  const turnEl = document.getElementById('turn');
  const overlayEl = document.getElementById('overlay');
  const setupEl = document.getElementById('setup');
  const readyBtn = document.getElementById('ready');

  // who is playing; set by Game.start() from the start page
  let match = { mode: 'pvp', teams: ['red', 'blue'], names: { red: 'Red', blue: 'Blue' }, cpu: {}, remote: {}, level: 'normal' };
  let arena = Arena.create(match.teams);

  let bodies = [];
  let drag = null;     // { body, px, py } while aiming
  let moving = null;   // { body, ox, oy, dx, dy } while placing a unit during setup
  let phase = 'select';     // 'select' | 'place' | 'battle'
  let setupIndex = 0;       // which army is choosing or placing
  let setupTeam = 'red';
  let picks = {};           // unit type -> count while choosing an army
  let turn = 'red';    // team whose turn it is
  let turnNo = 1;
  let winner = null;   // a team, or 'draw', once the match is over
  let started = false; // a match has been started from the start page
  let paused = false;  // the start page is showing
  let tasks = [];      // { at, fn } delayed steps, run by the game loop (so they pause with it)
  let cpuAim = null;   // { body, nx, ny, power, t0 } while the computer draws its shot

  // online play (js/online.js): the host runs the game as usual, with remote players' armies in
  // match.remote; a guest's game only mirrors the host's board and sends its own moves.
  let role = 'local';  // 'local' (this device runs the game) | 'guest'
  let me = null;       // a guest's own army
  let hooks = {};      // { action(msg) } for guests, { tick() } for hosts
  let hostSettled = true;   // guest: the host's board has stopped moving
  let pickSent = false;     // guest: army choice sent for the current setup turn
  let lastSent = 0;         // guest: throttles drag/aim messages
  let view = { scale: 1, ox: 0, oy: 0 };
  let lastTime = performance.now();
  let clock = 0;       // game time in ms, stops while paused

  let nextId = 1;   // stable id per unit, seeds the hand-drawn outlines

  function name(team) { return match.names[team]; }
  function isCpu(team) { return !!match.cpu[team]; }
  function isRemote(team) { return !!(match.remote && match.remote[team]); }
  // whether the person at this device controls `team`
  function isLocal(team) { return role === 'guest' ? team === me : !isCpu(team) && !isRemote(team); }
  function later(ms, fn) { tasks.push({ at: clock + ms, fn }); }

  function doLaunch(body, nx, ny, power) {
    Rules.launch(bodies, body, nx, ny, power);
    for (const b of bodies) if (b.id == null) b.id = nextId++;
  }

  function makeUnit(type, team, x, y) {
    const def = UNITS[type];
    return Physics.makeBody({
      id: nextId++, kind: 'unit', type, team, x, y,
      r: def.r, mass: def.mass, friction: def.friction, restitution: def.restitution,
    });
  }

  // ---------- match setup: each army chooses its units, then places them ----------

  function newMatch() {
    arena = Arena.create(match.teams);
    bodies = [];
    drag = null;
    moving = null;
    cpuAim = null;
    tasks = [];
    turn = match.teams[0];
    turnNo = 1;
    winner = null;
    overlayEl.hidden = true;
    beginSelect(0);
  }

  function beginSelect(index) {
    phase = 'select';
    setupIndex = index;
    setupTeam = match.teams[index];
    picks = {};
    readyBtn.hidden = true;
    turnEl.className = 'turn ' + setupTeam;
    turnEl.textContent = `${name(setupTeam)} · Army`;
    if (isCpu(setupTeam)) {
      // the computer picks and places at once, then hands over
      setupEl.hidden = true;
      picks = AI.chooseArmy();
      placeArmy(setupTeam);
      phase = 'place';
      setStatus(`${name(setupTeam)} is lining up its army…`);
      later(700, advanceSetup);
      return;
    }
    setStatus(`${name(setupTeam)}: choose up to ${TEAM_SIZE} units.`);
    if (isRemote(setupTeam)) {
      setupEl.hidden = true;
      return;
    }
    showPicker();
  }

  function showPicker() {
    document.getElementById('setup-title').textContent = `${name(setupTeam)}: choose your army`;
    renderPicker();
    setupEl.hidden = false;
  }

  function pickTotal() {
    return Object.values(picks).reduce((sum, n) => sum + n, 0);
  }

  function renderPicker() {
    const list = document.getElementById('unit-picker');
    list.innerHTML = '';
    const total = pickTotal();
    for (const [type, def] of Object.entries(UNITS)) {
      const count = picks[type] || 0;
      const row = document.createElement('li');
      row.className = 'pick-row';
      row.innerHTML = `
        <b class="pick-glyph ${setupTeam}"></b>
        <span class="pick-name"><strong></strong><small></small></span>
        <button type="button" data-type="${type}" data-delta="-1" aria-label="Remove ${def.name}">−</button>
        <span class="pick-count">${count}</span>
        <button type="button" data-type="${type}" data-delta="1" aria-label="Add ${def.name}">+</button>`;
      row.querySelector('.pick-glyph').textContent = def.glyph;
      row.querySelector('strong').textContent = def.name;
      row.querySelector('small').textContent = def.role;
      row.title = def.hint;
      row.querySelector('[data-delta="-1"]').disabled = count === 0;
      row.querySelector('[data-delta="1"]').disabled = total >= TEAM_SIZE;
      list.append(row);
    }
    document.getElementById('pick-total').textContent = `${total} / ${TEAM_SIZE} units`;
    document.getElementById('pick-done').disabled = total === 0;
  }

  document.getElementById('unit-picker').addEventListener('click', evt => {
    const btn = evt.target.closest('button[data-type]');
    if (!btn) return;
    const type = btn.dataset.type;
    const next = (picks[type] || 0) + Number(btn.dataset.delta);
    if (next < 0 || pickTotal() + Number(btn.dataset.delta) > TEAM_SIZE) return;
    picks[type] = next;
    renderPicker();
  });

  document.getElementById('pick-default').addEventListener('click', () => {
    picks = {};
    for (const type of DEFAULT_LINEUP) picks[type] = 1;
    renderPicker();
  });

  document.getElementById('pick-done').addEventListener('click', () => {
    if (pickTotal() === 0) return;
    if (role === 'guest') {
      hooks.action({ t: 'picks', picks });
      pickSent = true;
      setupEl.hidden = true;
      return;
    }
    beginPlace();
  });

  // only whole, known unit types, at most TEAM_SIZE (picks from the network are checked)
  function cleanPicks(raw) {
    const clean = {};
    let total = 0;
    for (const type of Object.keys(UNITS)) {
      const n = Math.max(0, Math.min(TEAM_SIZE - total, Math.floor(Number(raw && raw[type]) || 0)));
      if (n) { clean[type] = n; total += n; }
    }
    return total ? clean : null;
  }

  // Put the chosen units into the default formation (back to front).
  function placeArmy(team) {
    const army = [];
    for (const type of DEFAULT_LINEUP) {
      for (let i = 0; i < (picks[type] || 0); i++) army.push(type);
    }
    army.forEach((type, i) => {
      const { x, y } = arena.slot(team, i);
      bodies.push(makeUnit(type, team, x, y));
    });
  }

  function beginPlace() {
    placeArmy(setupTeam);
    phase = 'place';
    setupEl.hidden = true;
    readyBtn.hidden = !isLocal(setupTeam);
    turnEl.textContent = `${name(setupTeam)} · Formation`;
    setStatus(`${name(setupTeam)}: drag your units anywhere in your zone, then press Ready.`);
  }

  function advanceSetup() {
    if (setupIndex < match.teams.length - 1) beginSelect(setupIndex + 1);
    else startBattle();
  }

  readyBtn.addEventListener('click', () => {
    if (role === 'guest') {
      if (phase === 'place' && setupTeam === me) { hooks.action({ t: 'ready' }); readyBtn.hidden = true; }
      return;
    }
    if (phase === 'place' && isLocal(setupTeam)) advanceSetup();
  });

  function startBattle() {
    phase = 'battle';
    readyBtn.hidden = true;
    turn = match.teams[0];
    turnNo = 1;
    updateTurnBadge();
    setStatus(`${name(turn)} goes first. ${AIM_HELP}`);
    if (isCpu(turn)) startCpuTurn();
  }

  function clampToZone(body, x, y) {
    return arena.clamp(body.team, body.r + 6, x, y);
  }

  function overlapsOther(body) {
    return units().some(o => o !== body && Math.hypot(o.x - body.x, o.y - body.y) < o.r + body.r + 2);
  }

  function setStatus(text) { statusEl.textContent = text; }

  function updateTurnBadge() {
    turnEl.className = 'turn ' + turn;
    turnEl.textContent = `Turn ${turnNo} · ${name(turn)}`;
  }

  function units() { return bodies.filter(b => b.kind === 'unit' && !b.gone); }

  function teamCount(team) { return units().filter(b => b.team === team).length; }

  // Called once everything has stopped after a launch.
  function endTurn() {
    bodies = bodies.filter(b => !b.gone);
    const alive = match.teams.filter(t => teamCount(t) > 0);
    if (alive.length <= 1) {
      winner = alive[0] || 'draw';
      showResult();
      return;
    }
    // next army in order that still has units
    let i = match.teams.indexOf(turn);
    do { i = (i + 1) % match.teams.length; } while (teamCount(match.teams[i]) === 0);
    turn = match.teams[i];
    turnNo++;
    updateTurnBadge();
    const counts = match.teams.map(t => `${name(t)} ${teamCount(t)}`).join(' · ');
    setStatus(`${counts} units left. ${name(turn)}: ${AIM_HELP}`);
    if (isCpu(turn)) startCpuTurn();
  }

  function showResult() {
    turnEl.className = 'turn' + (winner === 'draw' ? '' : ' ' + winner);
    turnEl.textContent = winner === 'draw' ? 'Draw' : `${name(winner)} wins`;
    document.getElementById('overlay-title').textContent =
      winner === 'draw' ? 'Draw!' : `${name(winner)} wins!`;
    const left = winner === 'draw' ? 0 : teamCount(winner);
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    document.getElementById('overlay-text').textContent = winner === 'draw'
      ? 'The last armies were knocked off the board on the same turn.'
      : `${name(winner)} won in ${plural(turnNo, 'turn')} with ${plural(left, 'unit')} left on the board.`;
    setStatus('Match over.');
    overlayEl.hidden = false;
  }

  // ---------- computer turns ----------

  function startCpuTurn() {
    setStatus(`${name(turn)} is thinking…`);
    later(CPU_THINK_MS, () => {
      const shot = AI.chooseShot(bodies, turn, arena, match.level);
      const body = shot && bodies.find(b => b.id === shot.id);
      if (!body) return;
      cpuAim = { body, nx: shot.nx, ny: shot.ny, power: shot.power, t0: clock };
      setStatus(`${name(turn)} aims its ${UNITS[body.type].name}…`);
    });
  }

  // draws the computer's pull-back like a player's, then launches
  function updateCpuAim() {
    if (!cpuAim) return;
    const { body, nx, ny, power, t0 } = cpuAim;
    const t = (clock - t0) / CPU_AIM_MS;
    const pull = Math.min(t, 1) * power * MAX_DRAG;
    drag = { body, px: body.x - nx * pull, py: body.y - ny * pull, auto: true };
    if (t >= 1.25) {
      doLaunch(body, nx, ny, power);
      drag = null;
      cpuAim = null;
      setStatus('Pieces in motion…');
    }
  }

  // ---------- abilities ----------

  function flagBoost(body) { return Rules.flagBoost(bodies, body); }

  function predictArrowHit(body, nx, ny) { return Rules.predictArrowHit(bodies, arena, body, nx, ny); }

  // ---------- view / input ----------

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const scale = Math.min(canvas.width / WORLD.w, canvas.height / WORLD.h);
    view = {
      scale,
      ox: (canvas.width - WORLD.w * scale) / 2,
      oy: (canvas.height - WORLD.h * scale) / 2,
    };
  }

  function toWorld(evt) {
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width;
    return {
      x: ((evt.clientX - rect.left) * dpr - view.ox) / view.scale,
      y: ((evt.clientY - rect.top) * dpr - view.oy) / view.scale,
    };
  }

  function pieceAt(p) {
    let best = null, bestD = Infinity;
    for (const b of units()) {
      if (b.falling) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d <= b.r + 10 && d < bestD) { best = b; bestD = d; }
    }
    return best;
  }

  function launchVector(d) {
    const dx = d.body.x - d.px, dy = d.body.y - d.py;
    const len = Math.hypot(dx, dy);
    const power = Math.min(len, MAX_DRAG) / MAX_DRAG;
    if (len === 0) return { nx: 0, ny: 0, power: 0 };
    return { nx: dx / len, ny: dy / len, power };
  }

  canvas.addEventListener('pointerdown', evt => {
    const p = toWorld(evt);
    if (phase === 'place') {
      if (!isLocal(setupTeam)) return;
      const body = pieceAt(p);
      if (!body || body.team !== setupTeam) return;
      moving = { body, ox: body.x, oy: body.y, dx: body.x - p.x, dy: body.y - p.y };
      canvas.setPointerCapture(evt.pointerId);
      return;
    }
    const still = role === 'guest' ? hostSettled : Physics.isSettled(bodies);
    if (phase !== 'battle' || winner || !isLocal(turn) || !still || (drag && drag.auto)) return;
    const body = pieceAt(p);
    if (!body) return;
    if (body.team !== turn) {
      setStatus(`It's ${name(turn)}'s turn. Pick one of your own units.`);
      return;
    }
    drag = { body, px: p.x, py: p.y };
    const boosted = flagBoost(body) > 1 ? ' (Flag Bearer boost active)' : '';
    setStatus(UNITS[body.type].hint + boosted);
    canvas.setPointerCapture(evt.pointerId);
  });

  canvas.addEventListener('pointermove', evt => {
    const p = toWorld(evt);
    if (moving) {
      const pos = clampToZone(moving.body, p.x + moving.dx, p.y + moving.dy);
      moving.body.x = pos.x;
      moving.body.y = pos.y;
      if (role === 'guest') {
        moving.body.tx = pos.x;
        moving.body.ty = pos.y;
        throttled({ t: 'move', id: moving.body.id, x: pos.x, y: pos.y });
      }
      return;
    }
    if (!drag || drag.auto) return;
    drag.px = p.x; drag.py = p.y;
    if (role === 'guest') throttled({ t: 'aim', id: drag.body.id, px: p.x, py: p.y });
  });

  // a guest sends drags and aim at most ~20 times a second
  function throttled(msg) {
    const now = performance.now();
    if (now - lastSent < 50) return;
    lastSent = now;
    hooks.action(msg);
  }

  canvas.addEventListener('pointerup', () => {
    if (moving) {
      // units may not be stacked on top of each other
      if (overlapsOther(moving.body)) {
        moving.body.x = moving.ox;
        moving.body.y = moving.oy;
        setStatus('Units can’t overlap. Drop it on a free spot.');
      }
      if (role === 'guest') {
        const b = moving.body;
        b.tx = b.x;
        b.ty = b.y;
        hooks.action({ t: 'move', id: b.id, x: b.x, y: b.y, final: true });
      }
      moving = null;
      return;
    }
    if (!drag || drag.auto) return;
    const { nx, ny, power } = launchVector(drag);
    if (role === 'guest') {
      hooks.action(power >= MIN_POWER ? { t: 'launch', id: drag.body.id, nx, ny, power } : { t: 'aimEnd' });
      hostSettled = power < MIN_POWER;
    } else if (power >= MIN_POWER) {
      doLaunch(drag.body, nx, ny, power);
      setStatus('Pieces in motion…');
    } else {
      setStatus(AIM_HELP);
    }
    drag = null;
  });

  canvas.addEventListener('pointercancel', () => {
    if (moving) { moving.body.x = moving.ox; moving.body.y = moving.oy; }
    if (drag && !drag.auto) {
      drag = null;
      if (role === 'guest') hooks.action({ t: 'aimEnd' });
    }
    moving = null;
  });

  // ---------- online: host side ----------

  // A remote player's move, checked against the rules before it touches the board.
  function applyRemote(team, msg) {
    if (role !== 'local' || !isRemote(team) || winner) return;
    const own = bodies.find(b => b.id === msg.id && b.team === team && b.kind === 'unit' && !b.gone);
    if (msg.t === 'picks' && phase === 'select' && setupTeam === team) {
      const clean = cleanPicks(msg.picks);
      if (clean) { picks = clean; beginPlace(); }
    } else if (msg.t === 'move' && phase === 'place' && setupTeam === team && own) {
      if (own.safeX === undefined) { own.safeX = own.x; own.safeY = own.y; }
      const pos = clampToZone(own, Number(msg.x) || 0, Number(msg.y) || 0);
      own.x = pos.x;
      own.y = pos.y;
      if (msg.final) {
        // a drop on top of another unit goes back to the last legal spot
        if (overlapsOther(own)) { own.x = own.safeX; own.y = own.safeY; }
        own.safeX = own.x;
        own.safeY = own.y;
      }
    } else if (msg.t === 'ready' && phase === 'place' && setupTeam === team) {
      advanceSetup();
    } else if (msg.t === 'aim' && phase === 'battle' && turn === team && own && Physics.isSettled(bodies)) {
      drag = { body: own, px: Number(msg.px) || own.x, py: Number(msg.py) || own.y, auto: true };
    } else if (msg.t === 'aimEnd') {
      if (drag && drag.auto && drag.body.team === team) drag = null;
    } else if (msg.t === 'launch' && phase === 'battle' && turn === team && own && Physics.isSettled(bodies)) {
      const len = Math.hypot(Number(msg.nx), Number(msg.ny));
      const power = Math.min(1, Math.max(0, Number(msg.power) || 0));
      if (!len || power < MIN_POWER) return;
      drag = null;
      doLaunch(own, msg.nx / len, msg.ny / len, power);
      setStatus('Pieces in motion…');
    }
  }

  // The computer takes over an army whose player left.
  function takeOver(team) {
    if (!isRemote(team)) return;
    delete match.remote[team];
    match.cpu[team] = true;
    match.names[team] += ' (computer)';
    if (winner) return;
    if (drag && drag.auto && drag.body.team === team) drag = null;
    if (phase === 'select' && setupTeam === team) beginSelect(setupIndex);
    else if (phase === 'place' && setupTeam === team) later(400, advanceSetup);
    else if (phase === 'battle' && turn === team && Physics.isSettled(bodies)) startCpuTurn();
    if (phase === 'battle') updateTurnBadge();
  }

  // Everything a guest needs to draw the board.
  function snapshot() {
    const r = n => Math.round(n * 10) / 10;
    return {
      teams: match.teams,
      names: match.names,
      phase, setupTeam, turn, turnNo, winner,
      settled: Physics.isSettled(bodies),
      status: statusEl.textContent,
      badge: { cls: turnEl.className, text: turnEl.textContent },
      result: winner ? {
        title: document.getElementById('overlay-title').textContent,
        text: document.getElementById('overlay-text').textContent,
      } : null,
      aim: drag ? { id: drag.body.id, px: r(drag.px), py: r(drag.py) } : null,
      bodies: bodies.filter(b => !b.gone).map(b => ({
        id: b.id, kind: b.kind, type: b.type, team: b.team, projectile: b.projectile,
        x: r(b.x), y: r(b.y), vx: r(b.vx), vy: r(b.vy), r: b.r,
        falling: b.falling, fallT: r(b.fallT),
      })),
    };
  }

  // ---------- online: guest side ----------

  function loadSnapshot(s) {
    if (s.teams.join() !== match.teams.join()) {
      match.teams = s.teams;
      arena = Arena.create(s.teams);
    }
    match.names = s.names;
    const newSetupTurn = s.phase !== phase || s.setupTeam !== setupTeam;
    phase = s.phase;
    setupTeam = s.setupTeam;
    turn = s.turn;
    turnNo = s.turnNo;
    winner = s.winner;
    hostSettled = s.settled;

    // follow the host's pieces, easing towards their positions
    const old = new Map(bodies.map(b => [b.id, b]));
    bodies = s.bodies.map(c => {
      const b = old.get(c.id);
      if (!b) return { ...c, tx: c.x, ty: c.y, gone: false };
      Object.assign(b, { vx: c.vx, vy: c.vy, falling: c.falling, fallT: c.fallT, team: c.team });
      if (!(moving && moving.body === b)) { b.tx = c.x; b.ty = c.y; }
      return b;
    });
    if (moving && !bodies.includes(moving.body)) moving = null;

    statusEl.textContent = s.status;
    turnEl.className = s.badge.cls;
    turnEl.textContent = s.badge.text;

    // army picker for this player's setup turn
    if (newSetupTurn) pickSent = false;
    if (phase === 'select' && setupTeam === me && !pickSent) {
      if (setupEl.hidden) { picks = {}; showPicker(); }
    } else {
      setupEl.hidden = true;
    }
    readyBtn.hidden = !(phase === 'place' && setupTeam === me);

    // other players' aiming (this player's own drag stays local)
    if (!(drag && !drag.auto)) {
      const aimBody = s.aim && bodies.find(b => b.id === s.aim.id);
      drag = aimBody ? { body: aimBody, px: s.aim.px, py: s.aim.py, auto: true } : null;
    }

    if (s.result) {
      document.getElementById('overlay-title').textContent = s.result.title;
      document.getElementById('overlay-text').textContent = s.result.text;
    }
    overlayEl.hidden = !s.result;
  }

  // ease displayed pieces towards the host's latest positions
  function followHost(dt) {
    const k = Math.min(1, dt * 18);
    for (const b of bodies) {
      if (moving && moving.body === b) continue;
      if (Math.hypot(b.tx - b.x, b.ty - b.y) > 250) { b.x = b.tx; b.y = b.ty; continue; }
      b.x += (b.tx - b.x) * k;
      b.y += (b.ty - b.y) * k;
    }
  }

  document.getElementById('reset').addEventListener('click', newMatch);
  document.getElementById('play-again').addEventListener('click', newMatch);
  window.addEventListener('resize', resize);

  function buildThemeSwitch() {
    const select = document.getElementById('theme');
    for (const t of Themes.LIST) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      select.append(opt);
    }
    select.value = Themes.current.id;
    select.addEventListener('change', () => Themes.set(select.value));
    document.addEventListener('themechange', () => { select.value = Themes.current.id; });
  }

  function buildLegend() {
    const el = document.getElementById('legend');
    el.innerHTML = '';
    for (const def of Object.values(UNITS)) {
      const item = document.createElement('span');
      item.className = 'legend-item';
      item.title = def.hint;
      const glyph = document.createElement('b');
      glyph.textContent = def.glyph;
      item.append(glyph, def.name);
      el.append(item);
    }
  }

  // ---------- rendering (colours come from the active theme) ----------

  function teamColor(team) { return Themes.current.team[team]; }

  function drawAuras() {
    const T = Themes.current;
    for (const f of units()) {
      if (f.type !== 'flag' || f.falling) continue;
      ctx.fillStyle = T.aura.fill;
      ctx.strokeStyle = T.aura.stroke;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.arc(f.x, f.y, FLAG_AURA, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function fallFactor(b) {
    return b.falling ? Math.min(b.fallT / Physics.FALL_TIME, 1) : 0;
  }

  function drawPiece(b) {
    const T = Themes.current;
    const t = fallFactor(b);
    const r = b.r * (1 - 0.6 * t);
    const color = teamColor(b.team);
    ctx.save();
    ctx.globalAlpha = 1 - t;

    if (T.shadow) {
      ctx.fillStyle = T.shadow;
      ctx.beginPath();
      ctx.ellipse(b.x + 3, b.y + 4, r, r * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    let glyphColor = color;
    if (T.piece === 'disc') {
      // cream game disc with a team-coloured rim
      const g = ctx.createRadialGradient(b.x - r * 0.35, b.y - r * 0.35, r * 0.1, b.x, b.y, r);
      g.addColorStop(0, '#f6ead2');
      g.addColorStop(1, '#d8c39c');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(2, r * 0.18);
      ctx.strokeStyle = color;
      ctx.stroke();
    } else if (T.piece === 'metal') {
      // metallic token with a soft glow
      const g = ctx.createRadialGradient(b.x - r * 0.4, b.y - r * 0.5, r * 0.05, b.x, b.y, r);
      g.addColorStop(0, Themes.mix(color, '#ffffff', 0.55));
      g.addColorStop(0.45, color);
      g.addColorStop(1, Themes.mix(color, '#000000', 0.55));
      ctx.shadowColor = Themes.alpha(color, 0.7);
      ctx.shadowBlur = 14;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r - 1, 0, Math.PI * 2);
      ctx.stroke();
      glyphColor = '#ffffff';
    } else if (T.piece === 'kit') {
      // kit-coloured disc with a white rim
      const g = ctx.createLinearGradient(b.x - r * 0.4, b.y - r, b.x + r * 0.4, b.y + r);
      g.addColorStop(0, Themes.mix(color, '#ffffff', 0.25));
      g.addColorStop(0.5, color);
      g.addColorStop(1, Themes.mix(color, '#000000', 0.25));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      glyphColor = '#ffffff';
    } else if (T.piece === 'chalk') {
      // chalk-drawn circle: faint tint, firm stroke, dusty halo
      Themes.roughCircle(ctx, b.x, b.y, r, r * 0.06, b.id * 37);
      ctx.fillStyle = Themes.alpha(color, 0.12);
      ctx.fill();
      ctx.strokeStyle = Themes.alpha(color, 0.18);
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    } else if (T.piece === 'pen') {
      // circled in pen, lightly hatched
      ctx.save();
      Themes.roughCircle(ctx, b.x, b.y, r, r * 0.07, b.id * 53);
      ctx.fillStyle = 'rgba(253,251,243,0.85)';
      ctx.fill();
      ctx.clip();
      ctx.strokeStyle = Themes.alpha(color, 0.22);
      ctx.lineWidth = 1.5;
      for (let d = -2 * r; d <= 2 * r; d += 5) {
        ctx.beginPath();
        ctx.moveTo(b.x + d - r, b.y + r);
        ctx.lineTo(b.x + d + r, b.y - r);
        ctx.stroke();
      }
      ctx.restore();
      Themes.roughCircle(ctx, b.x, b.y, r, r * 0.07, b.id * 53);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // unit glyph
    ctx.fillStyle = glyphColor;
    if (T.piece === 'chalk') {
      ctx.shadowColor = Themes.alpha(color, 0.6);
      ctx.shadowBlur = 3;
    }
    ctx.font = `bold ${Math.round(r * 1.05)}px ${GLYPH_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(UNITS[b.type].glyph, b.x, b.y + r * 0.04);
    ctx.restore();
  }

  function drawProjectile(b) {
    const T = Themes.current;
    const t = fallFactor(b);
    ctx.save();
    ctx.globalAlpha = 1 - t;
    if (b.projectile === 'arrow') {
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const ux = b.vx / sp, uy = b.vy / sp;
      ctx.strokeStyle = T.shaft;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(b.x - ux * 22, b.y - uy * 22);
      ctx.lineTo(b.x + ux * 4, b.y + uy * 4);
      ctx.stroke();
      ctx.fillStyle = teamColor(b.team);
      ctx.beginPath();
      ctx.moveTo(b.x + ux * 9, b.y + uy * 9);
      ctx.lineTo(b.x - uy * 5, b.y + ux * 5);
      ctx.lineTo(b.x + uy * 5, b.y - ux * 5);
      ctx.closePath();
      ctx.fill();
    } else {
      const r = b.r * (1 - 0.6 * t);
      const g = ctx.createRadialGradient(b.x - r * 0.4, b.y - r * 0.4, r * 0.1, b.x, b.y, r);
      g.addColorStop(0, T.ball[0]);
      g.addColorStop(1, T.ball[1]);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawAim() {
    if (!drag) return;
    const A = Themes.current.aim;
    const b = drag.body;
    const def = UNITS[b.type];
    const { nx, ny, power } = launchVector(drag);

    // pull band back to the pointer
    ctx.strokeStyle = A.band;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    const pull = Math.min(Math.hypot(drag.px - b.x, drag.py - b.y), MAX_DRAG);
    ctx.lineTo(b.x - nx * pull, b.y - ny * pull);
    ctx.stroke();

    const boosted = flagBoost(b) > 1;
    if (boosted) {
      ctx.strokeStyle = Themes.current.aura.stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 13, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (power < MIN_POWER) return;

    if (def.fires === 'arrow') {
      // archer trajectory indicator: exact line to the first unit it will strike
      const hit = predictArrowHit(b, nx, ny);
      ctx.strokeStyle = A.hit;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hit.ox, hit.oy);
      ctx.lineTo(hit.cx, hit.cy);
      ctx.stroke();
      if (hit.unit) {
        const kx = hit.unit.x - hit.cx, ky = hit.unit.y - hit.cy;
        const kl = Math.hypot(kx, ky) || 1;
        ctx.fillStyle = A.hit;
        ctx.beginPath();
        ctx.arc(hit.cx, hit.cy, 4, 0, Math.PI * 2);
        ctx.fill();
        // knock-back direction on the target
        const sx = hit.unit.x, sy = hit.unit.y;
        const ex = sx + kx / kl * 50, ey = sy + ky / kl * 50;
        ctx.strokeStyle = A.hit;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        drawArrowHead(ex, ey, kx / kl, ky / kl);
      }
    } else {
      const len = 60 + power * 220;
      ctx.strokeStyle = power > 0.85 ? A.strong : A.line;
      ctx.lineWidth = def.fires === 'cannonball' ? 5 : 3;
      ctx.setLineDash([8, 7]);
      ctx.beginPath();
      ctx.moveTo(b.x + nx * b.r, b.y + ny * b.r);
      ctx.lineTo(b.x + nx * (b.r + len), b.y + ny * (b.r + len));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // power ring
    ctx.strokeStyle = A.ring;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + 7, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
    ctx.stroke();
  }

  function drawArrowHead(x, y, ux, uy) {
    ctx.beginPath();
    ctx.moveTo(x + ux * 8, y + uy * 8);
    ctx.lineTo(x - uy * 6, y + ux * 6);
    ctx.lineTo(x + uy * 6, y - ux * 6);
    ctx.closePath();
    ctx.fill();
  }

  // during placement: dim the other armies' zones and outline the player's own
  function drawSetupZone() {
    ctx.fillStyle = Themes.current.dim;
    for (const t of match.teams) {
      if (t === setupTeam) continue;
      arena.zonePath(ctx, t);
      ctx.fill();
    }
    ctx.save();
    arena.zonePath(ctx, setupTeam);
    ctx.clip();
    ctx.strokeStyle = teamColor(setupTeam);
    ctx.lineWidth = 6;
    ctx.setLineDash([12, 8]);
    arena.zonePath(ctx, setupTeam);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // soft pulsing ring around the units the current player may launch or move
  function drawTurnHighlights(team) {
    const pulse = 0.35 + 0.25 * Math.sin(performance.now() / 300);
    ctx.strokeStyle = teamColor(team);
    ctx.globalAlpha = pulse;
    ctx.lineWidth = 3;
    for (const b of units()) {
      if (b.team !== team || b.falling || (drag && drag.body === b)) continue;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function render(idle) {
    const T = Themes.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = T.void;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
    T.drawBoard(ctx, arena, T);
    if (phase === 'place') drawSetupZone();
    drawAuras();
    if (phase === 'place') drawTurnHighlights(setupTeam);
    else if (idle) drawTurnHighlights(turn);
    for (const b of bodies) if (!b.gone && b.kind === 'unit') drawPiece(b);
    for (const b of bodies) if (!b.gone && b.kind === 'projectile') drawProjectile(b);
    drawAim();
  }

  // ---------- loop ----------

  let wasMoving = false;

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    if (role === 'guest') {
      followHost(dt);
      render(phase === 'battle' && hostSettled && !winner && turn === me);
    } else if (!paused) {
      clock += dt * 1000;
      // delayed steps (computer setup and aiming) wait for game time, so they pause with it
      const due = tasks.filter(t => t.at <= clock);
      tasks = tasks.filter(t => t.at > clock);
      due.forEach(t => t.fn());
      updateCpuAim();
      // physics only runs in battle, so units dragged during setup never shove each other
      if (phase === 'battle') Physics.update(bodies, arena, dt, Rules.onHit);
      // spent projectiles disappear once they stop
      for (const b of bodies) {
        if (b.kind === 'projectile' && !b.falling && b.vx === 0 && b.vy === 0) b.gone = true;
      }
      const settled = Physics.isSettled(bodies);
      if (wasMoving && settled) endTurn();
      wasMoving = !settled;
      render(phase === 'battle' && settled && !winner && isLocal(turn));
      if (hooks.tick) hooks.tick();
    }
    requestAnimationFrame(frame);
  }

  // test hook: lets automated browser tests read the board state
  window.__piaoyao = {
    get bodies() { return bodies; },
    get BOARD() { return arena; },
    WORLD,
    worldToClient(x, y) {
      const rect = canvas.getBoundingClientRect();
      const dpr = canvas.width / rect.width;
      return {
        x: rect.left + (x * view.scale + view.ox) / dpr,
        y: rect.top + (y * view.scale + view.oy) / dpr,
      };
    },
    settled: () => Physics.isSettled(bodies),
    get turn() { return turn; },
    get winner() { return winner; },
    get phase() { return phase; },
    get theme() { return Themes.current.id; },
    get match() { return match; },
    get cpuBusy() { return tasks.length > 0 || !!cpuAim; },
  };

  // used by the start page (js/home.js)
  window.Game = {
    // begin a fresh match. opts: { mode, teams, names, cpu, level }
    start(opts) {
      match = {
        mode: opts.mode,
        teams: opts.teams,
        names: opts.names,
        cpu: opts.cpu || {},
        remote: opts.remote || {},
        level: opts.level || 'normal',
      };
      role = 'local';
      me = null;
      hooks = { tick: opts.onTick };
      started = true;
      paused = false;
      resize();
      newMatch();
    },
    // back to a match left via the menu
    resume() {
      paused = false;
      resize();
    },
    pause() { paused = true; },
    // online host
    snapshot,
    applyRemote,
    takeOver,
    // online guest: mirror the host's board, send this player's moves through onAction
    join(team, onAction) {
      role = 'guest';
      me = team;
      hooks = { action: onAction };
      started = true;
      paused = false;
      bodies = [];
      phase = '';
      setupTeam = '';
      winner = null;
      drag = null;
      moving = null;
      tasks = [];
      overlayEl.hidden = true;
      setupEl.hidden = true;
      resize();
    },
    load: loadSnapshot,
    // stop being part of an online match
    leave() {
      role = 'local';
      me = null;
      hooks = {};
      started = false;
      paused = true;
    },
    get role() { return role; },
    // a match has been started and is not yet decided
    inProgress() { return started && !winner; },
  };

  Themes.load();
  buildThemeSwitch();
  resize();
  buildLegend();
  requestAnimationFrame(frame);
})();
