import { describe, it, expect, beforeEach } from 'vitest';
import { CFG, G, GENES } from '../public/js/config.js';
import { setSeed } from '../public/js/rng.js';
import { breed, randomGenome, kinDistance, geneDistance, KIN_GENES, KIN_IDX } from '../public/js/genome.js';
import { gene } from './helpers.js';

const cfg = (o = {}) => ({ ...CFG, ...o });

beforeEach(() => setSeed(20090612));

describe('crossover', () => {
  it('takes every gene from one parent or the other, never a blend', () => {
    const a = GENES.map((_, i) => i / 100);
    const b = GENES.map((_, i) => 0.9 - i / 100);
    const noMutation = cfg({ mutationRate: 0, dietAssimilation: 0 });

    for (let trial = 0; trial < 400; trial++) {
      const child = breed(a, b, noMutation);
      expect(child).toHaveLength(GENES.length);
      for (let i = 0; i < child.length; i++) {
        expect(child[i] === a[i] || child[i] === b[i]).toBe(true);
      }
    }
  });

  it('draws from both parents rather than copying one of them', () => {
    const a = GENES.map(() => 0);
    const b = GENES.map(() => 1);
    const noMutation = cfg({ mutationRate: 0, dietAssimilation: 0 });
    let fromA = 0, fromB = 0;
    for (let trial = 0; trial < 200; trial++) {
      for (const v of breed(a, b, noMutation)) (v === 0 ? fromA++ : fromB++);
    }
    const share = fromA / (fromA + fromB);
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.6);
  });
});

describe('mutation', () => {
  it('keeps every gene inside [0, 1]', () => {
    // Parents pinned at the edges, mutation on hard: clamping is the only
    // thing standing between this and a genome full of nonsense.
    const hot = cfg({ mutationRate: 1, mutationSigma: 0.9, bigMutation: 0.5 });
    for (const value of [0, 1, 0.5]) {
      const parent = GENES.map(() => value);
      for (let trial = 0; trial < 300; trial++) {
        for (const v of breed(parent, parent, hot)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
          expect(Number.isNaN(v)).toBe(false);
        }
      }
    }
  });

  it('re-rolls a gene outright at roughly the configured big-mutation rate', () => {
    // Every gene mutates, but the ordinary mutation is vanishingly small, so
    // anything that moves off 0.5 by a visible amount was a full re-roll.
    const rate = CFG.bigMutation;
    const c = cfg({ mutationRate: 1, mutationSigma: 1e-9, dietAssimilation: 0 });
    const parent = GENES.map(() => 0.5);
    let jumps = 0, total = 0;
    for (let trial = 0; trial < 3000; trial++) {
      for (const v of breed(parent, parent, c)) { total++; if (Math.abs(v - 0.5) > 0.02) jumps++; }
    }
    const observed = jumps / total;
    // a re-roll can land near 0.5 by chance, so the observed rate runs a
    // little under the configured one
    expect(observed).toBeGreaterThan(rate * 0.7);
    expect(observed).toBeLessThan(rate * 1.3);
  });
});

describe('diet assimilation', () => {
  it('moves the child toward what its parents actually ate, and never past it', () => {
    const noMutation = cfg({ mutationRate: 0, dietAssimilation: CFG.dietAssimilation });

    for (const [inherited, realized] of [[0.2, 0.9], [0.9, 0.1], [0.5, 0.5], [0, 1], [1, 0]]) {
      const parent = gene({ diet: inherited });
      for (let trial = 0; trial < 300; trial++) {
        const d = breed(parent, parent, noMutation, realized)[G.diet];
        const lo = Math.min(inherited, realized), hi = Math.max(inherited, realized);
        expect(d).toBeGreaterThanOrEqual(lo);
        expect(d).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('on average lands strictly between the inherited and realized diet', () => {
    const noMutation = cfg({ mutationRate: 0, dietAssimilation: CFG.dietAssimilation });
    const parent = gene({ diet: 0.2 });
    let sum = 0;
    for (let trial = 0; trial < 500; trial++) sum += breed(parent, parent, noMutation, 0.9)[G.diet];
    const mean = sum / 500;
    expect(mean).toBeGreaterThan(0.2);
    expect(mean).toBeLessThan(0.9);
  });

  it('leaves the diet alone when the parents never ate anything', () => {
    const noMutation = cfg({ mutationRate: 0 });
    const parent = gene({ diet: 0.37 });
    expect(breed(parent, parent, noMutation, null)[G.diet]).toBe(0.37);
    expect(breed(parent, parent, noMutation, undefined)[G.diet]).toBe(0.37);
  });
});

describe('kinDistance', () => {
  it('is the mean absolute difference over exactly the kin genes', () => {
    expect(KIN_GENES).toEqual(['hue', 'marker1', 'marker2', 'diet']);
    expect(KIN_IDX).toEqual(KIN_GENES.map(n => G[n]));

    for (let trial = 0; trial < 200; trial++) {
      const a = randomGenome(), b = randomGenome();
      let manual = 0;
      for (const name of KIN_GENES) manual += Math.abs(a[G[name]] - b[G[name]]);
      expect(kinDistance(a, b)).toBeCloseTo(manual / KIN_GENES.length, 12);
    }
  });

  it('ignores every gene that is not a kin gene', () => {
    const base = randomGenome();
    const reference = kinDistance(base, base);
    expect(reference).toBe(0);

    for (const [name, index] of Object.entries(G)) {
      const other = base.slice();
      other[index] = base[index] > 0.5 ? 0 : 1;      // move it as far as it goes
      if (KIN_GENES.includes(name)) {
        expect(kinDistance(base, other), `${name} should count`).toBeGreaterThan(0);
      } else {
        expect(kinDistance(base, other), `${name} should not count`).toBe(0);
      }
    }
  });

  it('is not the same thing as geneDistance', () => {
    const a = gene({ hue: 0.1 });
    const b = gene({ hue: 0.1, speed: 1, armor: 1 });
    expect(kinDistance(a, b)).toBe(0);
    expect(geneDistance(a, b)).toBeGreaterThan(0);
  });
});
