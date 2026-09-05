import { describe, it, expect } from 'vitest';
import { CFG, G } from '../public/js/config.js';
import { setSeed } from '../public/js/rng.js';
import { Organism, Cyst, Food } from '../public/js/organism.js';
import { bareWorld, place, gene } from './helpers.js';

// Each of these stands up exactly the world state it needs and steps the real
// World.step(). Config levers are used to switch off the mechanics that would
// otherwise drown out the one under test; no formula is reimplemented here.

const QUIET = { founders: 0, foodRate: 0, plantGrowth: 0, hideSpots: 0, plagueEvery: 1e9, flareChance: 0 };

describe('gravity and orbitalVelocity', () => {
  it('hold a near-circular orbit for a full period', () => {
    // Drag is what decays orbits over time; switch it off and the integrator
    // should come back around to where it started.
    const world = bareWorld(1, { ...QUIET, drag: 0 });
    const r0 = 250;
    const [vx, vy] = world.orbitalVelocity(r0, 0, 1);
    world.food.push(new Food(r0, 0, vx, vy, CFG.foodEnergy));
    const f = world.food[0];

    const speed = Math.hypot(vx, vy);
    const period = Math.round((2 * Math.PI * r0) / speed);

    let min = Infinity, max = 0;
    for (let t = 0; t < period; t++) {
      world.step();
      const r = Math.hypot(f.x, f.y);
      min = Math.min(min, r); max = Math.max(max, r);
    }

    expect(f.alive).toBe(true);
    expect(max / min).toBeLessThan(1.02);                 // the orbit is a circle, not an ellipse
    expect(Math.hypot(f.x - r0, f.y)).toBeLessThan(r0 * 0.05);  // and it closes
  });

  it('gives a faster circular speed closer in', () => {
    const world = bareWorld(1, QUIET);
    const near = Math.hypot(...world.orbitalVelocity(150, 0));
    const far = Math.hypot(...world.orbitalVelocity(320, 0));
    expect(near).toBeGreaterThan(far);
  });

  it('spirals inward once drag is switched back on', () => {
    const world = bareWorld(1, QUIET);
    const [vx, vy] = world.orbitalVelocity(250, 0, 1);
    const f = new Food(250, 0, vx, vy, CFG.foodEnergy);
    world.food.push(f);
    for (let t = 0; t < 2000; t++) world.step();
    expect(Math.hypot(f.x, f.y)).toBeLessThan(250);
  });
});

describe('temperature damage', () => {
  // Isolate the environmental term by running the identical state twice, once
  // with the rate switched off. The difference is the damage and nothing else.
  const damageFrom = (rateKey, radius, sizeGene) => {
    const run = (rate) => {
      const world = bareWorld(7, { ...QUIET, [rateKey]: rate });
      const o = place(world, gene({ size: sizeGene, orbitRadius: 0.5 }), radius, { energyFraction: 0.9 });
      const before = o.energy;
      world.step();
      return before - o.energy;
    };
    return run(CFG[rateKey]) - run(0);
  };

  it('burns bigger bodies harder inside the inner edge', () => {
    const radius = CFG.innerR * 0.6;
    const small = damageFrom('heatRate', radius, 0);
    const large = damageFrom('heatRate', radius, 1);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
  });

  it('freezes smaller bodies harder outside the outer edge', () => {
    const radius = CFG.outerR + 60;
    const small = damageFrom('coldRate', radius, 0);
    const large = damageFrom('coldRate', radius, 1);
    expect(large).toBeGreaterThan(0);
    expect(small).toBeGreaterThan(large);
  });

  it('does neither inside the habitable band', () => {
    const radius = (CFG.innerR + CFG.outerR) / 2;
    expect(damageFrom('heatRate', radius, 0.5)).toBe(0);
    expect(damageFrom('coldRate', radius, 0.5)).toBe(0);
  });

  it('kills outright inside the corona', () => {
    const world = bareWorld(3, QUIET);
    const o = place(world, gene({ size: 0.5 }), CFG.coronaR - 5, { energyFraction: 1 });
    world.step();
    expect(o.alive).toBe(false);
    expect(o.cause).toBe('burned');
    expect(world.stats.burned).toBe(1);
  });
});

