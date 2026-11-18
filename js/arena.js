// Battlefield geometry: the board's outline, each army's starting zone and
// formation slots. Two armies play on a rectangle split into halves;
// three play on a round arena split into wedges.
const Arena = (() => {
  // Default formation, as fractions of a team's half (fx measured from its own back edge).
  const FORMATION = [
    { fx: 0.18, fy: 0.5 },
    { fx: 0.38, fy: 0.3 },
    { fx: 0.38, fy: 0.7 },
    { fx: 0.62, fy: 0.42 },
    { fx: 0.62, fy: 0.58 },
  ];

  function rect(teams) {
    const a = { shape: 'rect', teams, x: 90, y: 60, w: 820, h: 560 };
    const left = teams[0];

    a.contains = (x, y) => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h;

    // distance along (nx, ny) from (ox, oy) to the edge
    a.exitDistance = (ox, oy, nx, ny) => {
      const tx = nx > 0 ? (a.x + a.w - ox) / nx : nx < 0 ? (a.x - ox) / nx : Infinity;
      const ty = ny > 0 ? (a.y + a.h - oy) / ny : ny < 0 ? (a.y - oy) / ny : Infinity;
      return Math.min(tx, ty);
    };

    // how far a point is from falling off (0 = on the edge)
    a.edgeDistance = (x, y) => Math.min(x - a.x, a.x + a.w - x, y - a.y, a.y + a.h - y);
    a.safeDistance = Math.min(a.w, a.h) / 2;

    a.zone = team => {
      const half = a.w / 2;
      return { x: team === left ? a.x : a.x + half, y: a.y, w: half, h: a.h };
    };

    a.zonePath = (ctx, team) => {
      const z = a.zone(team);
      ctx.beginPath();
      ctx.rect(z.x, z.y, z.w, z.h);
    };

    a.clamp = (team, pad, x, y) => {
      const z = a.zone(team);
      return {
        x: Math.min(Math.max(x, z.x + pad), z.x + z.w - pad),
        y: Math.min(Math.max(y, z.y + pad), z.y + z.h - pad),
      };
    };

    a.slot = (team, i) => {
      const s = FORMATION[i];
      const dx = s.fx * a.w / 2;
      return { x: team === left ? a.x + dx : a.x + a.w - dx, y: a.y + s.fy * a.h };
    };

    return a;
  }

  // Default formation in a 120° wedge: (fraction of radius, angle offset from the wedge's centre line)
  const WEDGE_FORMATION = [
    { fr: 0.8, da: 0 },
    { fr: 0.6, da: -0.38 },
    { fr: 0.6, da: 0.38 },
    { fr: 0.4, da: -0.32 },
    { fr: 0.4, da: 0.32 },
  ];

  // Three armies: a round arena cut into three 120° wedges.
  function circle(teams) {
    const a = { shape: 'circle', teams, cx: 500, cy: 340, r: 300 };
    // bounding box, so code that frames the board can treat both shapes alike
    Object.assign(a, { x: a.cx - a.r, y: a.cy - a.r, w: a.r * 2, h: a.r * 2 });
    const SPAN = (Math.PI * 2) / teams.length;
    const INNER = 30;   // keep a small no-man's-land at the centre
    // wedge centre lines: first army on the left, then clockwise on screen
    const centre = team => Math.PI + teams.indexOf(team) * SPAN;

    const wrap = ang => Math.atan2(Math.sin(ang), Math.cos(ang));

    a.contains = (x, y) => Math.hypot(x - a.cx, y - a.cy) <= a.r;

    a.exitDistance = (ox, oy, nx, ny) => {
      const fx = ox - a.cx, fy = oy - a.cy;
      const b = fx * nx + fy * ny;
      const c = fx * fx + fy * fy - a.r * a.r;
      return -b + Math.sqrt(Math.max(0, b * b - c));
    };

    a.edgeDistance = (x, y) => a.r - Math.hypot(x - a.cx, y - a.cy);
    a.safeDistance = a.r;

    a.zonePath = (ctx, team) => {
      const c = centre(team);
      ctx.beginPath();
      ctx.moveTo(a.cx, a.cy);
      ctx.arc(a.cx, a.cy, a.r, c - SPAN / 2, c + SPAN / 2);
      ctx.closePath();
    };

    // the wedge boundary lines, for drawing
    a.dividers = () => teams.map(t => centre(t) + SPAN / 2);

    a.clamp = (team, pad, x, y) => {
      const c = centre(team);
      let dist = Math.hypot(x - a.cx, y - a.cy);
      dist = Math.min(Math.max(dist, INNER + pad * 2), a.r - pad);
      // stay `pad` away from the wedge's straight sides
      const margin = Math.asin(Math.min(1, pad / dist));
      let off = wrap(Math.atan2(y - a.cy, x - a.cx) - c);
      off = Math.min(Math.max(off, -SPAN / 2 + margin), SPAN / 2 - margin);
      return { x: a.cx + Math.cos(c + off) * dist, y: a.cy + Math.sin(c + off) * dist };
    };

    a.slot = (team, i) => {
      const s = WEDGE_FORMATION[i];
      const ang = centre(team) + s.da;
      return { x: a.cx + Math.cos(ang) * s.fr * a.r, y: a.cy + Math.sin(ang) * s.fr * a.r };
    };

    return a;
  }

  function create(teams) {
    return teams.length === 2 ? rect(teams) : circle(teams);
  }

  return { create };
})();
