#!/usr/bin/env node
// Run the simulation with no browser attached and report what happened.
//
//   node scripts/headless.mjs                        one run, seed 1
//   node scripts/headless.mjs --seed 7 --ticks 50000
//   node scripts/headless.mjs --seeds 1..40 --ticks 30000 --quiet
//
// Useful for tuning, for finding a seed whose ecology survives, and for seeing
// whether a change to the core actually moved the numbers.

import { CFG, G } from '../public/js/config.js';
import { setSeed } from '../public/js/rng.js';
import { World } from '../public/js/world.js';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const TICKS = Number(flag('ticks', 30000));
const QUIET = argv.includes('--quiet');

function parseSeeds(spec) {
  if (spec.includes('..')) {
    const [a, b] = spec.split('..').map(Number);
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }
  return spec.split(',').map(Number);
}
const SEEDS = parseSeeds(String(flag('seeds', flag('seed', '1'))));

function run(seed, ticks) {
  setSeed(seed);
  const world = new World(CFG);
  let peak = 0, extinctAt = null;
  for (let t = 0; t < ticks; t++) {
    world.step();
    peak = Math.max(peak, world.orgs.length);
    if (extinctAt === null && world.orgs.length === 0 && world.cysts.length === 0) extinctAt = world.tick;
  }
  let herb = 0, omni = 0, carn = 0, size = 0, gen = 0, plants = 0;
  for (const o of world.orgs) {
    const d = o.g[G.diet];
    if (d < 0.33) herb++; else if (d < 0.67) omni++; else carn++;
    size += o.g[G.size];
    gen = Math.max(gen, o.generation);
  }
  for (const f of world.food) if (f.kind === 'plant') plants++;
  const n = world.orgs.length || 1;
  return {
    seed, ticks, peak, extinctAt,
    pop: world.orgs.length, cysts: world.cysts.length,
    herb, omni, carn,
    plants, carrion: world.food.length - plants,
    avgSize: size / n,
    topGeneration: gen,
    species: world.speciesCount,
    lineages: world.species.length,
    stats: world.stats,
    events: world.events,
  };
}

const pad = (s, n) => String(s).padStart(n);

if (SEEDS.length > 1) {
  console.log(`${TICKS.toLocaleString()} ticks per seed\n`);
  console.log('  seed   pop  peak  cysts   h/o/c        gen  species  born  killed  starved  extinct at');
  for (const seed of SEEDS) {
    const r = run(seed, TICKS);
    console.log(`  ${pad(r.seed, 4)}  ${pad(r.pop, 4)}  ${pad(r.peak, 4)}  ${pad(r.cysts, 5)}  ` +
      `${pad(`${r.herb}/${r.omni}/${r.carn}`, 10)}  ${pad(r.topGeneration, 5)}  ${pad(r.species, 7)}  ` +
      `${pad(r.stats.born, 4)}  ${pad(r.stats.killed, 6)}  ${pad(r.stats.starved, 7)}  ${pad(r.extinctAt ?? '—', 10)}`);
  }
} else {
  const r = run(SEEDS[0], TICKS);
  console.log(`seed ${r.seed}, ${r.ticks.toLocaleString()} ticks\n`);
  console.log(`  alive            ${r.pop}   (peak ${r.peak})`);
  console.log(`  diets            ${r.herb} herbivore / ${r.omni} omnivore / ${r.carn} carnivore`);
  console.log(`  dormant cysts    ${r.cysts}`);
  console.log(`  food             ${r.plants} plants, ${r.carrion} carrion`);
  console.log(`  mean size gene   ${r.avgSize.toFixed(3)}`);
  console.log(`  top generation   ${r.topGeneration}`);
  console.log(`  species now      ${r.species}   (${r.lineages} ever recorded)`);
  console.log(`  first extinction ${r.extinctAt ?? 'never'}`);
  console.log('');
  for (const [k, v] of Object.entries(r.stats)) console.log(`  ${k.padEnd(16)} ${v}`);
  if (!QUIET && r.events.length) {
    console.log('\n  last events');
    for (const e of r.events) console.log(`    ${e}`);
  }
}
