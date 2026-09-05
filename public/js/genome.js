// Genomes: how they are made, compared, and mixed.
//
// A genome is a flat array of 19 floats in [0, 1], one per entry in GENES.
// Kinship is judged on a subset — hue, two neutral markers, and diet — so two
// lineages that specialise on different foods stop recognising each other and
// stop interbreeding. Speciation falls out of the diet gene for free.

import { GENES, G } from './config.js';
import { random, gauss } from './rng.js';

export const KIN_GENES = ['hue', 'marker1', 'marker2', 'diet'];   // diverging diets stop interbreeding
export const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;

export function randomGenome() { return GENES.map(() => random()); }

export function geneDistance(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length;
}

export const KIN_IDX = KIN_GENES.map(n => G[n]);
export function kinDistance(a, b) {
  let d = 0;
  for (const i of KIN_IDX) d += Math.abs(a[i] - b[i]);
  return d / KIN_IDX.length;
}

export function breed(a, b, cfg, realizedDiet) {
  const child = a.map((ga, i) => (random() < 0.5 ? ga : b[i]));
  for (let i = 0; i < child.length; i++) {
    if (random() < cfg.mutationRate) {
      child[i] = random() < cfg.bigMutation ? random() : clamp01(child[i] + gauss() * cfg.mutationSigma);
    }
  }
  // genetic assimilation: the diet gene drifts toward the parents' realized diet
  if (realizedDiet !== undefined && realizedDiet !== null) {
    child[G.diet] = clamp01(child[G.diet] + cfg.dietAssimilation * (realizedDiet - child[G.diet]) * random());
  }
  return child;
}
