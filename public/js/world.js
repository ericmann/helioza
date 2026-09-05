// The world: a star, a habitable band, plants that regrow, and whatever is
// still alive. Pure logic — no DOM, no canvas, no globals beyond the shared
// random stream. Import it from node and step it as fast as you like.

import { CFG, G, GENES } from './config.js';
import { rand, gauss, random } from './rng.js';
import { randomGenome, clamp01, kinDistance, breed, KIN_IDX } from './genome.js';
import { Organism, Cyst, Food } from './organism.js';

export class World {
  constructor(cfg = CFG) {
    this.cfg = cfg;
    this.reset();
  }
  reset() {
    this.tick = 0;
    this.orgs = [];
    this.food = [];
    this.stats = { born: 0, budded: 0, starved: 0, burned: 0, froze: 0, killed: 0, oldAge: 0, immigrants: 0, plantsEaten: 0, meatEaten: 0, infections: 0, encysted: 0, hatched: 0 };
    this.events = [];
    this.speciesCount = 0;
    this.species = [];        // registry: {id, hue, born, count, peak, alive}
    this.history = [];        // [{tick, counts: Map(id -> n)}]
    this.nextSpecies = 1;
    this.luminosity = 1; this.flare = 0; this.innerR = this.cfg.innerR; this.outerR = this.cfg.outerR;
    this.familiesSpawned = 0;
    this.cysts = [];
    this.hides = [];
    for (let i = 0; i < this.cfg.hideSpots; i++) {
      const ang = i / this.cfg.hideSpots * Math.PI * 2 + rand(-0.3, 0.3);
      const r = rand(this.cfg.innerR + 25, this.cfg.outerR - 25);
      const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
      const [vx, vy] = this.orbitalVelocity(x, y, 1);
      this.hides.push({ x, y, vx, vy, r: rand(28, 44) });
    }
    for (let i = 0; i < this.cfg.founders; i++) this.spawnFamily(this.cfg.familySize);
    for (let i = 0; i < 60; i++) this.spawnFood();
  }
  log(msg) { this.events.unshift(`${this.tick}: ${msg}`); if (this.events.length > 8) this.events.pop(); }

  orbitalVelocity(x, y, factor = 1) {
    const r = Math.hypot(x, y) || 1;
    const a = Math.min(this.cfg.gravity / (r * r), this.cfg.gravityCap);
    const v = Math.sqrt(a * r) * factor;
    return [-y / r * v, x / r * v];
  }
  spawnFamily(n, kind) {
    const founder = randomGenome();
    if (kind === undefined) kind = this.familiesSpawned++ % 4;
    if (kind === 0) {           // carnivore founder
      founder[G.diet] = rand(0.7, 1); founder[G.aggression] = rand(0.6, 1); founder[G.size] = rand(0.55, 1); founder[G.sense] = rand(0.5, 1);
    } else {                    // herbivore-leaning founder
      founder[G.diet] = rand(0, 0.35); founder[G.size] = rand(0, 0.6);
    }
    const ang = rand(0, Math.PI * 2), r = rand(this.cfg.innerR + 30, this.cfg.outerR - 30);
    for (let i = 0; i < n; i++) {
      const g = founder.map(v => clamp01(v + gauss() * this.cfg.founderSigma));
      const a = ang + gauss() * 0.15, rr = r + gauss() * 20;
      this.spawnRandom(g, Math.cos(a) * rr, Math.sin(a) * rr);
    }
  }
  spawnRandom(genome = randomGenome(), x, y) {
    if (x === undefined) {
      const ang = rand(0, Math.PI * 2);
      const r = rand(this.cfg.innerR + 20, this.cfg.outerR - 20);
      x = Math.cos(ang) * r; y = Math.sin(ang) * r;
    }
    const [vx, vy] = this.orbitalVelocity(x, y, 1);
    const o = new Organism(genome, x, y, vx, vy, 1e9);
    o.energy = o.maxEnergy * rand(0.55, 0.85);
    o.age = rand(0, this.cfg.maturity);
    this.orgs.push(o);
    return o;
  }
  spawnFood(x, y) {
    if (this.food.length >= this.cfg.foodCap) return;
    if (x === undefined) {
      const ang = rand(0, Math.PI * 2);
      // mild bias toward the star, where the light is
      const r = this.cfg.innerR * 0.85 + (this.cfg.worldR - 10 - this.cfg.innerR * 0.85) * Math.pow(random(), 1.25);
      x = Math.cos(ang) * r; y = Math.sin(ang) * r;
    }
    const [vx, vy] = this.orbitalVelocity(x, y, rand(0.9, 1.0));
    this.food.push(new Food(x, y, vx, vy, this.cfg.foodEnergy));
  }
  isKin(a, b) { return kinDistance(a.g, b.g) < this.cfg.kinThreshold; }

