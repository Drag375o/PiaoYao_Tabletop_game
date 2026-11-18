// Top-down disc physics: sliding friction, elastic collisions, falling off the board edge.
const Physics = (() => {
  const STEP = 1 / 240;          // fixed sub-step (s), small enough that fast pieces don't tunnel
  const REST_SPEED = 4;          // below this speed (px/s) a piece stops
  const LINEAR_DAMPING = 0.35;   // extra air-like drag (1/s)
  const FALL_TIME = 0.45;        // seconds a piece takes to drop off the edge

  let accumulator = 0;

  function makeBody(opts) {
    return Object.assign({
      x: 0, y: 0, vx: 0, vy: 0,
      r: 18, mass: 1,
      friction: 520,       // sliding deceleration (px/s^2)
      restitution: 0.85,
      falling: false, fallT: 0, gone: false,
    }, opts);
  }

  function isOnBoard(b, board) {
    return b.x >= board.x && b.x <= board.x + board.w &&
           b.y >= board.y && b.y <= board.y + board.h;
  }

  function integrate(bodies, board, dt) {
    for (const b of bodies) {
      if (b.gone) continue;
      if (b.falling) {
        b.fallT += dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.vx *= 1 - 2 * dt;
        b.vy *= 1 - 2 * dt;
        if (b.fallT >= FALL_TIME) b.gone = true;
        continue;
      }
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > 0) {
        const decel = b.friction * dt + speed * LINEAR_DAMPING * dt;
        if (speed <= decel || speed < REST_SPEED) {
          b.vx = 0; b.vy = 0;
        } else {
          const k = (speed - decel) / speed;
          b.vx *= k; b.vy *= k;
        }
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (!isOnBoard(b, board)) b.falling = true;
    }
  }

  function collide(bodies, onHit) {
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (a.gone || a.falling) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (b.gone || b.falling) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const minDist = a.r + b.r;
        const distSq = dx * dx + dy * dy;
        if (distSq >= minDist * minDist) continue;
        const dist = Math.sqrt(distSq) || 0.0001;
        const nx = dx / dist, ny = dy / dist;
        const invA = 1 / a.mass, invB = 1 / b.mass;
        const invSum = invA + invB;

        // push the discs apart so they stop overlapping
        const corr = (minDist - dist) / invSum;
        a.x -= nx * corr * invA; a.y -= ny * corr * invA;
        b.x += nx * corr * invB; b.y += ny * corr * invB;

        // impulse along the contact normal
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel >= 0) continue;
        const e = Math.min(a.restitution, b.restitution);
        const jImp = -(1 + e) * rel / invSum;
        a.vx -= jImp * invA * nx; a.vy -= jImp * invA * ny;
        b.vx += jImp * invB * nx; b.vy += jImp * invB * ny;
        if (onHit) onHit(a, b, jImp);
      }
    }
  }

  // Advance the simulation by frameDt seconds using fixed sub-steps.
  function update(bodies, board, frameDt, onHit) {
    accumulator += Math.min(frameDt, 0.1);
    while (accumulator >= STEP) {
      integrate(bodies, board, STEP);
      collide(bodies, onHit);
      accumulator -= STEP;
    }
  }

  function isSettled(bodies) {
    return bodies.every(b => b.gone || (!b.falling && b.vx === 0 && b.vy === 0));
  }

  return { makeBody, update, isSettled, isOnBoard, FALL_TIME };
})();
