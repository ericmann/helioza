// Seedable randomness. Every stochastic decision in the simulation draws from
// here, so a run is fully reproducible from a single 32-bit seed. The original
// used Math.random directly; this module keeps the same call sites in the same
// order, which is what makes the equivalence check in scripts/ possible.

/** mulberry32: small, fast, good enough for an ecology. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
let next = mulberry32(seed);

/** Restart the stream. Same seed, same world, every time. */
export function setSeed(s) {
  seed = s >>> 0;
  next = mulberry32(seed);
  return seed;
}

export function getSeed() {
  return seed;
}

/** Uniform in [0, 1). The drop-in replacement for Math.random. */
export function random() {
  return next();
}

export function rand(a = 0, b = 1) { return a + random() * (b - a); }

export function gauss() {
  let u = 0, v = 0;
  while (!u) u = random();
  while (!v) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
