// Board themes. Each theme has a stylesheet in css/themes/ (page colours and fonts,
// scoped to [data-theme="id"]) and a canvas palette here (board, pieces, aim lines).
// Styles follow the Auction XI themes; the original wood-and-sand look stays the default.
const Themes = (() => {
  const DEFAULT = 'classic';
  const STORAGE_KEY = 'piaoyao.theme';

  // ---------- colour helpers ----------

  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mix(a, b, t) {
    const ca = rgb(a), cb = rgb(b);
    const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  function alpha(hex, a) {
    const [r, g, b] = rgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }

  // Stable pseudo-random in [-1, 1], so hand-drawn lines don't flicker between frames.
  function jitter(seed) {
    const s = Math.sin(seed * 12.9898) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Slightly wobbly line, for chalk and pencil.
  function roughLine(ctx, x1, y1, x2, y2, wobble, seed) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(2, Math.round(len / 24));
    const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const off = i === 0 || i === steps ? 0 : jitter(seed + i) * wobble;
      const x = x1 + (x2 - x1) * t + nx * off, y = y1 + (y2 - y1) * t + ny * off;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function roughRect(ctx, x, y, w, h, wobble, seed) {
    roughLine(ctx, x, y, x + w, y, wobble, seed);
    roughLine(ctx, x + w, y, x + w, y + h, wobble, seed + 50);
    roughLine(ctx, x + w, y + h, x, y + h, wobble, seed + 100);
    roughLine(ctx, x, y + h, x, y, wobble, seed + 150);
  }

  // Hand-drawn circle: a smooth, low-frequency wobble rather than per-point noise.
  function roughCircle(ctx, cx, cy, r, wobble, seed) {
    const steps = Math.max(32, Math.round(r * 0.9));
    const p1 = jitter(seed) * Math.PI, p2 = jitter(seed + 1) * Math.PI;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const rr = r + wobble * (0.6 * Math.sin(2 * a + p1) + 0.4 * Math.sin(3 * a + p2));
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function midline(ctx, B) {
    ctx.beginPath();
    ctx.moveTo(B.x + B.w / 2, B.y);
    ctx.lineTo(B.x + B.w / 2, B.y + B.h);
    ctx.stroke();
  }

  // ---------- board surfaces ----------

  function drawClassic(ctx, B, T) {
    ctx.fillStyle = '#5b3d22';
    roundRect(ctx, B.x - 14, B.y - 14, B.w + 28, B.h + 28, 14);
    ctx.fill();

    const g = ctx.createLinearGradient(B.x, B.y, B.x, B.y + B.h);
    g.addColorStop(0, '#c9a46b');
    g.addColorStop(1, '#b38c55');
    ctx.fillStyle = g;
    ctx.fillRect(B.x, B.y, B.w, B.h);

    ctx.fillStyle = alpha(T.team.red, 0.08);
    ctx.fillRect(B.x, B.y, B.w / 2, B.h);
    ctx.fillStyle = alpha(T.team.blue, 0.08);
    ctx.fillRect(B.x + B.w / 2, B.y, B.w / 2, B.h);

    ctx.strokeStyle = 'rgba(80,50,20,0.45)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    midline(ctx, B);
    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(60,30,10,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeRect(B.x, B.y, B.w, B.h);
  }

  // charcoal tactics board in a black tablet bezel, crisp white lines, gold centre mark
  function drawMidnight(ctx, B, T) {
    ctx.fillStyle = '#07080a';
    roundRect(ctx, B.x - 16, B.y - 16, B.w + 32, B.h + 32, 26);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const cx = B.x + B.w / 2, cy = B.y + B.h / 2;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, B.w * 0.62);
    g.addColorStop(0, '#3a4047');
    g.addColorStop(0.45, '#262a2f');
    g.addColorStop(1, '#17191c');
    ctx.fillStyle = g;
    ctx.fillRect(B.x, B.y, B.w, B.h);

    // faint vertical bands
    const band = B.w / 10;
    ctx.fillStyle = 'rgba(255,255,255,0.022)';
    for (let i = 1; i < 10; i += 2) ctx.fillRect(B.x + i * band, B.y, band, B.h);

    ctx.fillStyle = alpha(T.team.red, 0.05);
    ctx.fillRect(B.x, B.y, B.w / 2, B.h);
    ctx.fillStyle = alpha(T.team.blue, 0.05);
    ctx.fillRect(B.x + B.w / 2, B.y, B.w / 2, B.h);

    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    midline(ctx, B);
    ctx.beginPath();
    ctx.arc(cx, cy, 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#dcb75e';
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeRect(B.x, B.y, B.w, B.h);
  }

  // black slate with chalk smudges in a walnut frame, chalk lines
  function drawChalkboard(ctx, B) {
    ctx.fillStyle = '#2a1a10';
    roundRect(ctx, B.x - 16, B.y - 16, B.w + 32, B.h + 32, 8);
    ctx.fill();
    // walnut grain
    ctx.save();
    roundRect(ctx, B.x - 16, B.y - 16, B.w + 32, B.h + 32, 8);
    ctx.clip();
    for (let i = 0; i < 60; i++) {
      const y = B.y - 16 + (i / 60) * (B.h + 32);
      ctx.strokeStyle = `rgba(${i % 3 ? '90,55,30' : '20,10,5'},${0.18 + 0.12 * Math.abs(jitter(i))})`;
      ctx.lineWidth = 1 + Math.abs(jitter(i + 7)) * 2;
      ctx.beginPath();
      ctx.moveTo(B.x - 16, y);
      ctx.lineTo(B.x + B.w + 16, y + jitter(i + 3) * 4);
      ctx.stroke();
    }
    ctx.restore();

    const g = ctx.createLinearGradient(B.x, B.y, B.x + B.w * 0.2, B.y + B.h);
    g.addColorStop(0, '#2a2e2c');
    g.addColorStop(1, '#222624');
    ctx.fillStyle = g;
    ctx.fillRect(B.x, B.y, B.w, B.h);
    for (const [fx, fy, rr, a] of [[0.18, 0.25, 0.45, 0.055], [0.85, 0.8, 0.5, 0.045], [0.55, 0.45, 0.3, 0.03]]) {
      const sx = B.x + B.w * fx, sy = B.y + B.h * fy;
      const s = ctx.createRadialGradient(sx, sy, 0, sx, sy, B.w * rr);
      s.addColorStop(0, `rgba(255,255,255,${a})`);
      s.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = s;
      ctx.fillRect(B.x, B.y, B.w, B.h);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(B.x, B.y, B.w, B.h);

    // chalk lines: a firm pass and a dusty pass
    for (const [w, a] of [[2.2, 0.8], [5, 0.12]]) {
      ctx.strokeStyle = `rgba(242,240,232,${a})`;
      ctx.lineWidth = w;
      roughRect(ctx, B.x + 10, B.y + 10, B.w - 20, B.h - 20, 1.6, 11);
      ctx.setLineDash([14, 10]);
      roughLine(ctx, B.x + B.w / 2, B.y + 10, B.x + B.w / 2, B.y + B.h - 10, 1.4, 300);
      ctx.setLineDash([]);
      roughCircle(ctx, B.x + B.w / 2, B.y + B.h / 2, 70, 1.6, 400);
      ctx.stroke();
    }
  }

  // mown grass with white pitch markings
  function drawPitch(ctx, B) {
    ctx.fillStyle = '#0f3d1b';
    roundRect(ctx, B.x - 16, B.y - 16, B.w + 32, B.h + 32, 12);
    ctx.fill();

    const stripes = 12, sw = B.w / stripes;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 ? '#378e3e' : '#3e9c46';
      ctx.fillRect(B.x + i * sw, B.y, sw + 0.5, B.h);
    }
    const sheen = ctx.createRadialGradient(B.x + B.w / 2, B.y - B.h * 0.2, 0, B.x + B.w / 2, B.y, B.h * 1.1);
    sheen.addColorStop(0, 'rgba(255,255,255,0.16)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(B.x, B.y, B.w, B.h);

    const cx = B.x + B.w / 2, cy = B.y + B.h / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 3;
    ctx.strokeRect(B.x, B.y, B.w, B.h);
    midline(ctx, B);
    ctx.beginPath();
    ctx.arc(cx, cy, 78, 0, Math.PI * 2);
    ctx.stroke();
    // penalty boxes at each end
    const bh = B.h * 0.5, bd = B.w * 0.12;
    ctx.strokeRect(B.x, cy - bh / 2, bd, bh);
    ctx.strokeRect(B.x + B.w - bd, cy - bh / 2, bd, bh);
    ctx.fillStyle = '#fff';
    for (const x of [cx, B.x + bd * 0.75, B.x + B.w - bd * 0.75]) {
      ctx.beginPath();
      ctx.arc(x, cy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // a ruled notebook page with spiral binding and pencil lines
  function drawSketchbook(ctx, B) {
    ctx.fillStyle = 'rgba(60,38,10,0.25)';
    ctx.fillRect(B.x - 10, B.y - 2, B.w + 24, B.h + 18);
    ctx.fillStyle = '#fdfbf3';
    ctx.fillRect(B.x - 14, B.y - 14, B.w + 28, B.h + 28);

    ctx.strokeStyle = 'rgba(80,130,205,0.22)';
    ctx.lineWidth = 1;
    for (let y = B.y + 14; y < B.y + B.h; y += 30) {
      ctx.beginPath();
      ctx.moveTo(B.x - 14, y);
      ctx.lineTo(B.x + B.w + 14, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(214,72,72,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(B.x + 34, B.y - 14);
    ctx.lineTo(B.x + 34, B.y + B.h + 14);
    ctx.stroke();

    // spiral binding along the top
    for (let x = B.x + 8; x < B.x + B.w; x += 26) {
      ctx.fillStyle = '#6d675c';
      ctx.beginPath();
      ctx.arc(x, B.y - 4, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#a9adb3';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(x, B.y - 13, 3.5, 10, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(58,60,67,0.85)';
    ctx.lineWidth = 1.6;
    roughRect(ctx, B.x, B.y, B.w, B.h, 1.2, 21);
    ctx.setLineDash([10, 9]);
    roughLine(ctx, B.x + B.w / 2, B.y, B.x + B.w / 2, B.y + B.h, 1.1, 500);
    ctx.setLineDash([]);
    roughCircle(ctx, B.x + B.w / 2, B.y + B.h / 2, 66, 1.5, 600);
    ctx.stroke();
  }

  // ---------- theme list ----------

  const LIST = [
    {
      id: 'classic', name: 'Battleboard',
      void: '#0f0c09', drawBoard: drawClassic,
      team: { red: '#c8483b', blue: '#3b78c8' },
      piece: 'disc', shadow: 'rgba(0,0,0,0.3)',
      aura: { fill: 'rgba(240,192,64,0.12)', stroke: 'rgba(200,150,30,0.5)' },
      aim: { band: 'rgba(40,25,10,0.6)', line: '#3a2410', strong: '#b0281c', ring: '#f0c040', hit: '#b0281c' },
      dim: 'rgba(20,14,8,0.35)', shaft: '#3a2410', ball: ['#777777', '#1d1d1d'],
    },
    {
      id: 'midnight', name: 'Midnight',
      void: '#0b0d10', drawBoard: drawMidnight,
      team: { red: '#ff5d7a', blue: '#4ea8ff' },
      piece: 'metal', shadow: 'rgba(0,0,0,0.45)',
      aura: { fill: 'rgba(220,183,94,0.1)', stroke: 'rgba(220,183,94,0.6)' },
      aim: { band: 'rgba(255,255,255,0.35)', line: 'rgba(255,255,255,0.85)', strong: '#dcb75e', ring: '#dcb75e', hit: '#dcb75e' },
      dim: 'rgba(0,0,0,0.42)', shaft: '#e9edf2', ball: ['#cfd6df', '#4d5560'],
    },
    {
      id: 'chalkboard', name: 'Chalkboard',
      void: '#141311', drawBoard: drawChalkboard,
      team: { red: '#ff9b90', blue: '#93caff' },
      piece: 'chalk', shadow: null,
      aura: { fill: 'rgba(243,211,107,0.07)', stroke: 'rgba(243,211,107,0.7)' },
      aim: { band: 'rgba(239,236,226,0.4)', line: 'rgba(239,236,226,0.9)', strong: '#f3d36b', ring: '#f3d36b', hit: '#f3d36b' },
      dim: 'rgba(0,0,0,0.38)', shaft: '#efece2', ball: ['#efece2', '#9a978e'],
    },
    {
      id: 'pitch', name: 'Football pitch',
      void: '#1d5e27', drawBoard: drawPitch,
      team: { red: '#ff4545', blue: '#3d8bff' },
      piece: 'kit', shadow: 'rgba(0,0,0,0.4)',
      aura: { fill: 'rgba(255,214,10,0.12)', stroke: 'rgba(255,214,10,0.8)' },
      aim: { band: 'rgba(255,255,255,0.5)', line: '#ffffff', strong: '#ffd60a', ring: '#ffd60a', hit: '#ffd60a' },
      dim: 'rgba(0,30,10,0.38)', shaft: '#ffffff', ball: ['#ffffff', '#b5b5b5'],
    },
    {
      id: 'sketchbook', name: 'Sketchbook',
      void: '#b8976a', drawBoard: drawSketchbook,
      team: { red: '#c0262d', blue: '#1f3fa8' },
      piece: 'pen', shadow: null,
      aura: { fill: 'rgba(255,225,77,0.28)', stroke: 'rgba(192,135,16,0.6)' },
      aim: { band: 'rgba(46,48,54,0.45)', line: '#2e3036', strong: '#c0262d', ring: '#e0b800', hit: '#c0262d' },
      dim: 'rgba(120,105,80,0.22)', shaft: '#2e3036', ball: ['#6a6a6a', '#2e3036'],
    },
  ];

  let current = LIST.find(t => t.id === DEFAULT);

  function load() {
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* storage blocked */ }
    set(saved, false);
  }

  function set(id, save = true) {
    current = LIST.find(t => t.id === id) || LIST.find(t => t.id === DEFAULT);
    document.documentElement.dataset.theme = current.id;
    document.dispatchEvent(new Event('themechange'));
    if (save) {
      try { localStorage.setItem(STORAGE_KEY, current.id); } catch (e) { /* storage blocked */ }
    }
  }

  return {
    LIST,
    get current() { return current; },
    load, set,
    mix, alpha, jitter, roughCircle, roundRect,
  };
})();
