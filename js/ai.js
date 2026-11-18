// Computer player. It tries shots on copies of the board with the real physics,
// scores what happens, and plays one of the best (with aiming error by difficulty).
const AI = (() => {
  const LEVELS = {
    easy:   { name: 'Easy',   choose: 8, angleNoise: 0.09,  powerNoise: 0.18 },
    normal: { name: 'Normal', choose: 3, angleNoise: 0.035, powerNoise: 0.07 },
    hard:   { name: 'Hard',   choose: 1, angleNoise: 0.006, powerNoise: 0.01 },
  };

  // armies the computer likes to bring
  const ARMIES = [
    ['cavalry', 'cavalry', 'shield', 'archer', 'artillery'],
    ['cavalry', 'shield', 'flag', 'archer', 'artillery'],
    ['cavalry', 'cavalry', 'flag', 'shield', 'shield'],
    ['artillery', 'archer', 'archer', 'shield', 'cavalry'],
  ];

  const ANGLES = [-0.18, -0.09, 0, 0.09, 0.18];   // aim slightly off-centre to push targets sideways
  const POWERS = [0.5, 0.75, 1];

  function chooseArmy() {
    const army = ARMIES[Math.floor(Math.random() * ARMIES.length)];
    const picks = {};
    for (const type of army) picks[type] = (picks[type] || 0) + 1;
    return picks;
  }

  function copyBoard(bodies) {
    return bodies.filter(b => !b.gone).map(b => ({ ...b }));
  }

  // 0 when safely in the middle, 1 when right on the edge
  function danger(arena, b) {
    return 1 - Math.max(0, Math.min(1, arena.edgeDistance(b.x, b.y) / arena.safeDistance));
  }

  function score(arena, before, after, team) {
    const byId = new Map(after.map(b => [b.id, b]));
    let s = 0;
    for (const b of before) {
      if (b.kind !== 'unit') continue;
      const mine = b.team === team;
      const a = byId.get(b.id);
      const out = !a || a.gone || a.falling;
      if (out) {
        s += mine ? -130 : 100;
        continue;
      }
      const change = danger(arena, a) - danger(arena, b);
      s += mine ? -45 * change : 40 * change;
    }
    return s;
  }

  function gauss() {
    return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  }

  // Returns { id, nx, ny, power } for the best-looking shot for `team`.
  function chooseShot(bodies, team, arena, level = 'normal') {
    const L = LEVELS[level] || LEVELS.normal;
    const live = bodies.filter(b => b.kind === 'unit' && !b.gone && !b.falling);
    const mine = live.filter(b => b.team === team);
    const foes = live.filter(b => b.team !== team);
    const results = [];

    for (const u of mine) {
      for (const f of foes) {
        const base = Math.atan2(f.y - u.y, f.x - u.x);
        for (const da of ANGLES) {
          for (const power of POWERS) {
            const nx = Math.cos(base + da), ny = Math.sin(base + da);
            const sim = copyBoard(bodies);
            const shooter = sim.find(b => b.id === u.id);
            Rules.launch(sim, shooter, nx, ny, power);
            Physics.simulate(sim, arena, Rules.onHit);
            results.push({ id: u.id, nx, ny, power, angle: base + da, score: score(arena, live, sim, team) });
          }
        }
      }
    }
    if (!results.length) return null;

    results.sort((a, b) => b.score - a.score);
    const pick = results[Math.floor(Math.random() * Math.min(L.choose, results.length))];
    const angle = pick.angle + gauss() * L.angleNoise;
    const power = Math.max(0.2, Math.min(1, pick.power * (1 + gauss() * L.powerNoise)));
    return { id: pick.id, nx: Math.cos(angle), ny: Math.sin(angle), power, tried: results.length };
  }

  return { LEVELS, chooseArmy, chooseShot };
})();
