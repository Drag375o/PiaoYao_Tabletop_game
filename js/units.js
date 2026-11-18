// Unit and projectile definitions. Values are this web version's own tuning,
// not official Where Winds Meet numbers.
const UNITS = {
  archer: {
    blurb: 'Stays put and fires an arrow. The guide line shows exactly what it will hit.',
    name: 'Archer', glyph: '弓', role: 'Ranged attacker',
    r: 18, mass: 1, friction: 520, restitution: 0.85,
    fires: 'arrow',
    hint: 'Archer: stays in place and fires an arrow. The guide line shows exactly what it will hit.',
  },
  shield: {
    blurb: 'Heavy and steady. Slow to launch, very hard to knock away.',
    name: 'Shield Soldier', glyph: '盾', role: 'Defensive unit',
    r: 24, mass: 3.2, friction: 900, restitution: 0.5, maxSpeed: 750,
    hint: 'Shield Soldier: heavy and steady. Slow to launch, very hard to knock away.',
  },
  flag: {
    blurb: 'Its gold zone makes nearby allies launch 30% faster.',
    name: 'Flag Bearer', glyph: '旗', role: 'Support unit',
    r: 18, mass: 1, friction: 520, restitution: 0.85, maxSpeed: 1000,
    hint: 'Flag Bearer: allies inside its gold zone launch 30% faster.',
  },
  artillery: {
    blurb: 'Fires a heavy cannonball that ploughs through clustered units.',
    name: 'Artillery', glyph: '炮', role: 'Heavy attacker',
    r: 22, mass: 2, friction: 650, restitution: 0.7,
    fires: 'cannonball', recoil: 160,
    hint: 'Artillery: fires a heavy cannonball that ploughs through clustered units. Recoils slightly.',
  },
  cavalry: {
    blurb: 'Fastest launch, longest slide. Shoves enemies off the edge.',
    name: 'Cavalry', glyph: '骑', role: 'Mobile attacker',
    r: 21, mass: 1.8, friction: 380, restitution: 0.85, maxSpeed: 1350,
    hint: 'Cavalry: fastest launch and longest slide. Hits hard. Great for shoving enemies off the edge.',
  },
};

const PROJECTILES = {
  // the arrow vanishes on its first hit against a unit
  arrow: { r: 6, mass: 0.6, friction: 160, restitution: 0.6, speed: 1500, oneHit: true },
  cannonball: { r: 11, mass: 3.5, friction: 320, restitution: 0.8, speed: 1000 },
};

const FLAG_AURA = 130;    // radius of the Flag Bearer's speed zone
const FLAG_BOOST = 1.3;   // launch speed multiplier inside the zone

const TEAM_SIZE = 5;      // most units a player may bring

// Default formation order: back, middle pair, front pair.
const DEFAULT_LINEUP = ['artillery', 'archer', 'flag', 'shield', 'cavalry'];
