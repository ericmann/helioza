// The stacked-area species chart in the sidebar. One band per species, stacked
// in registry order, scaled to the tallest total the history buffer holds — so
// the shape shows composition, not just headcount.

export function drawChart(cctx, world, W, Hh) {
  const H = world.history;
  cctx.clearRect(0, 0, W, Hh);
  if (H.length < 2) return;
  const ids = world.species.map(sp => sp.id);
  let maxTotal = 1;
  for (const h of H) { let t = 0; for (const v of h.counts.values()) t += v; maxTotal = Math.max(maxTotal, t); }
  const xs = i => i / (H.length - 1) * W;
  const base = new Float32Array(H.length);
  for (const id of ids) {
    const sp = world.species.find(x => x.id === id);
    let any = false; for (const h of H) if (h.counts.get(id)) { any = true; break; }
    if (!any) continue;
    cctx.beginPath();
    for (let i = 0; i < H.length; i++) cctx.lineTo(xs(i), Hh - base[i] / maxTotal * Hh);
    for (let i = H.length - 1; i >= 0; i--) { base[i] += H[i].counts.get(id) || 0; cctx.lineTo(xs(i), Hh - base[i] / maxTotal * Hh); }
    cctx.closePath();
    cctx.fillStyle = `hsla(${sp.hue},65%,55%,0.85)`; cctx.fill();
  }
}