describe('logistic plant regrowth', () => {
  const grownOver = (standing, ticks) => {
    const world = bareWorld(11, { founders: 0, hideSpots: 0, plagueEvery: 1e9, flareChance: 0 });
    while (world.food.length < standing) world.spawnFood();
    const before = world.food.length;
    for (let t = 0; t < ticks; t++) world.step();
    return world.food.length - before;
  };

  it('regrows fastest from a half-full world', () => {
    const ticks = 120;
    const nearEmpty = grownOver(10, ticks);
    const half = grownOver(Math.round(CFG.foodCap / 2), ticks);
    const nearFull = grownOver(Math.round(CFG.foodCap * 0.95), ticks);

    expect(half).toBeGreaterThan(nearEmpty * 3);
    expect(half).toBeGreaterThan(nearFull * 3);
  });

  it('still trickles in seeds when the standing crop is zero', () => {
    // foodRate is the only thing keeping an overgrazed world from staying dead.
    const world = bareWorld(11, { founders: 0, hideSpots: 0, plagueEvery: 1e9, flareChance: 0 });
    world.food = [];
    for (let t = 0; t < 400; t++) world.step();
    expect(world.food.length).toBeGreaterThan(0);
  });

  it('never runs past the cap', () => {
    const world = bareWorld(11, { founders: 0, hideSpots: 0, plagueEvery: 1e9, flareChance: 0 });
    for (let t = 0; t < 4000; t++) world.step();
    expect(world.food.length).toBeLessThanOrEqual(CFG.foodCap);
  });
});

describe('predation', () => {
  // A predator only attacks what it has already decided to hunt, so these
  // tests set `prey` directly and call fight() the way step() does.
  const attacker = (world, dietGene) => place(world,
    gene({ size: 0.9, aggression: 1, diet: dietGene, sense: 1 }), 250, { energy: 5 });
  const victim = (world) => place(world,
    gene({ size: 0.1, armor: 0 }), 250, { angle: 0.01, energyFraction: 1 });

  it('feeds the killer in proportion to how well it digests meat', () => {
    const meals = [0.7, 1].map(dietGene => {
      const world = bareWorld(5, QUIET);
      const att = attacker(world, dietGene);
      const def = victim(world);
      att.prey = def;
      const before = att.energy;
      world.fight(att, def);
      expect(def.alive).toBe(false);
      return { gain: att.energy - before + 0.4, eff: att.meatEff };   // 0.4 is the cost of the bite
    });

    const [weak, strong] = meals;
    expect(weak.gain).toBeGreaterThan(0);
    expect(strong.gain / weak.gain).toBeCloseTo(strong.eff / weak.eff, 6);
  });

  it('leaves no carrion behind — the predator ate it', () => {
    const world = bareWorld(5, QUIET);
    const att = attacker(world, 1);
    const def = victim(world);
    att.prey = def;
    world.fight(att, def);
    expect(def.cause).toBe('eaten');
    expect(world.food).toHaveLength(0);
    expect(world.stats.killed).toBe(1);
    expect(att.kills).toBe(1);
  });

  it('does leave carrion when something starves', () => {
    const world = bareWorld(5, QUIET);
    const o = place(world, gene({ size: 0.8 }), 250, { energy: 1 });
    world.kill(o, 'starved');
    expect(world.stats.starved).toBe(1);
    expect(world.food).toHaveLength(1);
    expect(world.food[0].kind).toBe('meat');
    expect(world.food[0].energy).toBeGreaterThan(0);
  });

  it('leaves no carrion when the star takes it', () => {
    const world = bareWorld(5, QUIET);
    world.kill(place(world, gene({ size: 0.8 }), 60, { energy: 20 }), 'burned');
    expect(world.food).toHaveLength(0);
  });

  it('will not bite something it did not decide to hunt', () => {
    const world = bareWorld(5, QUIET);
    const att = attacker(world, 1);
    const def = victim(world);
    const before = def.energy;
    world.fight(att, def);          // att.prey is null
    expect(def.energy).toBe(before);
    expect(def.alive).toBe(true);
  });

  it('bounces off armor thick enough to stop the bite', () => {
    const world = bareWorld(5, QUIET);
    const att = place(world, gene({ size: 0.2, aggression: 0.5, diet: 1 }), 250, { energy: 20 });
    const def = place(world, gene({ size: 0.2, armor: 1 }), 250, { angle: 0.01, energyFraction: 1 });
    att.prey = def;
    const before = def.energy;
    world.fight(att, def);
    expect(def.energy).toBe(before);
    expect(def.alive).toBe(true);
  });
});

