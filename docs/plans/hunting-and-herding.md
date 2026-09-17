# Plan: predators that hunt, prey that herd

Status: ready to execute. Written 2026-09-17 against commit `dee8ed7`.

The simulation is stable but two behaviours the ecology is supposed to produce
are not visible on the canvas: carnivores do not obviously *hunt*, and
herbivores do not obviously *herd*. This plan adds both with the smallest set of
mechanics that will read clearly to a person watching, without introducing any
kind of AI, planner, or neural network. Everything stays a weighted vector sum
of steering drives, scaled by existing genes, in `world.js`.

Read `docs/design.md` and `docs/development.md` first. The rest of this file
assumes you have.

## Why it is not visible today

Measured with a diagnostic on the current code (seeds 12 and 13, 30,000 ticks,
sampled every 5,000):

| Symptom | Evidence | Cause in code |
| --- | --- | --- |
| Herbivores form pairs and strings, not herds | Mean kin neighbours within 40 units: 1.4–4.4, with `kinDrive` already averaging 0.6–0.7 | Cohesion is a single pull toward the *nearest* relative. There is no pull toward the group, no alignment, and no spacing term, so the "herd" is a chain. |
| Herbivores never flee as a group | On seed 13, 44–98 of ~140 herbivores are "threatened" at any moment, each fleeing independently | Threat is per-organism, only within its own sense radius. Nothing propagates alarm to neighbours. |
| Predators wander rather than chase | Only 25–45% of hunters have a target at any moment; carnivore energy sits at 0.67–0.81 of capacity, straddling the 0.7 hunt cutoff | Target is re-chosen every tick (nearest wins, so it flickers), hunting switches on and off around a single threshold, and a predator aims at where prey *is*, never where it is going. |
| Prey panic at fed predators | Same seed 13 numbers | Threat detection does not check whether the predator is actually hunting. |
| No visible "guarding" | Herbivore `armor` averages 0.15–0.28 and does nothing positional | Armour only subtracts from bite damage; nothing puts armoured members between the threat and the soft ones. |

Reproduce: the diagnostic is short and worth keeping. It is folded into
`scripts/headless.mjs` in step 0 below.

## Non-goals

- No spatial hash, no pathfinding, no state machine bigger than a boolean and a
  timestamp. Perception stays O(n²); the population caps around 300 and that is fine.
- No new genes. Herding, fleeing, guarding and hunting are all scaled by genes
  that already exist: `kinDrive`, `fear`, `armor`, `aggression`, `sense`, `speed`.
- No new sliders. New constants go in `CFG` with comments.
- Do not tune to make a particular seed survive. Tune so the *sweep* looks
  healthy, then re-pin the ecology test seed if 12 no longer survives.

## The shape of the change

`step()` currently runs perception and steering in one pass per organism. It
becomes three passes so that an organism can react to what its neighbours
perceived this tick:

1. **Perceive.** For each organism: nearest food, nearest kin, nearest stranger,
   own threat, hunting state and prey target, plus a *herd* summary of relatives
   within `herdR` (count, centroid, mean velocity, separation vector, and the
   list of those neighbours).
2. **Propagate.** For each organism: if it has no threat of its own but a herd
   neighbour does, adopt that neighbour's threat (alarm). If it is hunting with
   no prey but a herd neighbour has prey, adopt that prey (pack).
3. **Steer.** The existing steering block, extended with cohesion, alignment,
   separation, group flight, guard positioning, and lead pursuit.

Pass 2 reads only fields written in pass 1, so it is order-independent. Pass 1
reads `p.herdN` on other organisms, which may be up to one tick stale; that is
acceptable and should be commented.

## Step 0: measure before touching anything

Add behaviour counters and columns so every later step can be checked headless.
Sonnet cannot watch the canvas; these numbers are the eyes.

