// Launch and ability rules, shared by the game and the computer player
// (which tries shots out on copies of the board).
const Rules = (() => {
  const MAX_SPEED = 1150;   // default launch speed at full power (px/s)

  function flagBoost(bodies, body) {
    const boosted = bodies.some(f =>
      f !== body && f.type === 'flag' && f.team === body.team && !f.gone && !f.falling &&
      Math.hypot(f.x - body.x, f.y - body.y) <= FLAG_AURA);
    return boosted ? FLAG_BOOST : 1;
  }

  // Launch `body` along (nx, ny) at `power` (0..1). Archers and Artillery fire a projectile instead.
  function launch(bodies, body, nx, ny, power) {
    const def = UNITS[body.type];
    const boost = flagBoost(bodies, body);
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

  // arrows break on the first unit they strike
  function onHit(a, b) {
    if (a.projectile && PROJECTILES[a.projectile].oneHit && b.kind === 'unit') a.gone = true;
    if (b.projectile && PROJECTILES[b.projectile].oneHit && a.kind === 'unit') b.gone = true;
  }

  // First unit an arrow fired from `body` along (nx, ny) would strike.
  function predictArrowHit(bodies, arena, body, nx, ny) {
    const ar = PROJECTILES.arrow.r;
    const ox = body.x + nx * (body.r + ar + 1);
    const oy = body.y + ny * (body.r + ar + 1);
    let best = null;
    for (const u of bodies) {
      if (u.kind !== 'unit' || u === body || u.gone || u.falling) continue;
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
    const exitT = arena.exitDistance(ox, oy, nx, ny);
    if (best && best.t > exitT) best = null;
    const t = best ? best.t : exitT;
    return { ox, oy, cx: ox + nx * t, cy: oy + ny * t, unit: best && best.unit };
  }

  return { MAX_SPEED, flagBoost, launch, onHit, predictArrowHit };
})();
