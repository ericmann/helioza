// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// jsdom has no canvas. Everything the renderer calls is a no-op that records
// nothing; we are testing that the page wires itself up, not what it paints.
function stubContext() {
  const noop = () => {};
  const target = {
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
    measureText: () => ({ width: 0 }),
  };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : noop),
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

let helioza, frames;

beforeAll(async () => {
  const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  document.body.innerHTML = body;

  // jsdom reports zero-sized elements; give the canvas a box so the view
  // transform is not degenerate.
  for (const id of ['c', 'chart']) {
    const el = document.getElementById(id);
    Object.defineProperty(el, 'clientWidth', { value: 800 });
    Object.defineProperty(el, 'clientHeight', { value: 600 });
    el.getContext = stubContext;
  }

  // Drive the animation loop by hand so the test controls how many frames run.
  frames = [];
  globalThis.requestAnimationFrame = cb => { frames.push(cb); return frames.length; };
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  window.history.replaceState({}, '', '/?seed=12');

  await import('../public/js/main.js');
  helioza = globalThis.helioza;
});

const step = n => { for (let i = 0; i < n; i++) frames.pop()(); };
const text = id => document.getElementById(id).textContent;

describe('the page', () => {
  it('boots and honours the seed in the query string', () => {
    expect(helioza).toBeTruthy();
    expect(helioza.seed).toBe(12);
    expect(helioza.world.orgs.length).toBe(helioza.CFG.founders * helioza.CFG.familySize);
    expect(frames.length).toBe(1);
  });

  it('fills the sidebar on the first paint', () => {
    expect(text('sAlive')).toBe(String(helioza.world.orgs.length));
    expect(text('sTick')).toBe('0');
    expect(text('sLum')).toMatch(/%$/);
    expect(document.getElementById('avgGenes').children.length).toBe(19);
  });

  it('advances the counters as the loop runs', () => {
    const before = helioza.world.tick;
    step(40);
    expect(helioza.world.tick).toBeGreaterThan(before);
    expect(text('sTick')).toBe(helioza.world.tick.toLocaleString());
    expect(text('sAlive')).toBe(String(helioza.world.orgs.length));
    expect(text('sFood')).toMatch(/^\d+ \/ \d+$/);
  });

  it('pauses and resumes', () => {
    const button = document.getElementById('btnPause');
    button.click();
    expect(helioza.view.paused).toBe(true);
    const frozen = helioza.world.tick;
    step(20);
    expect(helioza.world.tick).toBe(frozen);
    button.click();
    expect(helioza.view.paused).toBe(false);
    step(20);
    expect(helioza.world.tick).toBeGreaterThan(frozen);
  });

  it('changes speed', () => {
    document.getElementById('btnSpeed4').click();
    expect(helioza.view.speed).toBe(4);
    expect(document.getElementById('btnSpeed4').classList.contains('on')).toBe(true);
    expect(document.getElementById('btnSpeedH').classList.contains('on')).toBe(false);
    document.getElementById('btnSpeedH').click();
  });

  it('selects an organism when you click it', () => {
    const view = helioza.view;
    const target = helioza.world.orgs[0];
    const [px, py] = [view.cx + target.x * view.scale, view.cy + target.y * view.scale];
    document.getElementById('c').dispatchEvent(
      new window.MouseEvent('click', { clientX: px, clientY: py, bubbles: true }));

    expect(view.selected).toBeTruthy();
    const body = document.getElementById('inspectBody');
    expect(body.className).toBe('');
    expect(body.innerHTML).toContain(`#${view.selected.id}`);
    expect(body.innerHTML).toMatch(/herbivore|omnivore|carnivore/);
  });

  it('drops a plant when you click empty space', () => {
    const view = helioza.view;
    const before = helioza.world.food.length;
    // The far rim: nothing orbits out here.
    document.getElementById('c').dispatchEvent(
      new window.MouseEvent('click', { clientX: view.cx + 460 * view.scale, clientY: view.cy, bubbles: true }));
    expect(helioza.world.food.length).toBe(before + 1);
  });

  it('writes slider changes straight through to the config', () => {
    const cases = [
      ['inMut', 'mutationRate', '0.42'],
      ['inFood', 'foodRate', '0.31'],
      ['inMate', 'mateCost', '0.5'],
      ['inDrag', 'drag', '0.005'],
      ['inAssim', 'dietAssimilation', '0.6'],
    ];
    for (const [id, key, value] of cases) {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new window.Event('input'));
      expect(helioza.CFG[key], key).toBe(Number(value));
      expect(helioza.world.cfg[key], `${key} reaches the running world`).toBe(Number(value));
    }
  });

  it('toggles immigration through the checkbox', () => {
    const box = document.getElementById('inImm');
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new window.Event('change'));
    expect(helioza.CFG.immigration).toBe(true);
    box.checked = false;
    box.dispatchEvent(new window.Event('change'));
    expect(helioza.CFG.immigration).toBe(false);
  });

  it('restarts the world', () => {
    step(5);
    expect(helioza.world.tick).toBeGreaterThan(0);
    document.getElementById('btnReset').click();
    expect(helioza.world.tick).toBe(0);
    expect(helioza.view.selected).toBe(null);
    expect(document.getElementById('inspectBody').className).toBe('empty');
  });
});
