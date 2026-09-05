// Small builders so each test can stand up exactly the world state it needs
// instead of fishing an interesting organism out of a live simulation.

import { CFG, GENES, G } from '../public/js/config.js';
import { setSeed } from '../public/js/rng.js';
import { World } from '../public/js/world.js';
import { Organism } from '../public/js/organism.js';

/** A genome of all zeroes, with named genes overridden. */
export function gene(overrides = {}) {
  const g = GENES.map(() => 0);
  for (const [name, v] of Object.entries(overrides)) {
    if (!(name in G)) throw new Error(`no such gene: ${name}`);
    g[G[name]] = v;
  }
  return g;
}

/**
 * A world with a private copy of CFG, seeded, and emptied of everything the
 * constructor spawned. Pass config overrides as the second argument.
 */
export function bareWorld(seed = 1, overrides = {}) {
  const cfg = { ...CFG, ...overrides };
  setSeed(seed);
  const world = new World(cfg);
  world.orgs = [];
  world.food = [];
  world.cysts = [];
  world.hides = [];
  world.tick = 0;
  return world;
}

/** Drop an organism into a world at a radius, moving at circular orbital speed. */
export function place(world, genome, r, opts = {}) {
  const angle = opts.angle ?? 0;
  const x = Math.cos(angle) * r, y = Math.sin(angle) * r;
  const [vx, vy] = opts.still ? [0, 0] : world.orbitalVelocity(x, y, opts.vFactor ?? 1);
  const o = new Organism(genome, x, y, vx, vy, 1e9);
  if (opts.energyFraction !== undefined) o.energy = o.maxEnergy * opts.energyFraction;
  if (opts.energy !== undefined) o.energy = opts.energy;
  o.age = opts.age ?? world.cfg.maturity + 1;
  world.orgs.push(o);
  return o;
}
