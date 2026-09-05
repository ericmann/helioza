#!/usr/bin/env node
// Equivalence check: the original single-file simulation versus the refactored
// module graph, driven by the same seeded generator, compared every single tick.
//
//   node scripts/verify-faithful.mjs                 20k ticks, a few seeds
//   node scripts/verify-faithful.mjs --ticks 50000 --seeds 1,2,3
//   node scripts/verify-faithful.mjs --self          original vs original
//
// --self proves the harness itself works before it is trusted to judge the
// refactor: identical seeds must match, different seeds must diverge.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { mulberry32 } from '../public/js/rng.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ORIGINAL = join(HERE, 'original.html');

// ── argument parsing ──────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const TICKS = Number(flag('ticks', 20000));
const SEEDS = String(flag('seeds', '1,20090612,987654321')).split(',').map(Number);
const SELF = argv.includes('--self');

// ── load the original core into a sandbox with a seeded Math.random ────────
function loadOriginal(seed) {
  const html = readFileSync(ORIGINAL, 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no <script> block found in scripts/original.html');

  const sandbox = {
    // The one thing we replace. Everything else the core touches is a real
    // built-in, and `document` is deliberately absent so the UI block, which
    // guards on `typeof document`, never runs.
    Math: Object.create(Math),
    module: { exports: {} },
    console,
  };
  sandbox.Math.random = mulberry32(seed);
  vm.createContext(sandbox);
  vm.runInContext(m[1], sandbox, { filename: 'original.html' });

  const { World, CFG } = sandbox.module.exports;
  if (!World) throw new Error('original core did not export World');
  return { World, CFG, world: new World(CFG) };
}

// ── load the refactored module graph ──────────────────────────────────────
async function loadRefactored(seed) {
  const [{ World }, { CFG }, { setSeed }] = await Promise.all([
    import('../public/js/world.js'),
    import('../public/js/config.js'),
    import('../public/js/rng.js'),
  ]);
  setSeed(seed);
  return { World, CFG, world: new World(CFG) };
}

// ── the observable state we hold the refactor to ──────────────────────────
function snapshot(w) {
  let plants = 0, meat = 0;
  for (const f of w.food) (f.kind === 'plant' ? plants++ : meat++);
  let sick = 0, herb = 0, omni = 0, carn = 0, energy = 0;
  const dietGene = 15;
  for (const o of w.orgs) {
    if (o.infected > 0) sick++;
    const d = o.g[dietGene];
    if (d < 0.33) herb++; else if (d < 0.67) omni++; else carn++;
    energy += o.energy;
  }
  return {
    tick: w.tick,
    pop: w.orgs.length,
    food: w.food.length,
    plants, meat, sick, herb, omni, carn,
    energy: energy.toFixed(6),
    cysts: w.cysts.length,
    luminosity: w.luminosity.toFixed(12),
    flare: w.flare,
    species: w.speciesCount,
    registry: w.species.length,
    stats: { ...w.stats },
  };
}

function firstDifference(a, b) {
  for (const k of Object.keys(a)) {
    if (k === 'stats') {
      for (const s of Object.keys(a.stats)) {
        if (a.stats[s] !== b.stats[s]) return `stats.${s}: ${a.stats[s]} vs ${b.stats[s]}`;
      }
      continue;
    }
    if (a[k] !== b[k]) return `${k}: ${a[k]} vs ${b[k]}`;
  }
  return null;
}

// ── run two worlds in lockstep and compare after every tick ───────────────
function race(A, B, ticks) {
  const start = Date.now();
  for (let t = 0; t < ticks; t++) {
    A.step();
    B.step();
    const diff = firstDifference(snapshot(A), snapshot(B));
    if (diff) return { ok: false, tick: t + 1, diff, ms: Date.now() - start };
  }
  return { ok: true, tick: ticks, ms: Date.now() - start, final: snapshot(A) };
}

function report(label, res) {
  const secs = (res.ms / 1000).toFixed(1);
  if (res.ok) {
    const f = res.final;
    console.log(`  ${label}  identical for ${res.tick.toLocaleString()} ticks  (${secs}s)`);
    console.log(`      final: pop ${f.pop}, food ${f.food} (${f.plants} plant / ${f.meat} carrion), ` +
      `cysts ${f.cysts}, species ${f.species}, born ${f.stats.born}, killed ${f.stats.killed}`);
  } else {
    console.log(`  ${label}  DIVERGED at tick ${res.tick.toLocaleString()} — ${res.diff}  (${secs}s)`);
  }
  return res.ok;
}

// ── main ──────────────────────────────────────────────────────────────────
let failures = 0;

if (SELF) {
  console.log(`Harness self-check: the original against itself, ${TICKS.toLocaleString()} ticks.\n`);

  const seed = SEEDS[0];
  console.log('Same seed must match:');
  if (!report(`seed ${seed} vs seed ${seed}`,
    race(loadOriginal(seed).world, loadOriginal(seed).world, TICKS))) failures++;

  console.log('\nDifferent seeds must diverge:');
  const other = SEEDS[1] ?? seed + 1;
  const res = race(loadOriginal(seed).world, loadOriginal(other).world, TICKS);
  if (res.ok) {
    console.log(`  seed ${seed} vs seed ${other}  MATCHED — the harness is not comparing anything`);
    failures++;
  } else {
    console.log(`  seed ${seed} vs seed ${other}  diverged at tick ${res.tick} — ${res.diff}`);
  }
} else {
  console.log(`Original vs refactored module graph, ${TICKS.toLocaleString()} ticks per seed.\n`);
  for (const seed of SEEDS) {
    const original = loadOriginal(seed).world;
    const refactored = (await loadRefactored(seed)).world;
    if (!report(`seed ${String(seed).padEnd(10)}`, race(original, refactored, TICKS))) failures++;
  }
}

console.log('');
if (failures) {
  console.log(`FAILED (${failures} of the comparisons above did not hold).`);
  process.exit(1);
}
console.log(SELF ? 'PASS — the harness detects a difference when there is one.'
  : 'PASS — the refactor is faithful.');
