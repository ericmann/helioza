// The genome layout and every tuned constant in the simulation. The numbers
// here were settled by running the thing headless and watching what died; they
// are load-bearing, not decorative.

export const GENES = [
  // name, bipolar?, description
  ['size',        false, 'radius, energy capacity, metabolic cost'],
  ['speed',       false, 'max thrust; thrust costs energy'],
  ['sense',       false, 'perception radius; costs upkeep'],
  ['aggression',  false, 'attack strength; below 0.45 never attacks; costs upkeep'],
  ['armor',       false, 'damage reduction; costs upkeep'],
  ['hue',         false, 'color only — drifts freely, marks lineages'],
  ['foodDrive',   false, 'pull toward nearest food'],
  ['kinDrive',    true,  'toward (+) or away from (−) relatives'],
  ['strangerDrive', true, 'toward (+) or away from (−) non-relatives'],
  ['orbitRadius', false, 'preferred distance from the star'],
  ['orbitHold',   false, 'how hard it holds that radius'],
  ['mateDrive',   false, 'energy level at which it breeds'],
  ['hideDrive',   false, 'pull toward a hiding spot when fed or threatened; hidden organisms are safe and can mate, but cannot eat'],
  ['marker1',     false, 'neutral recognition marker — kin is judged on hue, markers, and diet'],
  ['marker2',     false, 'neutral recognition marker'],
  ['diet',        false, '0 = herbivore, 1 = carnivore; an omnivore digests both poorly'],
  ['kinTolerance', false, 'low = will eat relatives when starving'],
  ['fear',        false, 'flees larger predators'],
  ['immune',      false, 'immune type; disease spreads between similar types'],
];

export const G = Object.fromEntries(GENES.map((g, i) => [g[0], i]));

export const CFG = {
  worldR: 470,
  coronaR: 38,          // instant death
  innerR: 130,          // heat damage inside this
  outerR: 330,          // cold damage outside this
  gravity: 170,         // a = gravity / r^2, capped (orbital speed ≈0.9 mid-band)
  gravityCap: 0.04,
  drag: 0.0003,
  maxSpeed: 1.8,
  hideSpots: 7,
  hideMetabolism: 0.5,  // metabolic multiplier while hidden
  heatRate: 0.9, coldRate: 0.5,

  foodRate: 0.05,       // baseline plant spawn (seeds blown in), per tick
  plantGrowth: 0.006,  // logistic regrowth: spawn += growth * n * (1 - n / foodCap)
  foodEnergy: 28,
  foodCap: 420,
  preyRatio: 1.1,       // will attack anything up to this fraction of own radius; damage falls off steeply against bigger prey
  sprint: 1.5,          // thrust and speed multiplier while chasing prey (costs double)
  killYield: 0.8,       // fraction of victim energy transferred to killer

  plagueEvery: 5000,    // ticks between plague seeds
  plagueLength: 900,
  plagueDrain: 0.05,
  plagueSpread: 0.12,   // per contact-tick chance, if immune types are similar
  immuneMatch: 0.12,

  solarPeriod: 14000,   // luminosity cycle length
  solarAmplitude: 0.22,
  flareChance: 1 / 9000, flareLength: 350, flareBoost: 0.45,

  founders: 10,         // initial lineages
  familySize: 12,       // organisms per founding lineage
  immigration: false,   // god-mode: airlift a new family when the population collapses
  minPop: 12,
  immigrants: 8,        // one new lineage of this size arrives when population collapses

  cystAt: 0.22,         // energy fraction below which an organism settles into orbit to encyst
  cystMinDormancy: 600,
  cystMaxAge: 9000,
  cystHatchFood: 30,    // effective food (plants×plantEff + meat×meatEff) needed to hatch
  cystHatchEnergy: 0.85,    // fraction of stored energy kept through dormancy

  dietAssimilation: 0.35,   // Baldwin effect: offspring diet drifts toward what the parent actually ate
  founderSigma: 0.05,   // gene spread within a founding family

  mutationRate: 0.25,   // per-gene chance of mutating on reproduction
  mutationSigma: 0.08,
  bigMutation: 0.02,    // chance a mutation is a full re-roll
  kinThreshold: 0.12,   // mean |diff| over KIN_GENES below which two are relatives
  mateCost: 0.30,       // fraction of each parent's energy paid to child
  mateCooldown: 260,
  budAfter: 700,        // ticks eligible-but-mateless before an organism buds asexually
  budCost: 0.45,        // fraction of energy given to a budded clone
  maturity: 220,

  baseMetabolism: 0.014,
  maxAgeMin: 2600, maxAgeMax: 5200,
};