**`world.js` stats:** add `hunts` (a predator acquires a target from none),
`huntsAbandoned` (a chase hits `huntGiveUp`), `alarms` (an organism adopts a
neighbour's threat), `guards` (an organism takes a guard position). Increment
them in the steps below.

**`scripts/headless.mjs`:** sample every 500 ticks and report, for the
single-seed view and as extra columns in the sweep:

- `herd`: mean number of kin within `cfg.herdR` per herbivore (diet < 0.33).
- `hunting`: fraction of hunters (`aggression > 0.45 && meatEff > 0.3`) that
  hold a prey target while `o.hunting` is true.
- `hunt%`: `stats.killed / stats.hunts`, the chase success rate.
- `carn`: carnivores alive at the end (already in the h/o/c column).

Until the mechanics land, `herd` should use radius 55 and `hunting` should read
`o.prey != null`, so step 0 produces a baseline table. Run
`node scripts/headless.mjs --seeds 1..24 --ticks 30000` and paste the table into
the PR description. It takes about 30 minutes; run it in the background.

Baseline from the current code, seeds 1–12 at 30,000 ticks, is in the appendix.

## Step 1: split perception from steering (behaviour-preserving)

Restructure the perception/steering loop into `perceive(o)`, `propagate(o)`,
and `steer(o)` passes without changing any number. Store on the organism:

```js
// Organism constructor additions
this.prey = null; this.threat = null; this.ownThreat = null;
this.hunting = false; this.huntSince = 0;
this.avoidId = 0; this.avoidUntil = 0;     // prey it recently gave up on
this.alarmed = false; this.guarding = false;
this.herdN = 0; this.herd = [];             // relatives within herdR, this tick
this.herdCx = 0; this.herdCy = 0; this.herdVx = 0; this.herdVy = 0;
this.sepX = 0; this.sepY = 0;
```

Do not add any random draws, and keep every existing draw in the same order.
**Check:** `npm test` and `npm run verify` must both pass at the end of this
step. This is the last commit where `verify` can pass; say so in the commit.

## Step 2: hunting

All in `perceive` and `steer`, plus `fight()`.

**Hysteresis.** Replace the single 0.7 satiation cutoff:

```js
const canHunt = g[G.aggression] > 0.45 && o.meatEff > 0.3;
if (!canHunt) o.hunting = false;
else if (o.hunting && o.energy > o.maxEnergy * cfg.huntStop) o.hunting = false;
else if (!o.hunting && o.energy < o.maxEnergy * cfg.huntStart) o.hunting = true;
```

**Target persistence.** Keep `o.prey` across ticks. Drop it when the prey is
dead, hidden, no longer on the size ladder, further than
`cfg.huntLeash × senseR`, or when `tick − huntSince > cfg.huntGiveUp`. A dropped
chase that was still in range sets `avoidId = prey.id`,
`avoidUntil = tick + cfg.huntRest`, and counts `huntsAbandoned`. While scanning,
score candidates and switch only if the best candidate scores below
`cfg.targetSwitch × currentScore`:

```js
score = d2 * (1 + cfg.armorAversion * p.g[G.armor]) * (p.herdN === 0 ? cfg.stragglerBias : 1)
```

That single line is "pick off the straggler": isolated prey score lower, so a
predator goes around the herd for the animal that wandered off. A predator that
acquires a target from none counts `stats.hunts++` and sets `huntSince`.

**Lead pursuit.** Replace `pull(prey, …)` with a pull toward where the prey will
be:

```js
const d = Math.hypot(prey.x - o.x, prey.y - o.y);
const t = Math.min(d / (o.maxSpeed * cfg.sprint), cfg.leadMax);
pull({ x: prey.x + prey.vx * t * cfg.lead, y: prey.y + prey.vy * t * cfg.lead }, o.meatEff * (0.5 + hungry * 1.4));
```

**Sprint** when `o.hunting && prey && preyd < 140²`. Drop the `hungry > 0.5`
clause; `hunting` already encodes hunger.

**Threat gating.** In `perceive`, a stranger is a threat only if `p.hunting`
(in addition to the existing size and aggression tests). Fed predators are
ignored. Rename the 80-unit flee radius to `cfg.alarmR`.

**Tests** (`test/world.test.js`, new `describe('hunting')`):
- starts hunting below `huntStart` and keeps hunting until above `huntStop`.
- keeps its target when a second prey appears only slightly closer, switches
  when one appears much closer.
- abandons a chase after `huntGiveUp` ticks and does not re-target the same
  prey until `huntRest` has passed.
- prefers an isolated prey over a herd member at equal distance (set `herdN`
  on the herd member by placing kin around it).
- a fed predator (`hunting === false`) is not a threat to prey in range.

## Step 3: herding

In `perceive`, while scanning relatives, accumulate for those within
`cfg.herdR`: count, sum of positions, sum of velocities, the neighbour list, and
a separation vector for any closer than `(o.r + p.r) × cfg.sepFactor`:

```js
sepX += (o.x - p.x) / d * (1 - d / sepR); sepY += ...
```

In `steer`, with `herdW = g[G.kinDrive] * 2 - 1` (−1 loner, +1 herd):

```js
if (o.herdN > 0) {
  pull({ x: o.herdCx, y: o.herdCy }, herdW * cfg.cohesion * (o.alarmed ? cfg.alarmCohesion : 1));
  if (herdW > 0) {                                  // alignment: match the herd's velocity
    const ax = o.herdVx - o.vx, ay = o.herdVy - o.vy, am = Math.hypot(ax, ay);
    if (am > 1e-3) { const k = Math.min(1, am / 0.3) * herdW * cfg.alignment; sx += ax / am * k; sy += ay / am * k; }
  }
  sx += o.sepX * cfg.separation; sy += o.sepY * cfg.separation;   // spacing, regardless of gene
} else {
  pull(nk, herdW * (o.energy > o.mateAt ? 1.4 : 0.8));            // alone: the existing regroup pull
}
```

The existing nearest-kin pull is kept only for organisms with no herd
neighbours. That is what brings a straggler back. Everything else about the
existing steering block (food, stranger, hide, orbit) stays.

Herds sharing a preferred orbit will graze one patch down and drift together to
the next. That is local overgrazing and it is wanted; do not add anything to
prevent it. Watch that it does not crash the food supply in the sweep.

**Tests** (new `describe('herding')`, `QUIET` config, `orbitHold` 0, no food):
- three relatives with `kinDrive = 1` placed 40 units apart draw closer over
  50 ticks; with `kinDrive = 0` they drift apart.
- two relatives placed overlapping are pushed apart by separation even with
  `kinDrive = 1`.
- a relative outside `herdR` but inside sense range is pulled toward the
  nearest kin (the regroup path).

## Step 4: group flight and guarding

**Alarm.** In `propagate`:

```js
o.alarmed = false;
if (!o.ownThreat) for (const p of o.herd) if (p.ownThreat) { o.threat = p.ownThreat; o.alarmed = true; this.stats.alarms++; break; }
```

One hop only. Do not chain alarms through `threat`; that is why `ownThreat`
is a separate field.

**Flight.** In `steer`, when `o.threat` is within `cfg.alarmR` of the organism
*or* of the herd centroid:

```js
const tdx = o.threat.x - o.herdCx, tdy = o.threat.y - o.herdCy, td = Math.hypot(tdx, tdy) || 1;
const guard = o.herdN >= cfg.guardMinHerd && g[G.armor] >= cfg.guardArmor;
o.guarding = guard;
if (guard) {
  // stand on the threatened flank of the herd, between the predator and the soft ones
  pull({ x: o.herdCx + tdx / td * cfg.herdR * 0.4, y: o.herdCy + tdy / td * cfg.herdR * 0.4 }, cfg.guardWeight);
  pull(o.threat, -g[G.fear] * 2.2 * 0.3);
  if (justStartedGuarding) this.stats.guards++;
} else {
  pull(o.threat, -g[G.fear] * 2.2);
  if (o.herdN > 0) pull({ x: o.herdCx - tdx / td * cfg.herdR * 0.4, y: o.herdCy - tdy / td * cfg.herdR * 0.4 }, cfg.shelterWeight);
}
```

Nothing else is needed for "the armoured protect the weak". The guard moves to
the threatened flank, the predator's straggler-and-armour scoring already
prefers soft targets, so it tries to go around, and when it does close on the
guard the existing `fight()` armour term makes the bite bounce. The soft members
run to the far side and the cohesion term keeps the herd together as it flees.
The `hideDrive` boost for a threatened organism stays and now also applies when
`o.alarmed`.

The orbit reflex (`hold = 1.6` near the corona and the rim) already stops a
fleeing herd from running into the star or off the edge. Do not add a second
guard for that.

**Tests** (new `describe('group flight')`):
- a relative that cannot see the predator (out of its own sense range) but is
  within `herdR` of one that can, ends the tick with `threat` set and
  `alarmed === true`, and its velocity has a component away from the predator.
- alarm does not chain: a third relative within `herdR` of the alarmed one but
  not of the one that saw the predator stays calm.
- with a predator east of a herd, a member with `armor = 0.9` ends up east of
  the centroid and a member with `armor = 0` ends up west of it, after ~40 ticks.
- an unarmoured member alone (no herd) flees directly away, `guarding === false`.

## Step 5: packs

In `propagate`, after the alarm block:

```js
if (o.hunting && !o.prey) for (const p of o.herd) if (p.prey && p.prey.alive) { o.prey = p.prey; o.huntSince = this.tick; this.stats.hunts++; break; }
```

Carnivores with `kinDrive > 0.5` already get cohesion from step 3; this line
makes them share a target. Whether packs evolve is left to selection. Carnivore
`kinDrive` currently drifts low (0.1–0.4 on seed 13) because they compete for
carrion; that is a legitimate result. If no seed ever shows a pack, note it in
the PR and move on.

**Test:** a hunting relative within `herdR` of one that has prey, and out of its
own sense range of that prey, ends the tick with the same `prey`.

## Step 6: make it legible on the canvas

`render.js`, keep it small:
- A hunting predator with a target draws a thin line from itself to its prey,
  `rgba(255,120,90,0.25)`, width 1. This is the single most useful cue.
- An alarmed or threatened prey gets a small amber arc, `rgba(255,200,90,0.6)`,
  at `rr + 3`, same style as the sprinting ring.
- A guarding organism's armour ring is drawn in white instead of the lineage
  tint.

`ui.js` inspector status line: append `· hunting #id` / `· resting after a
chase`, `· alarmed`, `· guarding`, and `· herd of n` where `n = herdN + 1`.

Add the two new cues to the `#hint` line in `public/index.html`: "a red line
is a hunt" and "an amber ring is alarm".

## Step 7: tune against the sweep

Initial constants for `config.js`. Put them under a `// herding and hunting`
comment block in the same style as the rest of the file.

| Key | Start | What it does |
| --- | --- | --- |
| `herdR` | 55 | Radius within which relatives count as the same herd. |
| `cohesion` | 1.2 | Pull toward the herd centroid, × bipolar `kinDrive`. |
| `alignment` | 0.6 | Velocity matching with the herd. |
| `separation` | 0.9 | Spacing push between close herd-mates. |
| `sepFactor` | 2.2 | Separation kicks in inside `(ra + rb) × sepFactor`. |
| `alarmR` | 90 | Flee when the threat is this close to you or your herd's centroid (was a hard-coded 80). |
| `alarmCohesion` | 2.0 | Cohesion multiplier while alarmed, so the herd flees as one. |
| `shelterWeight` | 0.8 | Soft members' pull to the far side of the herd. |
| `guardArmor` | 0.5 | Minimum armour to take a guard position. |
| `guardMinHerd` | 2 | Guarding needs at least this many herd-mates. |
| `guardWeight` | 1.6 | Guard's pull to the threatened flank. |
| `huntStart` | 0.6 | Start hunting below this fraction of capacity. |
| `huntStop` | 0.9 | Stop hunting above this fraction. |
| `huntGiveUp` | 350 | Ticks before a chase is abandoned. |
| `huntRest` | 400 | Ticks before the same prey is worth trying again. |
| `huntLeash` | 1.4 | Keep a target out to this × senseR. |
| `targetSwitch` | 0.6 | Switch targets only for a candidate scoring below this × current. |
| `armorAversion` | 2.0 | Score multiplier per unit of prey armour. |
| `stragglerBias` | 0.5 | Score multiplier for prey with no herd-mates. |
| `lead` | 0.8 | How far ahead of the prey the predator aims. |
| `leadMax` | 40 | Cap on lead time, ticks. |

Run `node scripts/headless.mjs --seeds 1..24 --ticks 30000` and compare with the
step 0 table. Targets, as means over the seeds that are alive at 30,000:

| Metric | Baseline | Target |
| --- | --- | --- |
| `herd` (kin within 55 per herbivore) | measure in step 0 | ≥ 2× baseline, and ≥ 5 |
| `hunting` (hunters holding a target) | 0.25–0.45 | ≥ 0.6 |
| `hunt%` (kills / hunts) | — | 0.10–0.60 |
| `stats.alarms`, `stats.guards` | 0 | > 0 on every seed with carnivores |
| extinct by 30,000 | 5 of 12 (appendix); 7 of 24 in design.md | no more than 2 seeds worse than the step 0 sweep |
| seeds with carnivores alive at 30,000 | 5 of 7 survivors (appendix) | not fewer than the step 0 sweep |

If chases never succeed, lower `lead` or raise `huntGiveUp`. If predators wipe
the herbivores, raise `huntStart` down toward 0.5 or lower `stragglerBias`
toward 1. If herds ball up into a stack, raise `separation`. If they never form,
raise `cohesion` before touching anything else. Change one constant at a time
and record what it did in the PR.

Predators have been dying out in the founder crash on many seeds (seed 12 has
zero carnivores from tick 5,000 to 25,000). Better hunting may fix that on its
own. If it does not, leave it; it is out of scope here.

## Step 8: tests, docs, CI

- `test/ecology.test.js`: add `hunts` and `alarms` to the "ran every mechanic"
  list. If seed 12 no longer survives, pick the lowest-numbered seed from the
  sweep that ends alive with all three diets present, and update the seed,
  its comment, the table in `docs/development.md`, and the founder-crash
  paragraph in `docs/design.md`.
- `docs/design.md`: new sections "Herding" and "Group flight and guarding"
  after "Hiding spots"; rewrite "Predation" for hysteresis, persistence, lead
  pursuit and straggler scoring; add the new keys to the tuning-levers table;
  update the contact-order diagram (perceive / propagate / steer).
- `docs/notes.md`: remove the entry saying `nearKin` is never read. Add an
  entry that `herdN` read on another organism may be one tick stale.
- `docs/development.md` and `.github/workflows/test.yml`: the faithfulness
  check is retired. Tag the step 1 commit `faithful-to-original`, delete the CI
  step, and replace the "Verifying a change to the core" section with two
  sentences saying the check holds only up to that tag and why. Keep
  `scripts/verify-faithful.mjs` and `scripts/original.html`.
- `README.md`: one sentence in the description paragraph, if it lists
  behaviours.

## Commits

One commit per step, in order. Step 1's message says it is the last
verify-faithful commit. Step 2's message says the ecology is deliberately
changed and the check is retired. Run `npm test` before every commit; run the
24-seed sweep before the step 7 commit and paste its table into that message.

## Appendix: baseline sweep, current code

Seeds 1–12, 30,000 ticks, `node scripts/headless.mjs --seeds 1..12 --ticks 30000`:

```
30,000 ticks per seed

  seed   pop  peak  cysts   h/o/c        gen  species  born  killed  starved  extinct at
     1    99   121      8      99/0/0     23        1   943     125       23           —
     2   104   187     18     82/2/20     42        3  1631     815      222           —
     3   157   195     17     153/1/3     32        2  1154     101      360           —
     4   163   202     14     163/0/0     37        1  1642     125      372           —
     5     0   117      0       0/0/0      0        0    70     101        0       12334
     6     0   120      0       0/0/0      0        0    43     105        1       13162
     7   148   292     31    128/0/20     36        2  2904     712      924           —
     8     0   119      0       0/0/0      0        0    32     123        8       11505
     9     0   119      0       0/0/0      0        0    22      90        5       12070
    10     0   120      0       0/0/0      0        0    25     103        3       12381
    11   158   249     24     147/4/7     33        3  2235     100      870           —
    12   182   242     51    161/4/17     44        4  2745     164     1016           —
```

Five of twelve extinct, all between ticks 11,500 and 13,200. Of the seven
survivors, five still have carnivores at 30,000 (seeds 2, 3, 7, 11, 12) and two
(1, 4) are pure herbivore worlds where nothing hunts at all.