  kill(o, cause) {
    if (!o.alive) return;
    o.alive = false; o.cause = cause;
    const key = { starved: 'starved', burned: 'burned', froze: 'froze', killed: 'killed', eaten: 'killed', oldAge: 'oldAge', smitten: 'killed' }[cause];
    if (key) this.stats[key]++;
    // carrion: whatever mass is left becomes food, unless the star or a predator took it
    if (cause !== 'burned' && cause !== 'smitten' && cause !== 'eaten') {
      const e = 20 + 50 * o.g[G.size] + Math.max(0, o.energy) * 0.5;
      this.food.push(new Food(o.x, o.y, o.vx, o.vy, e, 'meat'));
    }
  }

  step() {
    const cfg = this.cfg;
    this.tick++;
    const orgs = this.orgs, food = this.food;

    // ── hiding spots orbit without drag ──
    for (const h of this.hides) {
      const r = Math.hypot(h.x, h.y) || 1;
      const a = Math.min(cfg.gravity / (r * r), cfg.gravityCap);
      h.vx += -h.x / r * a; h.vy += -h.y / r * a;
      h.x += h.vx; h.y += h.vy;
    }
    for (const o of orgs) {
      o.hidden = false;
      for (const h of this.hides) { const dx = o.x - h.x, dy = o.y - h.y; if (dx * dx + dy * dy < h.r * h.r) { o.hidden = true; break; } }
    }

    // ── star: slow luminosity cycle plus occasional flares ──
    if (this.flare > 0) this.flare--;
    else if (random() < cfg.flareChance && this.tick > 2000) { this.flare = cfg.flareLength; this.log('solar flare'); }
    this.luminosity = 1 + cfg.solarAmplitude * Math.sin(this.tick / cfg.solarPeriod * Math.PI * 2) + (this.flare > 0 ? cfg.flareBoost * Math.sin(this.flare / cfg.flareLength * Math.PI) : 0);
    const lum = Math.sqrt(this.luminosity);
    this.innerR = cfg.innerR * lum; this.outerR = cfg.outerR * lum;

    // ── plants regrow logistically from standing stock, plus a trickle of seeds ──
    const plants = food.reduce((n, f) => n + (f.alive && f.kind === 'plant' ? 1 : 0), 0);
    const spawnP = cfg.foodRate + cfg.plantGrowth * plants * Math.max(0, 1 - plants / cfg.foodCap);
    let sp = spawnP; while (sp > 0) { if (random() < sp) this.spawnFood(); sp -= 1; }

    // ── disease ──
    if (this.tick % cfg.plagueEvery === 0 && orgs.length > 40) {
      const victim = orgs[Math.floor(random() * orgs.length)];
      if (victim.alive && !victim.infected) { victim.infected = cfg.plagueLength; this.log(`a plague breaks out in species ${victim.species || '?'}`); }
    }
    // ── cysts: dormant, gravity-bound, hatch when there is something to eat ──
    let plantCount = 0, meatCount = 0;
    for (const f of food) if (f.alive) { if (f.kind === 'plant') plantCount++; else meatCount++; }
    const hatched = [];
    for (const c of this.cysts) {
      const r = Math.hypot(c.x, c.y) || 1;
      const a = Math.min(cfg.gravity / (r * r), cfg.gravityCap);
      c.vx += -c.x / r * a; c.vy += -c.y / r * a;
      c.x += c.vx; c.y += c.vy;
      c.age++;
      if (r < cfg.coronaR || r > cfg.worldR + 40 || c.age > cfg.cystMaxAge) { c.alive = false; continue; }
      if (c.age > cfg.cystMinDormancy && c.age % 30 === 0 && r > this.innerR && r < this.outerR
          && plantCount * c.plantEff + meatCount * c.meatEff >= cfg.cystHatchFood) {
        const o = new Organism(c.g, c.x, c.y, c.vx, c.vy, 1e9, c.generation);
        o.energy = Math.max(o.maxEnergy * 0.08, c.energy * cfg.cystHatchEnergy); o.age = cfg.maturity; o.species = c.species; o.hasEncysted = true;
        hatched.push(o); c.alive = false; this.stats.hatched++;
      }
    }
    if (hatched.length) { for (const o of hatched) orgs.push(o); }
    this.cysts = this.cysts.filter(c => c.alive);

    for (const f of food) {
      const r = Math.hypot(f.x, f.y) || 1;
      const a = Math.min(cfg.gravity / (r * r), cfg.gravityCap);
      f.vx += -f.x / r * a; f.vy += -f.y / r * a;
      f.vx *= 1 - cfg.drag; f.vy *= 1 - cfg.drag;
      f.x += f.vx; f.y += f.vy;
      if (r < cfg.coronaR || r > cfg.worldR + 40) f.alive = false;
      if (f.kind === 'meat') { f.energy -= 0.02; if (f.energy <= 0) f.alive = false; }   // carrion rots
    }

    // ── perception + steering ──
    for (const o of orgs) {
      if (!o.alive) continue;
      const g = o.g;
      let nf = null, nfd = Infinity, nk = null, nkd = Infinity, ns = null, nsd = Infinity;
      const sr2 = o.senseR * o.senseR;
      for (const f of food) {
        if (!f.alive) continue;
        const eff = f.kind === 'plant' ? o.plantEff : o.meatEff;
        if (eff < 0.15) continue;                          // not worth digesting
        const dx = f.x - o.x, dy = f.y - o.y, d2 = (dx * dx + dy * dy) / (eff * eff);   // prefer what it digests well
        if (d2 < sr2 && d2 < nfd) { nfd = d2; nf = f; }
      }
      let prey = null, preyd = Infinity, threat = null, threatd = Infinity;
      const hunter = g[G.aggression] > 0.45 && o.meatEff > 0.3 && o.energy < o.maxEnergy * 0.7;   // satiated predators don't hunt
      const starving = o.energy < o.maxEnergy * 0.4;
      for (const p of orgs) {
        if (p === o || !p.alive) continue;
        const dx = p.x - o.x, dy = p.y - o.y, d2 = dx * dx + dy * dy;
        if (d2 > sr2) continue;
        const kin = this.isKin(o, p);
        if (kin) { if (d2 < nkd) { nkd = d2; nk = p; } }
        else if (!p.hidden && d2 < nsd) { nsd = d2; ns = p; }
        if (p.hidden) continue;
        if (hunter && p.r < o.r * cfg.preyRatio && (!kin || (starving && g[G.kinTolerance] < 0.5)) && d2 < preyd) { preyd = d2; prey = p; }
        if (p.g[G.aggression] > 0.45 && p.meatEff > 0.3 && o.r < p.r * cfg.preyRatio && d2 < threatd) { threatd = d2; threat = p; }
      }
      o.nearKin = nk; o.nearStranger = ns; o.prey = prey; o.threat = threat;
      let nh = null, nhd = Infinity;
      for (const h of this.hides) { const dx = h.x - o.x, dy = h.y - o.y, d2 = dx * dx + dy * dy; if (d2 < sr2 * 1.5 && d2 < nhd) { nhd = d2; nh = h; } }

      let sx = 0, sy = 0;
      const pull = (t, w) => { if (!t || !w) return; const dx = t.x - o.x, dy = t.y - o.y, d = Math.hypot(dx, dy) || 1; sx += dx / d * w; sy += dy / d * w; };
      const hungry = 1.2 - o.energy / o.maxEnergy;         // 0.2 when full, 1.2 when empty
      o.settling = !o.hasEncysted && o.energy < o.maxEnergy * cfg.cystAt && !(nf && nfd < 40 * 40);   // starving, and no food in reach
      if (!o.settling) {
      pull(nf, g[G.foodDrive] * (1.2 + 1.6 * hungry));
      pull(nk, (g[G.kinDrive] * 2 - 1) * (o.energy > o.mateAt ? 1.4 : 0.8));
      pull(ns, (g[G.strangerDrive] * 2 - 1) * (g[G.aggression] > 0.45 ? 0.8 + hungry * 0.6 : 1));
      pull(prey, o.meatEff * (0.5 + hungry * 1.4));
      const threatened = threat && threatd < 80 * 80;
      if (threatened) pull(threat, -g[G.fear] * 2.2);
      pull(nh, g[G.hideDrive] * (1.3 - hungry) * (threatened ? 1.8 : 1) * (o.hidden ? 0.4 : 1));
      }
      // orbit steering: aim for circular velocity at the preferred radius,
      // plus a radial nudge toward it. Weighted by the orbitHold gene, with a
      // hard-wired survival reflex near the corona and the cold rim.
      const r = o.dist || 1, ux = o.x / r, uy = o.y / r;
      const spin = (o.x * o.vy - o.y * o.vx) >= 0 ? 1 : -1;   // keep current sense of rotation
      const accel = Math.min(cfg.gravity / (r * r), cfg.gravityCap);
      const vCirc = Math.sqrt(accel * r);
      // preferred radius tracks the star's output; a settling organism aims for the safe middle of the band
      const prefR = o.settling ? Math.max(this.innerR * 1.2, Math.min(this.outerR * 0.9, r)) : o.prefR * lum;
      const off = Math.max(-1, Math.min(1, (prefR - r) / 90));
      const danger = r < this.innerR * 0.85 || r > this.outerR * 1.12;
      const hold = (danger || o.settling) ? 1.6 : g[G.orbitHold] * 1.3;
      const dvx = -uy * spin * vCirc + ux * off * 0.5 - o.vx;
      const dvy = ux * spin * vCirc + uy * off * 0.5 - o.vy;
      sx += dvx * hold * 1.4; sy += dvy * hold * 1.4;
      // encyst once the orbit is circular and inside the band
      if (o.settling && r > this.innerR * 1.1 && r < this.outerR * 0.95 && Math.hypot(dvx, dvy) < 0.12 && o.energy > o.maxEnergy * 0.05) {
        o.alive = false; o.cause = 'encysted'; o.hasEncysted = true;
        this.cysts.push(new Cyst(o)); this.stats.encysted++;
        continue;
      }

      const mag = Math.hypot(sx, sy);
      o.sprinting = !!(prey && preyd < 140 * 140 && hungry > 0.5);
      if (mag > 0.05) {
        const boost = o.sprinting ? cfg.sprint : 1;
        const t = o.thrust * Math.min(1, mag) * boost;
        o.vx += sx / mag * t; o.vy += sy / mag * t;
        o.energy -= t * 0.5 * (0.5 + o.r / 6) * (o.sprinting ? 1.6 : 1);
      }
    }

    // ── organism physics, metabolism, environment ──
    for (const o of orgs) {
      if (!o.alive) continue;
      const cfgc = cfg;
      const r = o.dist || 1;
      const a = Math.min(cfgc.gravity / (r * r), cfgc.gravityCap);
      o.vx += -o.x / r * a; o.vy += -o.y / r * a;
      o.vx *= 1 - cfgc.drag; o.vy *= 1 - cfgc.drag;
      const sp = Math.hypot(o.vx, o.vy), maxSp = o.maxSpeed * (o.sprinting ? cfgc.sprint : 1);
      if (sp > maxSp) { o.vx *= maxSp / sp; o.vy *= maxSp / sp; }
      o.x += o.vx; o.y += o.vy;
      o.age++;
      if (o.mateTimer > 0) o.mateTimer--;

      const g = o.g;
      o.energy -= (cfgc.baseMetabolism + 0.05 * g[G.size] * g[G.size] + 0.012 * g[G.armor] + 0.010 * g[G.sense] + 0.008 * g[G.aggression]) * (o.hidden ? cfgc.hideMetabolism : 1);

      const nr = o.dist;
      if (nr < cfgc.coronaR) { this.kill(o, 'burned'); continue; }
      // big bodies absorb more heat; small bodies lose heat faster (surface/volume)
      const inR = this.innerR, outR = this.outerR;
      if (nr < inR) o.energy -= cfgc.heatRate * (0.4 + 1.2 * g[G.size]) * ((inR - nr) / inR) ** 1.5;
      if (nr > outR) o.energy -= cfgc.coldRate * (1.6 - 1.2 * g[G.size]) * ((nr - outR) / (cfgc.worldR - outR)) ** 1.5;
      if (o.infected > 0) { o.energy -= cfgc.plagueDrain; if (--o.infected === 0) o.recovered = true; }
      if (nr > cfgc.worldR + 30) { this.kill(o, 'froze'); continue; }
      if (o.energy <= 0) {
        const cause = nr < inR ? 'burned' : nr > outR ? 'froze' : 'starved';
        this.kill(o, cause); continue;
      }
      if (o.age > o.maxAge) { this.kill(o, 'oldAge'); continue; }
    }

    // ── eating ──
    for (const o of orgs) {
      if (!o.alive || o.hidden) continue;        // nothing to eat in the dark
      for (const f of food) {
        if (!f.alive) continue;
        const dx = f.x - o.x, dy = f.y - o.y;
        if (dx * dx + dy * dy < (o.r + 4) ** 2) {
          const eff = f.kind === 'plant' ? o.plantEff : o.meatEff;
          if (eff < 0.15) continue;
          f.alive = false;
          o.energy = Math.min(o.maxEnergy, o.energy + f.energy * eff);
          if (f.kind === 'plant') { this.stats.plantsEaten++; o.atePlant += f.energy * eff; } else { this.stats.meatEaten++; o.ateMeat += f.energy * eff; }
        }
      }
    }

    // ── contact: combat and mating ──
    const born = [];
    for (let i = 0; i < orgs.length; i++) {
      const a = orgs[i]; if (!a.alive) continue;
      for (let j = i + 1; j < orgs.length; j++) {
        const b = orgs[j]; if (!b.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
        const reach = a.r + b.r + 3 + (a.prey === b || b.prey === a ? 5 : 0);
        if (d2 > reach * reach) continue;
        if ((a.infected > 0) !== (b.infected > 0) && Math.abs(a.g[G.immune] - b.g[G.immune]) < cfg.immuneMatch) {
          const sick = a.infected > 0 ? a : b, well = sick === a ? b : a;
          if (!well.recovered && random() < cfg.plagueSpread) { well.infected = cfg.plagueLength; this.stats.infections++; }
        }
        if (this.isKin(a, b)) {
          if (a.age > cfg.maturity && b.age > cfg.maturity && a.mateTimer === 0 && b.mateTimer === 0
              && a.energy > a.mateAt && b.energy > b.mateAt) {
            const ea = a.energy * cfg.mateCost, eb = b.energy * cfg.mateCost;
            a.energy -= ea; b.energy -= eb;
            a.mateTimer = b.mateTimer = cfg.mateCooldown;
            a.lonely = b.lonely = 0;
            a.offspring++; b.offspring++;
            const ra = a.realizedDiet, rb = b.realizedDiet;
            const realized = ra === null ? rb : rb === null ? ra : (ra + rb) / 2;
            const child = new Organism(breed(a.g, b.g, cfg, realized), (a.x + b.x) / 2, (a.y + b.y) / 2,
              (a.vx + b.vx) / 2, (a.vy + b.vy) / 2, ea + eb, Math.max(a.generation, b.generation) + 1);
            born.push(child);
            this.stats.born++;
          }
        }
        this.fight(a, b); this.fight(b, a);
      }
      // soft collision so bodies don't stack
      for (let j = i + 1; j < orgs.length; j++) {
        const b = orgs[j]; if (!b.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, min = a.r + b.r;
        if (d < min) { const push = (min - d) * 0.15; a.x -= dx / d * push; a.y -= dy / d * push; b.x += dx / d * push; b.y += dy / d * push; }
      }
    }
    // asexual budding for the mateless
    for (const o of orgs) {
      if (!o.alive || o.age < cfg.maturity || o.mateTimer > 0 || o.energy < o.mateAt) { if (o.alive && o.mateTimer === 0) o.lonely = 0; continue; }
      if (++o.lonely < cfg.budAfter) continue;
      const e = o.energy * cfg.budCost; o.energy -= e;
      o.mateTimer = cfg.mateCooldown; o.lonely = 0; o.offspring++;
      const ang = rand(0, Math.PI * 2);
      born.push(new Organism(breed(o.g, o.g, cfg, o.realizedDiet), o.x + Math.cos(ang) * o.r * 2, o.y + Math.sin(ang) * o.r * 2, o.vx, o.vy, e, o.generation + 1));
      this.stats.born++; this.stats.budded++;
    }
    for (const c of born) orgs.push(c);

    // ── cleanup and population floor ──
    this.orgs = orgs.filter(o => o.alive);
    this.food = food.filter(f => f.alive);
    if (this.orgs.length < cfg.minPop && cfg.immigration) {
      this.log(`population fell to ${this.orgs.length}; a family of ${cfg.immigrants} immigrants arrived`);
      this.spawnFamily(cfg.immigrants);
      this.stats.immigrants++;
    }
    if (this.orgs.length === 0 && this.cysts.length === 0 && !this.extinct) { this.extinct = true; this.log('life is extinct'); }
    if (this.orgs.length > 0) this.extinct = false;
    if (this.tick % 90 === 0) this.trackSpecies();
  }

  fight(att, def) {
    if (att.prey !== def) return;            // only attacks what it decided to hunt (size ladder, kin tolerance)
    if (def.hidden || att.hidden) return;
    const ag = att.g[G.aggression];
    // a bite: a kill should take a handful of contact ticks, not a siege
    const sizeAdv = Math.pow(att.r / def.r, 2.5);
    const dmg = Math.max(0, (ag - 0.3) * 12 * (0.5 + att.r / 8) * sizeAdv - def.g[G.armor] * 6);
    att.energy -= 0.4;
    if (dmg <= 0) return;
    def.energy -= dmg;
    if (def.energy <= 0) {
      att.kills++;
      // the kill is a meal: the victim's remaining reserves plus its body
      const meal = (Math.max(0, def.energy + dmg) * this.cfg.killYield + 25 + 70 * def.g[G.size]) * att.meatEff;
      att.energy = Math.min(att.maxEnergy, att.energy + meal); att.ateMeat += meal;
      this.kill(def, 'eaten');
      if (att.kills === 5) this.log(`#${att.id} has made 5 kills`);
    }
  }

  // Cluster the population into species (single linkage on kin distance) and
  // carry species identity forward by matching cluster centroids to the previous pass.
  trackSpecies() {
    const orgs = this.orgs, n = orgs.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
      if (this.isKin(orgs[i], orgs[j])) parent[find(i)] = find(j);
    const groups = new Map();
    for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(orgs[i]); }
    const clusters = [...groups.values()].map(members => {
      const c = KIN_IDX.map(() => 0);
      for (const o of members) KIN_IDX.forEach((gi, k) => c[k] += o.g[gi]);
      const centroid = c.map(v => v / members.length);
      const prevIds = new Map();
      for (const o of members) if (o.species) prevIds.set(o.species, (prevIds.get(o.species) || 0) + 1);
      return { members, centroid, prevIds };
    }).sort((a, b) => b.members.length - a.members.length);

    const claimed = new Set();
    const counts = new Map();
    for (const cl of clusters) {
      // inherit the id most of its members already carry, largest cluster first
      let best = null, bestN = 0;
      for (const [id, k] of cl.prevIds) if (!claimed.has(id) && k > bestN) { best = id; bestN = k; }
      let sp;
      if (best) sp = this.species.find(s => s.id === best);
      else {
        const hue = Math.round(360 * cl.centroid[0]);
        sp = { id: this.nextSpecies++, hue, born: this.tick, count: 0, peak: 0, alive: true };
        this.species.push(sp);
        if (this.tick > 0 && cl.members.length >= 3) this.log(`species ${sp.id} split off (${cl.members.length} members)`);
      }
      claimed.add(sp.id);
      sp.alive = true; sp.count = cl.members.length; sp.peak = Math.max(sp.peak, sp.count);
      sp.hue = Math.round(360 * cl.centroid[0]);
      for (const o of cl.members) o.species = sp.id;
      counts.set(sp.id, sp.count);
    }
    for (const sp of this.species) {
      if (sp.alive && !claimed.has(sp.id)) {
        sp.alive = false; sp.count = 0;
        if (sp.peak >= 8) this.log(`species ${sp.id} went extinct (peaked at ${sp.peak})`);
      }
    }
    // dominance events
    const total = n || 1;
    for (const sp of this.species) {
      const share = (counts.get(sp.id) || 0) / total;
      if (share >= 0.6 && !sp.dominant && total >= 30) { sp.dominant = true; this.log(`species ${sp.id} now holds ${Math.round(share * 100)}% of the population`); }
      if (share < 0.4) sp.dominant = false;
    }
    this.speciesCount = clusters.filter(c => c.members.length >= 2).length;
    this.history.push({ tick: this.tick, counts });
    if (this.history.length > 360) this.history.shift();
  }

  averageGenome() {
    const avg = GENES.map(() => 0);
    for (const o of this.orgs) for (let i = 0; i < avg.length; i++) avg[i] += o.g[i];
    return avg.map(v => this.orgs.length ? v / this.orgs.length : 0);
  }
}
