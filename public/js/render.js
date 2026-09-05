// Canvas drawing. A pure function of the world plus the current view: nothing
// here mutates the simulation, reads the DOM, or keeps state between frames.
//
//   view = { w, h, dpr, scale, cx, cy, selected }
//
// where (cx, cy) is the star's position on screen and `scale` converts world
// units to pixels.

import { CFG, G } from './config.js';

export const worldToScreen = (view, x, y) => [view.cx + x * view.scale, view.cy + y * view.scale];
export const screenToWorld = (view, px, py) => [(px - view.cx) / view.scale, (py - view.cy) / view.scale];

export function drawWorld(ctx, world, view) {
  const { w, h, dpr, scale, cx, cy, selected } = view;
  const toScreen = (x, y) => [cx + x * scale, cy + y * scale];
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#050813'; ctx.fillRect(0, 0, w, h);

  // habitable band
  const inR = world.innerR * scale, outR = world.outerR * scale;
  ctx.beginPath(); ctx.arc(cx, cy, outR, 0, Math.PI * 2); ctx.arc(cx, cy, inR, 0, Math.PI * 2, true);
  ctx.fillStyle = 'rgba(255,178,91,0.05)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,178,91,0.18)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, inR, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(127,184,255,0.18)';
  ctx.beginPath(); ctx.arc(cx, cy, outR, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(127,184,255,0.08)';
  ctx.beginPath(); ctx.arc(cx, cy, CFG.worldR * scale, 0, Math.PI * 2); ctx.stroke();

  // star
  const sr = CFG.coronaR * scale, gl = 3.2 * world.luminosity;
  const glow = ctx.createRadialGradient(cx, cy, sr * 0.3, cx, cy, sr * gl);
  glow.addColorStop(0, 'rgba(255,220,160,0.9)'); glow.addColorStop(0.25, 'rgba(255,150,70,0.45)'); glow.addColorStop(1, 'rgba(255,100,50,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, sr * gl, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff1d6'; ctx.beginPath(); ctx.arc(cx, cy, sr * 0.75, 0, Math.PI * 2); ctx.fill();

  // hiding spots
  for (const h of world.hides) {
    const [x, y] = toScreen(h.x, h.y); const rr = h.r * scale;
    const gr = ctx.createRadialGradient(x, y, rr * 0.2, x, y, rr * 1.4);
    gr.addColorStop(0, 'rgba(70,90,150,0.55)'); gr.addColorStop(0.7, 'rgba(50,65,120,0.35)'); gr.addColorStop(1, 'rgba(40,50,100,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, rr * 1.4, 0, Math.PI * 2); ctx.fill();
  }

  // cysts: dormant, drawn as a hollow hexagon in the lineage's color
  for (const c of world.cysts) {
    const [x, y] = toScreen(c.x, c.y); const rr = Math.max(2.5, (3 + 5 * c.g[G.size]) * scale * 0.7);
    ctx.strokeStyle = `hsla(${c.hue},50%,70%,0.7)`; ctx.lineWidth = 1; ctx.beginPath();
    for (let k = 0; k < 6; k++) { const t = k / 6 * Math.PI * 2; k ? ctx.lineTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr) : ctx.moveTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr); }
    ctx.closePath(); ctx.stroke();
  }

  // food
  for (const f of world.food) {
    ctx.fillStyle = f.kind === 'plant' ? 'rgba(150,230,170,0.8)' : 'rgba(230,140,120,0.8)';
    const [x, y] = toScreen(f.x, f.y);
    const rr = Math.max(1, Math.min(4, f.energy / 14) * scale);
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
  }

  // organisms
  for (const o of world.orgs) {
    const [x, y] = toScreen(o.x, o.y);
    const rr = o.r * scale;
    const alpha = (0.45 + 0.55 * Math.max(0, o.energy / o.maxEnergy)) * (o.hidden ? 0.45 : 1);
    const ag = o.g[G.aggression];
    // spikes for the aggressive
    if (ag > 0.45 && o.g[G.diet] < 0.67) {
      const n = 3 + Math.round(ag * 6);
      ctx.strokeStyle = `hsla(${o.hue},80%,70%,${alpha})`; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < n; k++) { const t = k / n * Math.PI * 2 + o.age * 0.01; ctx.moveTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr); ctx.lineTo(x + Math.cos(t) * (rr + 2 + ag * 4 * scale), y + Math.sin(t) * (rr + 2 + ag * 4 * scale)); }
      ctx.stroke();
    }
    // body shape encodes diet: circle = herbivore, hexagon = omnivore, arrowhead = carnivore
    const spd = Math.hypot(o.vx, o.vy) || 1, hx = o.vx / spd, hy = o.vy / spd;
    ctx.fillStyle = `hsla(${o.hue},70%,${55 - 10 * o.g[G.armor]}%,${alpha})`;
    ctx.beginPath();
    const diet = o.g[G.diet];
    if (diet >= 0.67) {
      const L = rr * 1.45, W = rr * 1.05;
      ctx.moveTo(x + hx * L, y + hy * L);
      ctx.lineTo(x - hx * L * 0.6 - hy * W, y - hy * L * 0.6 + hx * W);
      ctx.lineTo(x - hx * L * 0.25, y - hy * L * 0.25);
      ctx.lineTo(x - hx * L * 0.6 + hy * W, y - hy * L * 0.6 - hx * W);
      ctx.closePath();
    } else if (diet >= 0.33) {
      const a0 = Math.atan2(hy, hx);
      for (let k = 0; k < 6; k++) { const t = a0 + k / 6 * Math.PI * 2; const px = x + Math.cos(t) * rr * 1.1, py = y + Math.sin(t) * rr * 1.1; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.closePath();
    } else ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
    if (o.g[G.armor] > 0.3) { ctx.strokeStyle = `hsla(${o.hue},40%,85%,${alpha})`; ctx.lineWidth = 1 + o.g[G.armor] * 2.5 * scale; ctx.stroke(); }
    if (o.infected > 0) { ctx.strokeStyle = 'rgba(160,255,120,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, rr + 2.5, 0, Math.PI * 2); ctx.stroke(); }
    if (o.settling) { ctx.strokeStyle = 'rgba(200,200,255,0.5)'; ctx.setLineDash([2, 2]); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, rr + 3, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    if (o.sprinting) { ctx.strokeStyle = 'rgba(255,120,90,0.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, rr + 3, 0, Math.PI * 2); ctx.stroke(); }
    // heading nub (the arrowhead already shows heading)
    if (diet < 0.67) {
      ctx.fillStyle = `rgba(255,255,255,${alpha * 0.8})`;
      ctx.beginPath(); ctx.arc(x + hx * rr * 0.6, y + hy * rr * 0.6, Math.max(1, rr * 0.25), 0, Math.PI * 2); ctx.fill();
    }
    if (o.mateTimer > CFG.mateCooldown - 25) { ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, rr + 4 + (CFG.mateCooldown - o.mateTimer) * 0.4, 0, Math.PI * 2); ctx.stroke(); }
  }

  if (selected && selected.alive) {
    const [x, y] = toScreen(selected.x, selected.y);
    ctx.strokeStyle = '#ffb25b'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(x, y, selected.r * scale + 7, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,178,91,0.25)';
    ctx.beginPath(); ctx.arc(x, y, selected.senseR * scale, 0, Math.PI * 2); ctx.stroke();
  }
}