describe('hiding spots', () => {
  const withOneHide = (seed = 2) => {
    const world = bareWorld(seed, { ...QUIET, hideSpots: 1 });
    world.hides.push({ x: 250, y: 0, vx: 0, vy: 0, r: 40 });
    return world;
  };

  it('makes an organism un-attackable', () => {
    const world = withOneHide();
    const att = place(world, gene({ size: 0.9, aggression: 1, diet: 1 }), 250, { energy: 5 });
    const def = place(world, gene({ size: 0.1 }), 250, { angle: 0.01, energyFraction: 1 });
    att.prey = def;
    def.hidden = true;
    const before = def.energy;
    world.fight(att, def);
    expect(def.energy).toBe(before);
    expect(def.alive).toBe(true);
  });

  it('stops it eating — nothing to eat in the dark', () => {
    const world = withOneHide();
    const o = place(world, gene({ diet: 0, size: 0.5 }), 250, { energyFraction: 0.5 });
    world.food.push(new Food(o.x, o.y, 0, 0, CFG.foodEnergy));
    world.step();
    expect(o.hidden).toBe(true);
    expect(world.food.filter(f => f.alive)).toHaveLength(1);
  });

  it('lets it eat again once it leaves', () => {
    const world = bareWorld(2, QUIET);         // same setup, no hiding spot
    const o = place(world, gene({ diet: 0, size: 0.5 }), 250, { energyFraction: 0.5 });
    world.food.push(new Food(o.x, o.y, 0, 0, CFG.foodEnergy));
    world.step();
    expect(o.hidden).toBe(false);
    expect(world.food.filter(f => f.alive)).toHaveLength(0);
  });

  it('still lets it mate', () => {
    const world = withOneHide();
    const g = gene({ size: 0.4, mateDrive: 0, hue: 0.5, marker1: 0.5, marker2: 0.5, diet: 0 });
    const a = place(world, g.slice(), 250, { energyFraction: 1 });
    const b = place(world, g.slice(), 250, { angle: 0.005, energyFraction: 1 });
    world.step();
    expect(a.hidden && b.hidden).toBe(true);
    expect(world.stats.born).toBe(1);
    expect(world.orgs.some(o => o.generation === 1)).toBe(true);
  });
});

