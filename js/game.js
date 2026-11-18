// Piaoyao Battleboard: board, input and rendering.
(() => {
  const WORLD = { w: 1000, h: 680 };
  const BOARD = { x: 90, y: 60, w: 820, h: 560 };
  const MAX_DRAG = 150;        // world px of pull-back for full power
  const MAX_SPEED = 1150;      // launch speed at full power (px/s)
  const MIN_POWER = 0.06;      // releases weaker than this are cancelled
  const TEAM_COLORS = { red: '#c8483b', blue: '#3b78c8' };

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

  let bodies = [];
  let drag = null;     // { body, px, py } while aiming
  let view = { scale: 1, ox: 0, oy: 0 };
  let lastTime = performance.now();

  function setupBoard() {
    bodies = [];
    const half = BOARD.w / 2;
    for (const team of ['red', 'blue']) {
      for (const slot of FORMATION) {
        const dx = slot.fx * half;
        const x = team === 'red' ? BOARD.x + dx : BOARD.x + BOARD.w - dx;
        const y = BOARD.y + slot.fy * BOARD.h;
        bodies.push(Physics.makeBody({ x, y, r: 20, mass: 1, team }));
      }
    }
    drag = null;
    setStatus('Drag a piece backwards and release to launch it.');
  }

  function setStatus(text) { statusEl.textContent = text; }

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
    for (const b of bodies) {
      if (b.gone || b.falling) continue;
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
    if (!Physics.isSettled(bodies)) return;
    const p = toWorld(evt);
    const body = pieceAt(p);
    if (!body) return;
    drag = { body, px: p.x, py: p.y };
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
      drag.body.vx = nx * power * MAX_SPEED;
      drag.body.vy = ny * power * MAX_SPEED;
      setStatus('Pieces in motion…');
    }
    drag = null;
  });

  canvas.addEventListener('pointercancel', () => { drag = null; });

  document.getElementById('reset').addEventListener('click', setupBoard);
  window.addEventListener('resize', resize);

  // ---------- rendering ----------

  function drawBoard() {
    // table surface around the board
    ctx.fillStyle = '#0f0c09';
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);

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

  function drawPiece(b) {
    const t = b.falling ? Math.min(b.fallT / Physics.FALL_TIME, 1) : 0;
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
    ctx.lineWidth = Math.max(2, r * 0.22);
    ctx.strokeStyle = TEAM_COLORS[b.team] || '#555';
    ctx.stroke();
    ctx.restore();
  }

  function drawAim() {
    if (!drag) return;
    const b = drag.body;
    const { nx, ny, power } = launchVector(drag);

    // pull band back to the pointer
    ctx.strokeStyle = 'rgba(40,25,10,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    const pull = Math.min(Math.hypot(drag.px - b.x, drag.py - b.y), MAX_DRAG);
    ctx.lineTo(b.x - nx * pull, b.y - ny * pull);
    ctx.stroke();

    if (power < MIN_POWER) return;

    // launch direction, length grows with power
    const len = 60 + power * 220;
    ctx.strokeStyle = power > 0.85 ? '#b0281c' : '#3a2410';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 7]);
    ctx.beginPath();
    ctx.moveTo(b.x + nx * b.r, b.y + ny * b.r);
    ctx.lineTo(b.x + nx * (b.r + len), b.y + ny * (b.r + len));
    ctx.stroke();
    ctx.setLineDash([]);

    // power ring
    ctx.strokeStyle = '#f0c040';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + 7, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
    ctx.stroke();
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0f0c09';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
    drawBoard();
    for (const b of bodies) if (!b.gone) drawPiece(b);
    drawAim();
  }

  // ---------- loop ----------

  let wasMoving = false;

  function frame(now) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    Physics.update(bodies, BOARD, dt);
    const settled = Physics.isSettled(bodies);
    if (wasMoving && settled) {
      bodies = bodies.filter(b => !b.gone);
      const red = bodies.filter(b => b.team === 'red').length;
      const blue = bodies.filter(b => b.team === 'blue').length;
      setStatus(`Red ${red} · Blue ${blue} pieces on the board. Drag a piece to launch it.`);
    }
    wasMoving = !settled;
    render();
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
  };

  resize();
  setupBoard();
  requestAnimationFrame(frame);
})();
