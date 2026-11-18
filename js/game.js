// Piaoyao Battleboard: board, input and rendering.
(() => {
  const WORLD = { w: 1000, h: 680 };
  const BOARD = { x: 90, y: 60, w: 820, h: 560 };
  const MAX_DRAG = 150;        // world px of pull-back for full power
  const MAX_SPEED = 1150;      // default launch speed at full power (px/s)
  const MIN_POWER = 0.06;      // releases weaker than this are cancelled
  const GLYPH_FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Hiragino Sans GB", sans-serif';
  const TEAM_NAMES = { red: 'Red', blue: 'Blue' };   // replaced by the commanders' names from the start page
  const AIM_HELP = 'Drag one of your units backwards and release to launch it.';

  // Default formation, as fractions of each team's half (x from its own back edge).
  const FORMATION = [
    { fx: 0.18, fy: 0.5 },
    { fx: 0.38, fy: 0.3 },
    { fx: 0.38, fy: 0.7 },
    { fx: 0.62, fy: 0.42 },
    { fx: 0.62, fy: 0.58 },
  ];

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const statusEl = document.getElementById('status');
  const turnEl = document.getElementById('turn');
  const overlayEl = document.getElementById('overlay');
  const setupEl = document.getElementById('setup');
  const readyBtn = document.getElementById('ready');

  let bodies = [];
  let drag = null;     // { body, px, py } while aiming
  let moving = null;   // { body, ox, oy, dx, dy } while placing a unit during setup
  let phase = 'select';     // 'select' | 'place' | 'battle'
  let setupTeam = 'red';    // team choosing or placing its army
  let picks = {};           // unit type -> count while choosing an army
  let turn = 'red';    // team whose turn it is
  let turnNo = 1;
  let winner = null;   // 'red' | 'blue' | 'draw' once the match is over
  let view = { scale: 1, ox: 0, oy: 0 };
  let lastTime = performance.now();

  let nextId = 1;   // stable id per unit, seeds the hand-drawn outlines

  function makeUnit(type, team, x, y) {
    const def = UNITS[type];
    return Physics.makeBody({
      id: nextId++, kind: 'unit', type, team, x, y,
      r: def.r, mass: def.mass, friction: def.friction, restitution: def.restitution,
    });
  }

  // ---------- match setup: choose an army, then place it ----------

  function newMatch() {
    bodies = [];
    drag = null;
    moving = null;
    turn = 'red';
    turnNo = 1;
    winner = null;
    overlayEl.hidden = true;
    beginSelect('red');
  }

  function beginSelect(team) {
    phase = 'select';
    setupTeam = team;
    picks = {};
    turnEl.className = 'turn ' + team;
    turnEl.textContent = `${TEAM_NAMES[team]} · Army`;
    document.getElementById('setup-title').textContent = `${TEAM_NAMES[team]}: choose your army`;
    setStatus(`${TEAM_NAMES[team]}: choose up to ${TEAM_SIZE} units.`);
    readyBtn.hidden = true;
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
    if (pickTotal() > 0) beginPlace();
  });

  function slotPosition(team, slot) {
    const dx = slot.fx * BOARD.w / 2;
    return {
      x: team === 'red' ? BOARD.x + dx : BOARD.x + BOARD.w - dx,
      y: BOARD.y + slot.fy * BOARD.h,
    };
  }

  // Put the chosen units into the default formation (back to front), ready to be rearranged.
  function beginPlace() {
    const army = [];
    for (const type of DEFAULT_LINEUP) {
      for (let i = 0; i < (picks[type] || 0); i++) army.push(type);
    }
    army.forEach((type, i) => {
      const { x, y } = slotPosition(setupTeam, FORMATION[i]);
      bodies.push(makeUnit(type, setupTeam, x, y));
    });
    phase = 'place';
    setupEl.hidden = true;
    readyBtn.hidden = false;
    turnEl.textContent = `${TEAM_NAMES[setupTeam]} · Formation`;
    setStatus(`${TEAM_NAMES[setupTeam]}: drag your units anywhere in your half, then press Ready.`);
  }

  readyBtn.addEventListener('click', () => {
    if (phase !== 'place') return;
    if (setupTeam === 'red') beginSelect('blue');
    else startBattle();
  });

  function startBattle() {
    phase = 'battle';
    readyBtn.hidden = true;
    turn = 'red';
    turnNo = 1;
    updateTurnBadge();
    setStatus(`${TEAM_NAMES.red} goes first. ${AIM_HELP}`);
  }

  function setupZone(team) {
    const half = BOARD.w / 2;
    return { x: team === 'red' ? BOARD.x : BOARD.x + half, y: BOARD.y, w: half, h: BOARD.h };
  }

  function clampToZone(body, x, y) {
    const z = setupZone(body.team);
    const pad = body.r + 6;
    return {
      x: Math.min(Math.max(x, z.x + pad), z.x + z.w - pad),
      y: Math.min(Math.max(y, z.y + pad), z.y + z.h - pad),
    };
  }

  function overlapsOther(body) {
    return units().some(o => o !== body && Math.hypot(o.x - body.x, o.y - body.y) < o.r + body.r + 2);
  }

  function setStatus(text) { statusEl.textContent = text; }

  function updateTurnBadge() {
    turnEl.className = 'turn ' + turn;
    turnEl.textContent = `Turn ${turnNo} · ${TEAM_NAMES[turn]}`;
  }

  function units() { return bodies.filter(b => b.kind === 'unit' && !b.gone); }

  function teamCount(team) { return units().filter(b => b.team === team).length; }

  // Called once everything has stopped after a launch.
  function endTurn() {
    bodies = bodies.filter(b => !b.gone);
    const red = teamCount('red'), blue = teamCount('blue');
    if (red === 0 || blue === 0) {
      winner = red === blue ? 'draw' : red > 0 ? 'red' : 'blue';
      showResult(red, blue);
      return;
    }
    turn = turn === 'red' ? 'blue' : 'red';
    turnNo++;
    updateTurnBadge();
    setStatus(`${TEAM_NAMES.red} ${red} · ${TEAM_NAMES.blue} ${blue} units left. ${TEAM_NAMES[turn]}: ${AIM_HELP}`);
  }

  function showResult(red, blue) {
    turnEl.className = 'turn' + (winner === 'draw' ? '' : ' ' + winner);
    turnEl.textContent = winner === 'draw' ? 'Draw' : `${TEAM_NAMES[winner]} wins`;
    document.getElementById('overlay-title').textContent =
      winner === 'draw' ? 'Draw!' : `${TEAM_NAMES[winner]} wins!`;
    const left = Math.max(red, blue);
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    document.getElementById('overlay-text').textContent = winner === 'draw'
      ? 'Both armies were knocked off the board on the same turn.'
      : `${TEAM_NAMES[winner]} won in ${plural(turnNo, 'turn')} with ${plural(left, 'unit')} left on the board.`;
    setStatus('Match over.');
    overlayEl.hidden = false;
  }

  // ---------- abilities ----------

  function flagBoost(body) {
    const boosted = bodies.some(f =>
      f !== body && f.type === 'flag' && f.team === body.team && !f.gone && !f.falling &&
      Math.hypot(f.x - body.x, f.y - body.y) <= FLAG_AURA);
    return boosted ? FLAG_BOOST : 1;
  }

  function launch(body, nx, ny, power) {
    const def = UNITS[body.type];
    const boost = flagBoost(body);
    if (def.fires) {
      const p = PROJECTILES[def.fires];
      const speed = p.speed * power * boost;
      const off = body.r + p.r + 1;
      bodies.push(Physics.makeBody({
        kind: 'projectile', projectile: def.fires, team: body.team,
        x: body.x + nx * off, y: body.y + ny * off,
        vx: nx * speed, vy: ny * speed,
        r: p.r, mass: p.mass, friction: p.friction, restitution: p.restitution,
      }));
      if (def.recoil) {
        body.vx = -nx * def.recoil * power;
        body.vy = -ny * def.recoil * power;
      }
    } else {
      const speed = (def.maxSpeed || MAX_SPEED) * power * boost;
      body.vx = nx * speed;
      body.vy = ny * speed;
    }
  }

  function onHit(a, b) {
    // arrows break on the first unit they strike
    if (a.projectile && PROJECTILES[a.projectile].oneHit && b.kind === 'unit') a.gone = true;
    if (b.projectile && PROJECTILES[b.projectile].oneHit && a.kind === 'unit') b.gone = true;
  }

  // First unit an arrow fired from `body` along (nx, ny) would strike.
  function predictArrowHit(body, nx, ny) {
    const ar = PROJECTILES.arrow.r;
    const ox = body.x + nx * (body.r + ar + 1);
    const oy = body.y + ny * (body.r + ar + 1);
    let best = null;
    for (const u of units()) {
      if (u === body || u.falling) continue;
      const R = u.r + ar;
      const fx = ox - u.x, fy = oy - u.y;
      const bq = fx * nx + fy * ny;
      const c = fx * fx + fy * fy - R * R;
      const disc = bq * bq - c;
      if (disc < 0) continue;
      const t = -bq - Math.sqrt(disc);
      if (t < 0) continue;
      if (!best || t < best.t) best = { t, unit: u };
    }
    // distance until the arrow leaves the board
    const tx = nx > 0 ? (BOARD.x + BOARD.w - ox) / nx : nx < 0 ? (BOARD.x - ox) / nx : Infinity;
    const ty = ny > 0 ? (BOARD.y + BOARD.h - oy) / ny : ny < 0 ? (BOARD.y - oy) / ny : Infinity;
    const exitT = Math.min(tx, ty);
    if (best && best.t > exitT) best = null;
    const t = best ? best.t : exitT;
    return { ox, oy, cx: ox + nx * t, cy: oy + ny * t, unit: best && best.unit };
  }

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
      const body = pieceAt(p);
      if (!body || body.team !== setupTeam) return;
      moving = { body, ox: body.x, oy: body.y, dx: body.x - p.x, dy: body.y - p.y };
      canvas.setPointerCapture(evt.pointerId);
      return;
    }
    if (phase !== 'battle' || winner || !Physics.isSettled(bodies)) return;
    const body = pieceAt(p);
    if (!body) return;
    if (body.team !== turn) {
      setStatus(`It's ${TEAM_NAMES[turn]}'s turn. Pick one of your own units.`);
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
      return;
    }
    if (!drag) return;
    drag.px = p.x; drag.py = p.y;
  });

  canvas.addEventListener('pointerup', () => {
    if (moving) {
      // units may not be stacked on top of each other
      if (overlapsOther(moving.body)) {
        moving.body.x = moving.ox;
        moving.body.y = moving.oy;
        setStatus('Units can’t overlap. Drop it on a free spot.');
      }
      moving = null;
      return;
    }
    if (!drag) return;
    const { nx, ny, power } = launchVector(drag);
    if (power >= MIN_POWER) {
      launch(drag.body, nx, ny, power);
      setStatus('Pieces in motion…');
    } else {
      setStatus(AIM_HELP);
    }
    drag = null;
  });

  canvas.addEventListener('pointercancel', () => {
    if (moving) { moving.body.x = moving.ox; moving.body.y = moving.oy; }
    drag = null;
    moving = null;
  });

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

  // during placement: dim the opponent's half and outline the player's own zone
  function drawSetupZone() {
    const z = setupZone(setupTeam);
    const other = setupZone(setupTeam === 'red' ? 'blue' : 'red');
    ctx.fillStyle = Themes.current.dim;
    ctx.fillRect(other.x, other.y, other.w, other.h);
    ctx.strokeStyle = teamColor(setupTeam);
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 8]);
    ctx.strokeRect(z.x + 4, z.y + 4, z.w - 8, z.h - 8);
    ctx.setLineDash([]);
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
    T.drawBoard(ctx, BOARD, T);
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
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    // physics only runs in battle, so units dragged during setup never shove each other
    if (phase === 'battle') Physics.update(bodies, BOARD, dt, onHit);
    // spent projectiles disappear once they stop
    for (const b of bodies) {
      if (b.kind === 'projectile' && !b.falling && b.vx === 0 && b.vy === 0) b.gone = true;
    }
    const settled = Physics.isSettled(bodies);
    if (wasMoving && settled) endTurn();
    wasMoving = !settled;
    render(phase === 'battle' && settled && !winner);
    requestAnimationFrame(frame);
  }

  // test hook: lets automated browser tests read the board state
  window.__piaoyao = {
    get bodies() { return bodies; },
    BOARD, WORLD,
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
  };

  // used by the start page (js/home.js)
  window.Game = {
    // begin a fresh match with the commanders' names
    start(names) {
      TEAM_NAMES.red = names.red;
      TEAM_NAMES.blue = names.blue;
      resize();
      newMatch();
    },
    // back to a match left via the menu
    resume() { resize(); },
    // a match is under way and not yet decided
    inProgress() { return !winner && (phase !== 'select' || setupTeam !== 'red' || pickTotal() > 0 || bodies.length > 0); },
  };

  Themes.load();
  buildThemeSwitch();
  resize();
  buildLegend();
  requestAnimationFrame(frame);
})();
