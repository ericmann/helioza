import { describe, it, expect } from 'vitest';
import { CFG, G } from '../public/js/config.js';
import { Organism } from '../public/js/organism.js';
import { gene } from './helpers.js';

// The comments in organism.js make specific claims about which way each derived
// trait moves. These tests hold them to it.

const build = (overrides) => new Organism(gene(overrides), 0, 200, 0, 0, 1e9);
const sweep = (name, other = {}) =>
  [0, 0.25, 0.5, 0.75, 1].map(v => build({ ...other, [name]: v }));

const risesWith = (list, read) => {
  for (let i = 1; i < list.length; i++) expect(read(list[i])).toBeGreaterThan(read(list[i - 1]));
};
const fallsWith = (list, read) => {
  for (let i = 1; i < list.length; i++) expect(read(list[i])).toBeLessThan(read(list[i - 1]));
};

describe('thrust', () => {
  it('rises with the speed gene', () => {
    risesWith(sweep('speed'), o => o.thrust);
  });

  it('falls with the size gene — big bodies accelerate a little slower', () => {
    fallsWith(sweep('size', { speed: 0.5 }), o => o.thrust);
  });
});

describe('maxSpeed', () => {
  it('falls with the size gene — big bodies top out a little lower', () => {
    fallsWith(sweep('size'), o => o.maxSpeed);
  });

  it('never exceeds the configured ceiling by more than the size bonus allows', () => {
    expect(build({ size: 0 }).maxSpeed).toBeCloseTo(CFG.maxSpeed * 1.12, 10);
    expect(build({ size: 1 }).maxSpeed).toBeCloseTo(CFG.maxSpeed * 0.82, 10);
  });
});

describe('maxEnergy', () => {
  it('rises with the size gene', () => {
    risesWith(sweep('size'), o => o.maxEnergy);
  });

  it('rises with the diet gene — carnivores store fat between meals', () => {
    risesWith(sweep('diet', { size: 0.5 }), o => o.maxEnergy);
  });
});

describe('digestion', () => {
  it('plantEff falls as the diet gene moves toward meat', () => {
    fallsWith(sweep('diet'), o => o.plantEff);
  });

  it('meatEff rises as the diet gene moves toward meat', () => {
    risesWith(sweep('diet'), o => o.meatEff);
  });

  it('is concave: a generalist digests both worse than a specialist digests one', () => {
    const omnivore = build({ diet: 0.5 });
    expect(omnivore.plantEff).toBeLessThan(0.5);
    expect(omnivore.meatEff).toBeLessThan(0.5);
    expect(omnivore.plantEff + omnivore.meatEff).toBeLessThan(1);
  });

  it('puts a pure carnivore below the edibility cutoff for plants', () => {
    // step() and the perception loop both skip food whose efficiency is under
    // 0.15, so a pure carnivore literally cannot see a plant.
    const carnivore = build({ diet: 1 });
    expect(carnivore.plantEff).toBeLessThan(0.15);
    expect(carnivore.meatEff).toBe(1);

    const herbivore = build({ diet: 0 });
    expect(herbivore.meatEff).toBeLessThan(0.15);
    expect(herbivore.plantEff).toBe(1);
  });

  it('draws the cutoff somewhere inside the omnivore range', () => {
    // Which is what makes the middle of the diet axis an uncomfortable place
    // to sit, and why the axis splits into two lineages rather than smearing.
    const eats = d => build({ diet: d }).plantEff >= 0.15;
    expect(eats(0.6)).toBe(true);
    expect(eats(0.75)).toBe(false);
  });
});

describe('other derived traits', () => {
  it('radius, sense radius and preferred orbit all rise with their genes', () => {
    risesWith(sweep('size'), o => o.r);
    risesWith(sweep('sense'), o => o.senseR);
    risesWith(sweep('orbitRadius'), o => o.prefR);
  });

  it('keeps the preferred orbit inside the world', () => {
    for (const o of sweep('orbitRadius')) {
      expect(o.prefR).toBeGreaterThan(CFG.coronaR);
      expect(o.prefR).toBeLessThan(CFG.worldR);
    }
  });

  it('reports realized diet only once the organism has eaten', () => {
    const o = build({ diet: 0.5 });
    expect(o.realizedDiet).toBe(null);
    o.atePlant = 30;
    expect(o.realizedDiet).toBe(0);
    o.ateMeat = 90;
    expect(o.realizedDiet).toBe(0.75);
  });

  it('caps starting energy at the organism can hold', () => {
    const o = build({ size: 0 });
    expect(o.energy).toBe(o.maxEnergy);
  });

  it('refreshes derived traits when the genome is edited in place', () => {
    const o = build({ size: 0 });
    const before = o.r;
    o.g[G.size] = 1;
    o.refresh();
    expect(o.r).toBeGreaterThan(before);
  });
});
