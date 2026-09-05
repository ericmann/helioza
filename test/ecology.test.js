import { describe, it, expect } from 'vitest';
import { CFG } from '../public/js/config.js';
import { setSeed } from '../public/js/rng.js';
import { World } from '../public/js/world.js';

// Seed 12 is pinned because it is known to survive: a mixed ecology of
// herbivores, omnivores and carnivores still running at 30,000 ticks. Plenty of
// other seeds go extinct around tick 12,000, which is a real outcome and not a
// bug — see docs/design.md on the founder crash.
const SEED = 12;
const TICKS = 30000;

describe(`a full run from seed ${SEED}`, () => {
  const world = (() => {
    setSeed(SEED);
    const w = new World({ ...CFG });
    const trace = { minPop: Infinity, maxPop: 0, maxDist: 0, overdrawn: 0 };
    // A predator pays for its bite after the tick's death sweep has already
    // run, so it can finish a tick slightly overdrawn. It cannot finish the
    // next one: the sweep only ever sees a smaller number. See docs/notes.md.
    let overdrawnLastTick = new Set();

    for (let t = 0; t < TICKS; t++) {
      w.step();

      expect(Number.isFinite(w.orgs.length)).toBe(true);
      expect(Number.isNaN(w.luminosity)).toBe(false);

      const overdrawn = new Set();
      for (const o of w.orgs) {
        if (Number.isNaN(o.x + o.y + o.energy)) throw new Error(`tick ${w.tick}: organism #${o.id} went NaN`);
        if (o.energy <= 0) {
          if (overdrawnLastTick.has(o.id)) {
            throw new Error(`tick ${w.tick}: organism #${o.id} survived two ticks on ${o.energy} energy`);
          }
          overdrawn.add(o.id);
          trace.overdrawn++;
        }
        const r = Math.hypot(o.x, o.y);
        if (!(r <= CFG.worldR + 40)) throw new Error(`tick ${w.tick}: organism #${o.id} escaped to r = ${r}`);
        trace.maxDist = Math.max(trace.maxDist, r);
      }
      overdrawnLastTick = overdrawn;

      trace.minPop = Math.min(trace.minPop, w.orgs.length);
      trace.maxPop = Math.max(trace.maxPop, w.orgs.length);
    }
    return { w, trace };
  })();

  it('never carries an overdrawn organism into a second tick', () => {
    // The loop above throws if one survives two ticks in the red, and it
    // throws on any NaN. This just asserts the run really happened.
    expect(world.w.tick).toBe(TICKS);
    expect(world.trace.minPop).toBeGreaterThanOrEqual(0);
  });

  it('never lets anything leave the world', () => {
    expect(world.trace.maxDist).toBeLessThanOrEqual(CFG.worldR + 40);
  });

  it('is still alive at the end', () => {
    expect(world.w.orgs.length).toBeGreaterThan(0);
    expect(world.trace.maxPop).toBeGreaterThan(100);
  });

  it('produced a real evolutionary history, not just the founders drifting', () => {
    expect(world.w.stats.born).toBeGreaterThan(1000);
    expect(Math.max(...world.w.orgs.map(o => o.generation))).toBeGreaterThan(10);
    expect(world.w.species.length).toBeGreaterThan(CFG.founders);
  });

  it('ran every mechanic at least once', () => {
    const s = world.w.stats;
    for (const key of ['born', 'budded', 'starved', 'killed', 'oldAge', 'plantsEaten', 'meatEaten', 'encysted', 'hatched']) {
      expect(s[key], `stats.${key}`).toBeGreaterThan(0);
    }
  });

  it('keeps the food supply inside its cap', () => {
    expect(world.w.food.length).toBeLessThanOrEqual(CFG.foodCap);
  });

  it('reproduces exactly on a rerun of the same seed', () => {
    setSeed(SEED);
    const again = new World({ ...CFG });
    for (let t = 0; t < 2000; t++) again.step();

    setSeed(SEED);
    const third = new World({ ...CFG });
    for (let t = 0; t < 2000; t++) third.step();

    expect(again.orgs.length).toBe(third.orgs.length);
    expect(again.stats).toEqual(third.stats);
  });
});
