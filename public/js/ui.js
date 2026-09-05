// Sidebar, inspector, sliders, and the canvas click handling. Everything that
// touches the DOM and nothing that touches the simulation's internals.
//
// The mutable bits of view state — paused, speed, selected — live in the `view`
// object owned by main.js, so the render loop and these handlers agree without
// either of them owning a global.

import { CFG, G, GENES } from './config.js';
import { drawChart } from './chart.js';
import { screenToWorld } from './render.js';

export const $ = id => document.getElementById(id);
export const fmt = (v, bipolar) => bipolar ? ((v * 2 - 1) >= 0 ? '+' : '') + (v * 2 - 1).toFixed(2) : v.toFixed(2);

export function traitRows(genome, hue) {
  return GENES.map((g, i) => {
    const v = genome[i], bip = g[1];
    const width = bip ? Math.abs(v - 0.5) * 100 : v * 100;
    const left = bip ? (v >= 0.5 ? 50 : v * 100) : 0;
    const color = g[0] === 'hue' ? `hsl(${Math.round(v * 360)},70%,55%)` : (hue != null ? `hsl(${hue},40%,60%)` : 'var(--ink-dim)');
    return `<div class="trait ${bip ? 'bipolar' : ''}" title="${g[2]}"><span>${g[0]}</span><div class="bar"><i style="width:${width}%;margin-left:${left}%;background:${color}"></i></div><span class="val">${fmt(v, bip)}</span></div>`;
  }).join('');
}

let chartEl = null, cctx = null;

export function updatePanel(world, view) {
  const s = world.stats;
  const selected = view.selected;
  if (!cctx) { chartEl = $('chart'); cctx = chartEl.getContext('2d'); }
  drawChart(cctx, world, chartEl.width, chartEl.height);
  const live = world.species.filter(sp => sp.alive && sp.count >= 2).sort((a, b) => b.count - a.count).slice(0, 5);
  const total = world.orgs.length || 1;
  $('speciesList').innerHTML = live.map(sp => `<div><span class="swatch" style="background:hsl(${sp.hue},70%,55%)"></span>species ${sp.id} — ${sp.count} (${Math.round(sp.count / total * 100)}%), since ${sp.born.toLocaleString()}</div>`).join('');
  $('sAlive').textContent = world.orgs.length;
  { let h = 0, om = 0, c = 0; for (const o of world.orgs) { const d = o.g[G.diet]; if (d < 0.33) h++; else if (d < 0.67) om++; else c++; }
    $('sDiet').textContent = `${h} / ${om} / ${c}`; }
  $('sSick').textContent = world.orgs.filter(o => o.infected > 0).length;
  $('sCysts').textContent = world.cysts.length;
  $('sLum').textContent = Math.round(world.luminosity * 100) + '%' + (world.flare > 0 ? ' (flare)' : '');
  $('sSpecies').textContent = world.speciesCount;
  { let p = 0; for (const f of world.food) if (f.kind === 'plant') p++; $('sFood').textContent = `${p} / ${world.food.length - p}`; }
  $('sBorn').textContent = s.born; $('sBud').textContent = s.budded; $('sStarve').textContent = s.starved; $('sBurn').textContent = s.burned;
  $('sFreeze').textContent = s.froze; $('sKilled').textContent = s.killed; $('sAge').textContent = s.oldAge;
  $('sTick').textContent = world.tick.toLocaleString();
  $('avgGenes').innerHTML = traitRows(world.averageGenome());
  $('log').innerHTML = world.events.map(e => `<div>${e}</div>`).join('') || '<div>Nothing yet.</div>';
  const body = $('inspectBody');
  if (selected) {
    const o = selected;
    body.className = '';
    const dietName = o.g[G.diet] < 0.33 ? 'herbivore' : o.g[G.diet] < 0.67 ? 'omnivore' : 'carnivore';
    const status = o.alive ? `${dietName} · energy ${o.energy.toFixed(0)} / ${o.maxEnergy.toFixed(0)} · age ${o.age} of ${o.maxAge.toFixed(0)}${o.infected > 0 ? ' · sick' : ''}${o.settling ? ' · settling to encyst' : ''}${o.hasEncysted ? ' · hatched from a cyst' : ''}` : `${o.cause === 'encysted' ? 'encysted — dormant' : 'died: ' + o.cause}`;
    body.innerHTML = `<div style="margin-bottom:8px"><span class="swatch" style="background:hsl(${o.hue},70%,55%)"></span><b>#${o.id}</b> generation ${o.generation}, species ${o.species || '?'}${o.hidden ? ', hiding' : ''}<br><span style="color:var(--ink-dim);font-size:12px">${status}<br>${o.kills} kills · ${o.offspring} offspring · orbit ${o.dist.toFixed(0)} (prefers ${o.prefR.toFixed(0)})</span></div>` + traitRows(o.g, o.hue);
  } else if (body.className !== 'empty') {
    body.className = 'empty'; body.textContent = 'Nothing selected. Click an organism on the canvas to follow it and read its genome.';
  }
}

/** Wire the buttons, sliders, and canvas. Returns nothing; mutates `view`. */
export function bindControls(world, view, canvas) {
  canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const [wx, wy] = screenToWorld(view, e.clientX - rect.left, e.clientY - rect.top);
    let best = null, bd = 12 / view.scale;
    for (const o of world.orgs) { const d = Math.hypot(o.x - wx, o.y - wy) - o.r; if (d < bd) { bd = d; best = o; } }
    if (e.shiftKey) { if (best) { world.kill(best, 'smitten'); world.log(`#${best.id} smitten by the finger of death`); if (view.selected === best) view.selected = null; } }
    else if (best) view.selected = best;
    else world.spawnFood(wx, wy);
    updatePanel(world, view);
  });

  $('btnPause').addEventListener('click', () => { view.paused = !view.paused; $('btnPause').textContent = view.paused ? 'Resume' : 'Pause'; $('btnPause').classList.toggle('on', view.paused); });
  document.querySelectorAll('.speed').forEach(b => b.addEventListener('click', () => { view.speed = +b.dataset.s; document.querySelectorAll('.speed').forEach(x => x.classList.toggle('on', x === b)); }));
  $('btnReset').addEventListener('click', () => { world.reset(); view.selected = null; updatePanel(world, view); });

  bindSlider('inFood', 'vFood', 'foodRate', v => v.toFixed(2) + ' / tick');
  bindSlider('inMut', 'vMut', 'mutationRate', v => Math.round(v * 100) + '% per gene');
  bindSlider('inMate', 'vMate', 'mateCost', v => Math.round(v * 100) + '% of energy');
  bindSlider('inDrag', 'vDrag', 'drag', v => v.toFixed(4));
  bindSlider('inAssim', 'vAssim', 'dietAssimilation', v => Math.round(v * 100) + '%');
  $('inImm').checked = CFG.immigration; $('inImm').addEventListener('change', () => { CFG.immigration = $('inImm').checked; });
}

export function bindSlider(id, valId, key, fmtFn) {
  const el = $(id); el.value = CFG[key]; $(valId).textContent = fmtFn(CFG[key]);
  el.addEventListener('input', () => { CFG[key] = +el.value; $(valId).textContent = fmtFn(CFG[key]); });
}
