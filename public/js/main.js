// Entry point: build a world, size the canvas to it, and run the loop.
//
// Append ?seed=12345 to the URL to replay an exact run. Without it the stream
// is seeded from the clock, which is the old Math.random behaviour in spirit.

import { CFG } from './config.js';
import { setSeed, getSeed } from './rng.js';
import { World } from './world.js';
import { drawWorld } from './render.js';
import { bindControls, updatePanel } from './ui.js';

const requested = new URLSearchParams(location.search).get('seed');
if (requested !== null && requested !== '' && Number.isFinite(Number(requested))) setSeed(Number(requested));

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const world = new World(CFG);

// Everything the renderer and the click handler need to agree on.
const view = { w: 0, h: 0, dpr: 1, scale: 1, cx: 0, cy: 0, selected: null, paused: false, speed: 0.5 };

function resize() {
  view.dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * view.dpr; canvas.height = h * view.dpr;
  view.w = w; view.h = h;
  view.scale = Math.min(w, h) / (2 * (CFG.worldR + 20));
  view.cx = w / 2; view.cy = h / 2;
}
window.addEventListener('resize', resize);
resize();

bindControls(world, view, canvas);

let acc = 0, frame = 0;
function loop() {
  if (!view.paused) { acc += view.speed; while (acc >= 1) { world.step(); acc -= 1; } }
  drawWorld(ctx, world, view);
  if (++frame % 10 === 0) updatePanel(world, view);
  requestAnimationFrame(loop);
}
updatePanel(world, view);
loop();

// Handy from the console when something interesting happens and you want it back.
globalThis.helioza = { world, view, CFG, seed: getSeed() };
