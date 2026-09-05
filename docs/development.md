# Development

There is no build step. The site in `public/` is native ES modules served as
static files; the dev dependencies are a test runner and a fake DOM, and nothing
else.

## Setup

```
npm install
```

Node 22 LTS or newer. `.node-version` and the `engines` field both pin it.

## Running it

Any static server pointed at `public/` will do.

```
npx serve public
python3 -m http.server 8000 --directory public
```

Opening `public/index.html` as a `file://` URL will *not* work — browsers refuse
to load ES modules over that scheme. Use a server.

Append `?seed=12345` to the URL to replay an exact run. Without it the generator
is seeded from the clock. The running world is on `window.helioza` if you want
to poke at it from the console:

```js
helioza.seed                      // what this run was seeded with
helioza.world.orgs.length
helioza.world.stats
helioza.view.selected             // whatever you last clicked
helioza.CFG.mutationRate = 0.6    // the sliders write here too
```

## Tests

```
npm test           # vitest run, ~95 seconds
npm run test:watch
```

Five files, 87 tests:

| File | Environment | What it covers |
| --- | --- | --- |
| `test/genome.test.js` | node | Crossover, mutation bounds, the big-mutation rate, diet assimilation, kin distance. |
| `test/organism.test.js` | node | Every derived trait, checked against the direction its comment claims. |
| `test/world.test.js` | node | Orbits, temperature damage, plant regrowth, predation, hiding, disease, encysting, hatching, budding, speciation. |
| `test/ecology.test.js` | node | 30,000 ticks from seed 12, asserting the run stays sane and stays alive. |
| `test/ui.test.js` | jsdom | The page boots, counters update, clicks select, sliders write through. |

Everything is seeded, so a failure is reproducible. The world tests each build
exactly the state they need through `test/helpers.js` and step the real
`World.step()`; they switch off unrelated mechanics through config overrides
rather than reimplementing any formula. Heat and cold damage, for instance, are
isolated by running identical state twice with the rate zeroed and taking the
difference.

The ecology test dominates the runtime. It is the one worth keeping.

## The headless harness

`scripts/headless.mjs` runs the ecology with no browser attached and reports
what happened. Useful for tuning, and for finding out whether a change to the
core moved anything.

```
node scripts/headless.mjs
node scripts/headless.mjs --seed 12 --ticks 50000
node scripts/headless.mjs --seeds 1..40 --ticks 30000
node scripts/headless.mjs --seed 12 --ticks 30000 --quiet
```

A single seed prints a full breakdown — diets, cysts, generations, every death
counter, and the last few log events. A range prints one row per seed, which is
how the pinned test seed was chosen:

```
  seed   pop  peak  cysts   h/o/c        gen  species  born  killed  starved  extinct at
    11   158   249     24     147/4/7     33        3  2235     100      870           —
    12   182   242     51    161/4/17     44        4  2745     164     1016           —
    13    60   258     18     36/0/24     44        3  2116     979      342           —
```

Expect roughly a third of seeds to be extinct by tick 13,000. That is the
founder crash, not a bug — see [design.md](design.md).

## Verifying a change to the core

`scripts/original.html` is the untouched single-file version this project was
refactored from, and `scripts/verify-faithful.mjs` holds the module graph to it.
It loads the original into a `node:vm` sandbox with `Math.random` monkeypatched
to the same seeded generator the modules use, then steps both worlds in lockstep
and compares population, food, plant and carrion counts, cyst count, infected
count, diet split, total energy, luminosity, flare state, species count and
every stat, after every single tick.

```
npm run verify
node scripts/verify-faithful.mjs --ticks 50000 --seeds 1,12,4242
node scripts/verify-faithful.mjs --self        # check the harness itself
```

`--self` runs the original against itself: same seed must match, different seeds
must diverge. Run it when you suspect the comparison has stopped comparing
anything.

Run `npm run verify` after any change to `config.js`, `rng.js`, `genome.js`,
`organism.js` or `world.js`. If it fails, either the change altered behaviour —
which for a refactor means it is wrong — or the change was a deliberate
alteration to the ecology, in which case the honest move is to say so in the
commit and retire the check for that mechanic rather than quietly loosening it.

The order and count of calls into `rng.js` is what makes this work. Adding,
removing or reordering a random draw in the simulation will shift the entire
stream and fail every seed at tick one, even if the mechanic is unchanged.

## Layout

```
public/
  index.html          markup only
  css/style.css
  js/
    config.js         CFG and GENES
    rng.js            seedable PRNG
    genome.js         crossover, mutation, kinship
    organism.js       Organism, Cyst, Food
    world.js          the simulation
    render.js         canvas drawing
    chart.js          the species chart
    ui.js             sidebar and input
    main.js           wiring and the animation loop
test/
scripts/
  original.html       the file this was refactored from
  verify-faithful.mjs
  headless.mjs
docs/
```

The five simulation modules have no DOM references and never import from
`render.js`, `chart.js` or `ui.js`. That is what lets `world.js` be imported
straight into node, and it is worth preserving.
