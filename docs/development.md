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

Five files, 98 tests:

| File | Environment | What it covers |
| --- | --- | --- |
| `test/genome.test.js` | node | Crossover, mutation bounds, the big-mutation rate, diet assimilation, kin distance. |
| `test/organism.test.js` | node | Every derived trait, checked against the direction its comment claims. |
| `test/world.test.js` | node | Orbits, temperature damage, plant regrowth, predation, hunting, herding, group flight, packs, hiding, disease, encysting, hatching, budding, speciation. |
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
  seed   pop  peak  cysts   h/o/c        gen  species  born  killed  starved   herd  hunt%  hold  alarms guards  extinct at
    11   142   208     49    127/1/14     29        2  1652     497      400   1.69   10%   14%   57375   1573           —
    12   127   263     33     126/0/1     35        2  2152     123      776   1.17   11%    0%   12308    385           —
    13     0   165      0       0/0/0      0        0   860     480      156   0.00   17%    0%   64938   1104       29320
```

Expect roughly a third of seeds to be extinct, most of them the classic way in
the first food crash around tick 12,000, but not always: seed 13 above makes it
to tick 29,320, most of the way to the end, before a late-game predation
collapse takes the whole population down instead. Both are the founder crash
and its consequences, not a bug — see [design.md](design.md). `herd` is the
mean number of kin within `herdR` per herbivore; `hunt%` is kills divided by
hunts started; `hold` is the fraction of hunters holding a target at the end of the
run.

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

**This check only holds up to the commit tagged `faithful-to-original`.** The
hunting and herding work built on top of it (persistent hunt targets, herd
cohesion, alarm propagation, guarding) is a deliberate change to the ecology,
not a refactor, and `npm run verify` fails past that point by design — see
"Why `huntStop` sits at 75%, not 90%" and the "`perceive → propagate → steer`"
section in [design.md](design.md) for what changed and why. The CI step that
ran it on every push was removed at the same commit. `scripts/verify-faithful.mjs`
and `scripts/original.html` stay in the repository; run the check by hand
against `faithful-to-original` if you need to confirm the refactor itself was
sound.

For a future change to `config.js`, `rng.js`, `genome.js`, `organism.js` or
`world.js` that is meant to be behaviour-preserving, the same principle still
applies: run `npm run verify` against the last commit where it passed, and if
it fails, either the change is wrong or it is a deliberate alteration — say so
in the commit rather than quietly loosening the check.

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

## Repository metadata

Kept here so it is reproducible rather than a thing someone once clicked.

```
gh repo edit \
  --description "Artificial life in orbit around a star: evolving genomes, predators, plagues, and cysts. Zero-dependency browser sandbox." \
  --homepage "https://helioza.eamann.com" \
  --add-topic artificial-life --add-topic evolution --add-topic simulation \
  --add-topic genetic-algorithm --add-topic canvas --add-topic javascript \
  --add-topic es-modules --add-topic cloudflare-pages --add-topic idle-game
```
