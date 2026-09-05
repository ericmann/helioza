// The three things that exist in the world: organisms, the cysts they curl up
// into when the food runs out, and the food itself.

import { CFG, G } from './config.js';
import { rand } from './rng.js';

let nextId = 1;

export class Organism {
  constructor(genome, x, y, vx, vy, energy, generation = 0) {
    this.id = nextId++;
    this.g = genome;
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.age = 0;
    this.generation = generation;
    this.kills = 0; this.offspring = 0;
    this.mateTimer = 0;
    this.maxAge = rand(CFG.maxAgeMin, CFG.maxAgeMax);
    this.alive = true;
    this.cause = null;
    this.hidden = false;
    this.species = 0;
    this.lonely = 0;
    this.infected = 0;      // ticks of disease remaining
    this.recovered = false;
    this.atePlant = 0; this.ateMeat = 0;
    this.settling = false;  // heading for a stable orbit to encyst
    this.hasEncysted = false;
    this.refresh();
    this.energy = Math.min(energy, this.maxEnergy);
  }
  refresh() {
    const g = this.g;
    this.r = 3 + 6 * g[G.size];
    this.maxEnergy = (50 + 130 * g[G.size]) * (1 + 0.6 * g[G.diet]);   // carnivores store fat between meals
    this.thrust = (0.003 + 0.02 * g[G.speed]) * (1.1 - 0.3 * g[G.size]);    // big bodies accelerate a little slower
    this.maxSpeed = CFG.maxSpeed * (1.12 - 0.3 * g[G.size]);                 // and top out a little lower
    this.plantEff = Math.pow(1 - g[G.diet], 1.7);   // concave: specialists digest well, generalists pay for flexibility
    this.meatEff = Math.pow(g[G.diet], 1.7);
    this.senseR = 30 + 150 * g[G.sense];
    this.prefR = CFG.innerR * 0.75 + (CFG.outerR * 1.12 - CFG.innerR * 0.75) * g[G.orbitRadius];
    this.mateAt = this.maxEnergy * (0.35 + 0.6 * g[G.mateDrive]);
    this.hue = Math.round(360 * g[G.hue]);
  }
  get dist() { return Math.hypot(this.x, this.y); }
  get realizedDiet() { const t = this.atePlant + this.ateMeat; return t > 0 ? this.ateMeat / t : null; }
}

export class Cyst {
  constructor(o) {
    this.x = o.x; this.y = o.y; this.vx = o.vx; this.vy = o.vy;
    this.g = o.g; this.generation = o.generation; this.species = o.species; this.hue = o.hue;
    this.plantEff = o.plantEff; this.meatEff = o.meatEff;
    this.energy = o.energy;     // hatches with what it went in with, less dormancy cost
    this.age = 0; this.alive = true;
  }
}

export class Food {
  constructor(x, y, vx, vy, energy, kind = 'plant') { this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.energy = energy; this.kind = kind; this.alive = true; }
}

/** Test hook: rewind the id counter so ids are reproducible across worlds. */
export function resetIds(n = 1) { nextId = n; }