describe('disease', () => {
  const pair = (immuneA, immuneB) => {
    const world = bareWorld(4, { ...QUIET, plagueSpread: 1 });
    const a = place(world, gene({ size: 0.4, immune: immuneA, hue: 0.2 }), 250, { energyFraction: 0.5 });
    const b = place(world, gene({ size: 0.4, immune: immuneB, hue: 0.9 }), 250, { angle: 0.005, energyFraction: 0.5 });
    a.infected = CFG.plagueLength;
    return { world, a, b };
  };

  it('crosses between similar immune types', () => {
    const { world, b } = pair(0.5, 0.5 + CFG.immuneMatch / 2);
    world.step();
    expect(b.infected).toBeGreaterThan(0);
    expect(world.stats.infections).toBe(1);
  });

  it('does not cross between dissimilar ones', () => {
    const { world, b } = pair(0.1, 0.9);
    world.step();
    expect(b.infected).toBe(0);
    expect(world.stats.infections).toBe(0);
  });

  it('does not reinfect the recovered', () => {
    const { world, b } = pair(0.5, 0.5);
    b.recovered = true;
    world.step();
    expect(b.infected).toBe(0);
  });

  it('drains energy while it runs and confers immunity when it clears', () => {
    const world = bareWorld(4, QUIET);
    const o = place(world, gene({ size: 0.4 }), 250, { energyFraction: 0.8 });
    o.infected = 3;
    const healthy = bareWorld(4, QUIET);
    const control = place(healthy, gene({ size: 0.4 }), 250, { energyFraction: 0.8 });

    world.step(); healthy.step();
    expect(control.energy - o.energy).toBeCloseTo(CFG.plagueDrain, 10);

    world.step(); world.step();
    expect(o.infected).toBe(0);
    expect(o.recovered).toBe(true);
  });
});

describe('encysting', () => {
  // r = 230 sits comfortably inside the band, and the circular velocity there
  // means the steering correction is zero, which is what "settled" means.
  const settler = (energyFraction, radius = 230, opts = {}) => {
    const world = bareWorld(6, QUIET);
    const o = place(world, gene({ size: 0.5, diet: 0, orbitRadius: 0.5 }), radius, { energyFraction, ...opts });
    world.step();
    return { world, o };
  };

  it('settles and encysts when starving inside the band on a circular orbit', () => {
    const { world, o } = settler(0.1);
    expect(o.alive).toBe(false);
    expect(o.cause).toBe('encysted');
    expect(world.cysts).toHaveLength(1);
    expect(world.stats.encysted).toBe(1);
    expect(world.food).toHaveLength(0);          // encysting is not dying; no carrion
  });

  it('will not encyst with energy above the cyst threshold', () => {
    const above = CFG.cystAt + 0.05;
    const { world, o } = settler(above);
    expect(o.settling).toBe(false);
    expect(world.cysts).toHaveLength(0);
    expect(o.alive).toBe(true);
  });

  it('will not encyst outside the band, however hungry it is', () => {
    for (const radius of [140, 320]) {
      const { world, o } = settler(0.1, radius);
      expect(o.settling, `r = ${radius}`).toBe(true);
      expect(world.cysts, `r = ${radius}`).toHaveLength(0);
    }
  });

  it('will not encyst until the orbit is actually circular', () => {
    const { world, o } = settler(0.1, 230, { still: true });
    expect(o.settling).toBe(true);
    expect(world.cysts).toHaveLength(0);
  });

  it('will not encyst on an empty tank', () => {
    const { world } = settler(0.02);
    expect(world.cysts).toHaveLength(0);
  });

  it('only ever encysts once — the free lunch is closed', () => {
    const world = bareWorld(6, QUIET);
    const o = place(world, gene({ size: 0.5, diet: 0, orbitRadius: 0.5 }), 230, { energyFraction: 0.1 });
    o.hasEncysted = true;
    world.step();
    expect(o.settling).toBe(false);
    expect(world.cysts).toHaveLength(0);
  });
});

