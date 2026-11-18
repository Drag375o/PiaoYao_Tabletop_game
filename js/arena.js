// Battlefield geometry: the board's outline, each army's starting zone and
// formation slots. Two armies play on a rectangle split into halves.
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

  function create(teams) {
    return rect(teams);
  }

  return { create };
})();
