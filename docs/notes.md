# Notes

Things noticed while splitting the original single file into modules. None of
them were acted on: the refactor was behaviour-preserving, and every number in
`config.js` was tuned by running the thing and watching what died. Changing any
of this would invalidate the tuning, and `scripts/verify-faithful.mjs` would
rightly fail.

Each entry says what is happening, and whether it looks like a bug or just a
consequence nobody has needed to care about.

## Suspected bugs

**A predator can end a tick overdrawn.** `fight()` charges the attacker `0.4`
for the bite, and the contact phase runs *after* the environment phase where
`energy <= 0` kills things. So an attacker that bites at low energy finishes the
tick alive on negative energy. It cannot survive the next one — the steering
loop only ever subtracts, so the next sweep kills it — but the sidebar and the
inspector can both show a live organism at a negative number for one frame.
`test/ecology.test.js` asserts the invariant that actually holds rather than the
one you would expect.

**`this.extinct` survives a restart.** `reset()` rebuilds every other field but
never clears `extinct`. Restart a dead world and the "life is extinct" message
will not fire again until something re-populates and dies a second time. The
flag is only used to avoid repeating that one log line, so nothing else moves.

**Dead attackers still shove.** The contact loop checks `a.alive` once, at the
top of the outer iteration. If `a` is killed inside the combat inner loop, the
soft-collision loop underneath still runs for it and pushes the living around.
The corpse is filtered out at the end of the tick, so the only effect is a
one-tick nudge from something that just died.

**The food cap counts corpses.** `spawnFood()` bails when
`this.food.length >= foodCap`, but `this.food` still holds items marked
`alive = false` until the end-of-tick filter. On a tick where a lot of food was
just eaten, the cap reads high and blocks spawns that the logistic curve asked
for. The effect is small and it only ever suppresses growth, never runs away.

**Species colours drift.** `trackSpecies()` recomputes `sp.hue` from the cluster
centroid on every pass, so a lineage whose mean hue wanders slowly changes
colour in the chart and the species list while keeping its id. The identity is
stable; the swatch is not.

**Dominance is sticky between 40% and 60%.** A species is flagged dominant above
60% and cleared below 40%. In between it keeps whatever it had, which is
deliberate hysteresis for the log line but reads oddly if you go looking for the
flag.

## Not bugs, just surprising

**`Organism` reads the module-level `CFG`, not its world's `cfg`.** `maxAge`,
`maxSpeed` and `prefR` all come from the imported config object rather than from
`world.cfg`. In the browser those are the same object — the sliders write
straight into `CFG` — so it makes no difference there. It does mean a `World`
constructed with a private config copy will still get its organisms' lifespans
and preferred orbits from the global one. The tests work around this by
overriding only the config keys `World` itself reads.

**"Mateless ticks" means "eligible-but-mateless ticks".** The `lonely` counter
that drives budding is reset whenever an organism is immature, on cooldown, or
below its own mating threshold. A herbivore that keeps dipping under
`mateAt` never accumulates enough lonely ticks to bud, however long it goes
without meeting a relative. This is almost certainly the intent — budding is for
the genuinely isolated, not the merely poor — but the name suggests otherwise.

**`geneDistance` is dead code.** Exported from `genome.js` and used nowhere.
Kinship runs entirely on `kinDistance` over the four kin genes. It was in the
original's `module.exports`, so it stays.

**`o.nearKin` and `o.nearStranger` are written and never read.** The perception
loop stores both on the organism alongside `prey` and `threat`, which *are* read
by `fight()` and the renderer. The two kin fields are leftovers.

**`stats.immigrants` counts airlifts, not immigrants.** It increments once per
rescue event, each of which brings `CFG.immigrants` organisms.

**Cyst hatching reads the food count from the top of the tick.** `plantCount`
and `meatCount` are taken before the food physics and rot pass, so a cyst
decides whether the world is worth waking up for using last tick's larder. Off
by at most one tick's worth of rot.

**One founding family in four is a carnivore.** `spawnFamily` picks its kind
from `familiesSpawned % 4`, and only kind `0` gets the carnivore treatment. The
immigration rescue path shares that counter, so which flavour of family gets
airlifted depends on how many have been spawned before it.

## Ideas deliberately not acted on

- The perception loop is O(n²) over organisms and O(n·m) over food, run twice
  per tick. A spatial hash would make 16× speed comfortable at high population.
  It would also change the iteration order, and therefore the sequence of random
  draws, and therefore every seeded run. Not worth it for a sandbox.
- There is no way to save or load a world. With `rng.js` in place, a seed plus a
  tick count is a complete description of a run, so `?seed=` gets most of the
  way there already.
- The chart's history buffer holds 360 points at one point per 90 ticks, which
  is a little over 32,000 ticks of memory. Long runs quietly forget their early
  history. That is a display choice, not a simulation one.