describe('hatching', () => {
  const dormant = (world, { age, radius = 230, energyFraction = 0.5 }) => {
    const angle = 0;
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    const [vx, vy] = world.orbitalVelocity(x, y, 1);
    const o = new Organism(gene({ size: 0.5, diet: 0 }), x, y, vx, vy, 1e9);
    o.energy = o.maxEnergy * energyFraction;
    const c = new Cyst(o);
    c.age = age;
    world.cysts.push(c);
    return c;
  };
  const feed = (world, n) => {
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      world.food.push(new Food(Math.cos(a) * 240, Math.sin(a) * 240, 0, 0, CFG.foodEnergy));
    }
  };

  it('hatches inside the band once dormancy is served and there is food it can digest', () => {
    const world = bareWorld(8, QUIET);
    const c = dormant(world, { age: CFG.cystMinDormancy + 29 });   // ticks to 630: past dormancy, on the 30-tick check
    const stored = c.energy;
    feed(world, CFG.cystHatchFood);
    world.step();

    expect(world.stats.hatched).toBe(1);
    expect(world.cysts).toHaveLength(0);
    expect(world.orgs).toHaveLength(1);

    const hatchling = world.orgs[0];
    expect(hatchling.hasEncysted).toBe(true);
    expect(hatchling.age).toBeGreaterThanOrEqual(CFG.maturity);
    expect(hatchling.energy).toBeLessThanOrEqual(stored * CFG.cystHatchEnergy);
    expect(hatchling.energy).toBeGreaterThan(stored * CFG.cystHatchEnergy - 1);
  });

  it('stays shut until the minimum dormancy has passed', () => {
    const world = bareWorld(8, QUIET);
    dormant(world, { age: 299 });          // ticks to 300: on the check, but too young
    feed(world, CFG.cystHatchFood * 2);
    world.step();
    expect(world.stats.hatched).toBe(0);
    expect(world.cysts).toHaveLength(1);
  });

  it('stays shut when there is not enough it can digest', () => {
    const world = bareWorld(8, QUIET);
    dormant(world, { age: CFG.cystMinDormancy + 29 });
    feed(world, Math.floor(CFG.cystHatchFood / 3));
    world.step();
    expect(world.stats.hatched).toBe(0);
    expect(world.cysts).toHaveLength(1);
  });

  it('counts food by what that particular cyst can digest', () => {
    // A carnivore's cyst is unmoved by a meadow.
    const world = bareWorld(8, QUIET);
    const x = 230;
    const [vx, vy] = world.orbitalVelocity(x, 0, 1);
    const o = new Organism(gene({ size: 0.5, diet: 1 }), x, 0, vx, vy, 1e9);
    o.energy = o.maxEnergy * 0.5;
    const c = new Cyst(o);
    c.age = CFG.cystMinDormancy + 29;
    world.cysts.push(c);
    feed(world, CFG.cystHatchFood * 5);      // all plants
    world.step();
    expect(world.stats.hatched).toBe(0);
  });

  it('stays shut outside the band', () => {
    const world = bareWorld(8, QUIET);
    dormant(world, { age: CFG.cystMinDormancy + 29, radius: 400 });
    feed(world, CFG.cystHatchFood * 2);
    world.step();
    expect(world.stats.hatched).toBe(0);
    expect(world.cysts).toHaveLength(1);
  });

  it('gives up after the maximum dormancy', () => {
    const world = bareWorld(8, QUIET);
    dormant(world, { age: CFG.cystMaxAge });
    world.step();
    expect(world.cysts).toHaveLength(0);
    expect(world.stats.hatched).toBe(0);
  });
});

