// Piaoyao Battleboard: board, input and rendering.
(() => {
  const WORLD = { w: 1000, h: 680 };
  const BOARD = { x: 90, y: 60, w: 820, h: 560 };
  const MAX_DRAG = 150;        // world px of pull-back for full power
  const MAX_SPEED = 1150;      // default launch speed at full power (px/s)
  const MIN_POWER = 0.06;      // releases weaker than this are cancelled
  const TEAM_COLORS = { red: '#c8483b', blue: '#3b78c8' };
  const GLYPH_FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Hiragino Sans GB", sans-serif';
  const TEAM_NAMES = { red: 'Red', blue: 'Blue' };
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

  let bodies = [];
  let drag = null;     // { body, px, py } while aiming
  let turn = 'red';    // team whose turn it is
  let turnNo = 1;
  let winner = null;   // 'red' | 'blue' | 'draw' once the match is over
  let view = { scale: 1, ox: 0, oy: 0 };
  let lastTime = performance.now();

  function makeUnit(type, team, x, y) {
    const def = UNITS[type];
    return Physics.makeBody({
      kind: 'unit', type, team, x, y,
      r: def.r, mass: def.mass, friction: def.friction, restitution: def.restitution,
    });
  }

  function setupBoard() {
    bodies = [];
    const half = BOARD.w / 2;
    for (const team of ['red', 'blue']) {
      FORMATION.forEach((slot, i) => {
        const dx = slot.fx * half;
        const x = team === 'red' ? BOARD.x + dx : BOARD.x + BOARD.w - dx;
        const y = BOARD.y + slot.fy * BOARD.h;
        bodies.push(makeUnit(DEFAULT_LINEUP[i], team, x, y));
      });
    }
    drag = null;
    turn = 'red';
    turnNo = 1;
    winner = null;
    overlayEl.hidden = true;
    updateTurnBadge();
    setStatus(AIM_HELP);
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
    setStatus(`Red ${red} · Blue ${blue} units left. ${TEAM_NAMES[turn]}: ${AIM_HELP}`);
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
    if (winner || !Physics.isSettled(bodies)) return;
    const p = toWorld(evt);
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
    if (!drag) return;
    const p = toWorld(evt);
    drag.px = p.x; drag.py = p.y;
  });

  canvas.addEventListener('pointerup', () => {
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

  canvas.addEventListener('pointercancel', () => { drag = null; });

  document.getElementById('reset').addEventListener('click', setupBoard);
  document.getElementById('play-again').addEventListener('click', setupBoard);
  window.addEventListener('resize', resize);

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

  // ---------- rendering ----------

  function drawBoard() {
    // board rim
    ctx.fillStyle = '#5b3d22';
    roundRect(BOARD.x - 14, BOARD.y - 14, BOARD.w + 28, BOARD.h + 28, 14);
    ctx.fill();

    // playing surface
    const g = ctx.createLinearGradient(BOARD.x, BOARD.y, BOARD.x, BOARD.y + BOARD.h);
    g.addColorStop(0, '#c9a46b');
    g.addColorStop(1, '#b38c55');
    ctx.fillStyle = g;
    ctx.fillRect(BOARD.x, BOARD.y, BOARD.w, BOARD.h);

    // half-way line and team halves
    ctx.fillStyle = 'rgba(200,72,59,0.08)';
    ctx.fillRect(BOARD.x, BOARD.y, BOARD.w / 2, BOARD.h);
    ctx.fillStyle = 'rgba(59,120,200,0.08)';
    ctx.fillRect(BOARD.x + BOARD.w / 2, BOARD.y, BOARD.w / 2, BOARD.h);
    ctx.strokeStyle = 'rgba(80,50,20,0.45)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(BOARD.x + BOARD.w / 2, BOARD.y);
    ctx.lineTo(BOARD.x + BOARD.w / 2, BOARD.y + BOARD.h);
    ctx.stroke();
    ctx.setLineDash([]);

    // edge line: crossing it means elimination
    ctx.strokeStyle = 'rgba(60,30,10,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeRect(BOARD.x, BOARD.y, BOARD.w, BOARD.h);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawAuras() {
    for (const f of units()) {
      if (f.type !== 'flag' || f.falling) continue;
      ctx.fillStyle = 'rgba(240,192,64,0.12)';
      ctx.strokeStyle = 'rgba(200,150,30,0.5)';
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
    const t = fallFactor(b);
    const r = b.r * (1 - 0.6 * t);
    ctx.save();
    ctx.globalAlpha = 1 - t;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(b.x + 3, b.y + 4, r, r * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();

    // disc
    const g = ctx.createRadialGradient(b.x - r * 0.35, b.y - r * 0.35, r * 0.1, b.x, b.y, r);
    g.addColorStop(0, '#f6ead2');
    g.addColorStop(1, '#d8c39c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.18);
    ctx.strokeStyle = TEAM_COLORS[b.team];
    ctx.stroke();

    // unit glyph
    ctx.fillStyle = TEAM_COLORS[b.team];
    ctx.font = `bold ${Math.round(r * 1.05)}px ${GLYPH_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(UNITS[b.type].glyph, b.x, b.y + r * 0.04);
    ctx.restore();
  }

  function drawProjectile(b) {
    const t = fallFactor(b);
    ctx.save();
    ctx.globalAlpha = 1 - t;
    if (b.projectile === 'arrow') {
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const ux = b.vx / sp, uy = b.vy / sp;
      ctx.strokeStyle = '#3a2410';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(b.x - ux * 22, b.y - uy * 22);
      ctx.lineTo(b.x + ux * 4, b.y + uy * 4);
      ctx.stroke();
      ctx.fillStyle = TEAM_COLORS[b.team];
      ctx.beginPath();
      ctx.moveTo(b.x + ux * 9, b.y + uy * 9);
      ctx.lineTo(b.x - uy * 5, b.y + ux * 5);
      ctx.lineTo(b.x + uy * 5, b.y - ux * 5);
      ctx.closePath();
      ctx.fill();
    } else {
      const r = b.r * (1 - 0.6 * t);
      const g = ctx.createRadialGradient(b.x - r * 0.4, b.y - r * 0.4, r * 0.1, b.x, b.y, r);
      g.addColorStop(0, '#777');
      g.addColorStop(1, '#1d1d1d');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawAim() {
    if (!drag) return;
    const b = drag.body;
    const def = UNITS[b.type];
    const { nx, ny, power } = launchVector(drag);

    // pull band back to the pointer
    ctx.strokeStyle = 'rgba(40,25,10,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    const pull = Math.min(Math.hypot(drag.px - b.x, drag.py - b.y), MAX_DRAG);
    ctx.lineTo(b.x - nx * pull, b.y - ny * pull);
    ctx.stroke();

    const boosted = flagBoost(b) > 1;
    if (boosted) {
      ctx.strokeStyle = 'rgba(240,192,64,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 13, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (power < MIN_POWER) return;

    if (def.fires === 'arrow') {
      // archer trajectory indicator: exact line to the first unit it will strike
      const hit = predictArrowHit(b, nx, ny);
      ctx.strokeStyle = 'rgba(176,40,28,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hit.ox, hit.oy);
      ctx.lineTo(hit.cx, hit.cy);
      ctx.stroke();
      if (hit.unit) {
        const kx = hit.unit.x - hit.cx, ky = hit.unit.y - hit.cy;
        const kl = Math.hypot(kx, ky) || 1;
        ctx.fillStyle = '#b0281c';
        ctx.beginPath();
        ctx.arc(hit.cx, hit.cy, 4, 0, Math.PI * 2);
        ctx.fill();
        // knock-back direction on the target
        const sx = hit.unit.x, sy = hit.unit.y;
        const ex = sx + kx / kl * 50, ey = sy + ky / kl * 50;
        ctx.strokeStyle = '#b0281c';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        drawArrowHead(ex, ey, kx / kl, ky / kl);
      }
    } else {
      const len = 60 + power * 220;
      ctx.strokeStyle = power > 0.85 ? '#b0281c' : '#3a2410';
      ctx.lineWidth = def.fires === 'cannonball' ? 5 : 3;
      ctx.setLineDash([8, 7]);
      ctx.beginPath();
      ctx.moveTo(b.x + nx * b.r, b.y + ny * b.r);
      ctx.lineTo(b.x + nx * (b.r + len), b.y + ny * (b.r + len));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // power ring
    ctx.strokeStyle = '#f0c040';
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

  // soft pulsing ring around the units the current player may launch
  function drawTurnHighlights() {
    const pulse = 0.35 + 0.25 * Math.sin(performance.now() / 300);
    ctx.strokeStyle = TEAM_COLORS[turn];
    ctx.globalAlpha = pulse;
    ctx.lineWidth = 3;
    for (const b of units()) {
      if (b.team !== turn || b.falling || (drag && drag.body === b)) continue;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function render(idle) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0f0c09';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
    drawBoard();
    drawAuras();
    if (idle) drawTurnHighlights();
    for (const b of bodies) if (!b.gone && b.kind === 'unit') drawPiece(b);
    for (const b of bodies) if (!b.gone && b.kind === 'projectile') drawProjectile(b);
    drawAim();
  }

  // ---------- loop ----------

  let wasMoving = false;

  function frame(now) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    Physics.update(bodies, BOARD, dt, onHit);
    // spent projectiles disappear once they stop
    for (const b of bodies) {
      if (b.kind === 'projectile' && !b.falling && b.vx === 0 && b.vy === 0) b.gone = true;
    }
    const settled = Physics.isSettled(bodies);
    if (wasMoving && settled) endTurn();
    wasMoving = !settled;
    render(settled && !winner);
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
  };

  resize();
  buildLegend();
  setupBoard();
  requestAnimationFrame(frame);
})();