describe('budding', () => {
  const budAfter = 5;
  const lonely = () => {
    const world = bareWorld(9, { ...QUIET, budAfter, mutationRate: 0 });
    const o = place(world, gene({ size: 0.5, diet: 0, mateDrive: 0 }), 250, { energyFraction: 1 });
    return { world, o };
  };

  it('waits out the full mateless stretch first', () => {
    const { world } = lonely();
    for (let t = 0; t < budAfter - 1; t++) world.step();
    expect(world.stats.budded).toBe(0);
    expect(world.orgs).toHaveLength(1);

    world.step();
    expect(world.stats.budded).toBe(1);
    expect(world.stats.born).toBe(1);
    expect(world.orgs).toHaveLength(2);
  });

  it('pays the clone out of its own reserves', () => {
    const { world, o } = lonely();
    for (let t = 0; t < budAfter; t++) world.step();
    const child = world.orgs.find(x => x !== o);
    expect(child.generation).toBe(o.generation + 1);
    expect(child.energy / (child.energy + o.energy)).toBeCloseTo(CFG.budCost, 10);
    expect(o.mateTimer).toBe(world.cfg.mateCooldown);
    expect(o.offspring).toBe(1);
    expect(o.lonely).toBe(0);
  });

  it('does not bud while it is still on cooldown', () => {
    const { world, o } = lonely();
    o.mateTimer = 1000;
    for (let t = 0; t < budAfter * 3; t++) world.step();
    expect(world.stats.budded).toBe(0);
  });

  it('does not bud below its own mating threshold', () => {
    const { world } = lonely();
    world.orgs[0].energy = world.orgs[0].mateAt - 1;
    for (let t = 0; t < budAfter * 3; t++) world.step();
    expect(world.stats.budded).toBe(0);
  });
});

describe('trackSpecies', () => {
  // Only four genes count toward kinship, so two lineages have to differ on
  // more than one of them to clear the 0.12 threshold. Each triple below is
  // (hue, marker1, marker2); every pair sits 0.5 apart.
  const populate = (world, marks, perCluster) => {
    let i = 0;
    for (const [hue, marker1, marker2] of marks) {
      for (let k = 0; k < perCluster; k++) {
        place(world, gene({ size: 0.4, hue, marker1, marker2, diet: 0.1 }), 250,
          { angle: (i++) * 0.3, energyFraction: 0.6 });
      }
    }
  };
  const idsOf = world => world.orgs.map(o => o.species);
  const THREE = [[0, 0, 0], [1, 1, 0], [0, 1, 1]];
  const TWO = [[0, 0, 0], [1, 1, 0]];

  it('finds one cluster per lineage', () => {
    const world = bareWorld(10, QUIET);
    populate(world, THREE, 4);
    world.trackSpecies();
    expect(new Set(idsOf(world)).size).toBe(3);
    expect(world.speciesCount).toBe(3);
  });

  it('keeps every id stable across a pass that changed nothing', () => {
    const world = bareWorld(10, QUIET);
    populate(world, THREE, 4);
    world.trackSpecies();
    const first = idsOf(world);
    expect(new Set(first).size).toBe(3);
    for (let pass = 0; pass < 5; pass++) {
      world.trackSpecies();
      expect(idsOf(world)).toEqual(first);
    }
  });

  it('gives the new id to the splinter and leaves the name with the remnant', () => {
    // Clusters are resolved largest first, so the four that stayed put keep the
    // species id and the two that wandered off are the ones that get renamed.
    const world = bareWorld(10, QUIET);
    populate(world, TWO, 6);
    world.trackSpecies();

    const original = world.orgs[0].species;
    const before = new Set(idsOf(world));
    expect(before.size).toBe(2);

    const defectors = world.orgs.filter(o => o.species === original).slice(0, 2);
    for (const o of defectors) { o.g[G.marker2] = 1; o.refresh(); }

    world.trackSpecies();

    const moved = new Set(defectors.map(o => o.species));
    expect(moved.size).toBe(1);
    const newId = [...moved][0];
    expect(before.has(newId)).toBe(false);                        // genuinely new, not recycled
    expect(world.orgs.filter(o => o.species === original)).toHaveLength(4);
    expect(new Set(idsOf(world)).size).toBe(3);
    expect(world.species.find(sp => sp.id === newId).born).toBe(world.tick);
  });

  it('records a history point per pass and caps the buffer', () => {
    const world = bareWorld(10, QUIET);
    populate(world, TWO, 4);
    for (let pass = 0; pass < 400; pass++) { world.tick += 90; world.trackSpecies(); }
    expect(world.history).toHaveLength(360);
    expect(world.history.at(-1).tick).toBeGreaterThan(world.history[0].tick);
  });
});
