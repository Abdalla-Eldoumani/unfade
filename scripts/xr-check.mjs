// Plays the darkroom on an emulated Meta Quest 2 (Meta's IWER runtime inside a
// headless Chrome or Edge): take each print, shake it, hold it to the eyes,
// look at every light until the memory comes back, then press B.
// Start the dev server first, then: npm run xr-check
// BASE=https://localhost:8443 checks the demo server instead; --headed shows the window.
// It proves the flow, not the feel or the frame rate: only the headset answers those.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'https://localhost:5173';
const SHOTS = fileURLToPath(new URL('../xr-shots/', import.meta.url));
const IWER = readFileSync(new URL('../node_modules/iwer/build/iwer.min.js', import.meta.url), 'utf8');
// Only the bundled samples, so saved memories on this laptop never change what the check covers.
const SAMPLES = JSON.parse(readFileSync(new URL('../public/memories/index.json', import.meta.url), 'utf8')).memories;
// Software rendering keeps the check the same on every laptop, so it runs at a
// few frames per second; every wait below is a poll with a deadline, never a fixed sleep.
const ARGS = ['--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
// Thrown on purpose to prove the ?debug readout shows errors; never counted as a failure.
const INTENTIONAL = 'intentional error from xr-check';

const results = [];
let shot = 0;
function report(ok, what, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`);
  return ok;
}

async function launch() {
  const headless = !process.argv.includes('--headed');
  if (process.env.CHROME_PATH) return chromium.launch({ executablePath: process.env.CHROME_PATH, args: ARGS, headless });
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, args: ARGS, headless });
    } catch {
      // not installed; try the next one
    }
  }
  throw new Error('No Chrome or Edge found. Install Google Chrome, or set CHROME_PATH to a Chromium-based browser.');
}

async function until(page, fn, arg, ms) {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms, polling: 250 });
    return true;
  } catch {
    return false;
  }
}

async function frames(page, n) {
  const f0 = await page.evaluate(() => window.unfade.stage.renderer.info.render.frame);
  return until(page, ([f0, n]) => window.unfade.stage.renderer.info.render.frame >= f0 + n, [f0, n], 20000);
}

// What the ?debug readout shows for the frame just drawn (both eyes): these
// carry over to the Quest, unlike the frame time here.
async function draws(page, where) {
  const text = await page.evaluate(() => {
    const r = window.unfade.stage.renderer.info.render;
    return `${r.calls} calls, ${r.triangles.toLocaleString('en-US')} triangles`;
  });
  console.log(`note  ${where}, both eyes: ${text}`);
}

async function snap(page, name) {
  shot += 1;
  await page.screenshot({ path: join(SHOTS, `${String(shot).padStart(2, '0')}-${name}.png`) });
}

async function press(page, button) {
  await page.evaluate((b) => window.__xr.controllers.right.updateButtonValue(b, 1), button);
  await frames(page, 2);
  await page.evaluate((b) => window.__xr.controllers.right.updateButtonValue(b, 0), button);
}

// Point the right controller from the hip at a print, or at a fixed world point.
async function aimAt(page, index) {
  await page.evaluate((index) => {
    const w = window.unfade;
    const V = w.stage.camera.position.constructor;
    const Q = w.stage.camera.quaternion.constructor;
    const from = new V(0.18, 1.35, -0.15);
    const p = w.hub.prints[index];
    const to = p.group.getWorldPosition(new V());
    to.y -= p.size.height * 0.3;
    const q = new Q().setFromUnitVectors(new V(0, 0, -1), to.sub(from).normalize());
    const c = window.__xr.controllers.right;
    c.position.set(from.x, from.y, from.z);
    c.quaternion.set(q.x, q.y, q.z, q.w);
  }, index);
}

async function lookAt(page, point) {
  await page.evaluate((p) => {
    const w = window.unfade;
    const V = w.stage.camera.position.constructor;
    const Q = w.stage.camera.quaternion.constructor;
    const dir = new V(...p).sub(new V(0, 1.6, 0)).normalize();
    const q = new Q().setFromUnitVectors(new V(0, 0, -1), dir);
    window.__xr.quaternion.set(q.x, q.y, q.z, q.w);
  }, point);
}

async function playOne(page, index) {
  const id = await page.evaluate((i) => window.unfade.hub.prints[i].item.spec.id, index);
  await page.evaluate(() => window.__xr.quaternion.set(0, 0, 0, 1));
  await aimAt(page, index);
  await frames(page, 3);
  await press(page, 'trigger');
  const took = await until(page, (id) => window.unfade.held?.print.item.spec.id === id, id, 8000);
  if (!report(took, `takes the print off the line`, id)) return;

  // Swing the controller side to side once per rendered frame, so the shake
  // is the same at any frame rate.
  const t0 = Date.now();
  let developed = false;
  for (let i = 0; Date.now() - t0 < 40000; i++) {
    await page.evaluate((i) => window.__xr.controllers.right.position.set(i % 2 ? 0.32 : 0.04, 1.3, -0.3), i);
    await frames(page, 1);
    developed = await page.evaluate(() => (window.unfade.held?.print.develop ?? 0) >= 0.98);
    if (developed) break;
  }
  await snap(page, `${id}-developed`);
  if (!report(developed, 'shaking develops it', `${Math.round((Date.now() - t0) / 1000)} s`)) return;

  await page.evaluate(() => window.__xr.controllers.right.position.set(0, 1.55, -0.12));
  const inside = await until(page, (id) => window.unfade.mode === 'memory' && window.unfade.memory.spec?.id === id, id, 20000);
  if (!report(inside, 'holding it to the eyes steps inside')) return;
  // once the fade in is over, so the fade itself is not counted
  await until(page, () => window.unfade.memory.anchors.length > 0 && !window.unfade.busy, null, 20000);
  await frames(page, 3);
  await draws(page, `inside ${id}`);
  await snap(page, `${id}-inside`);

  const points = await page.evaluate(() =>
    window.unfade.memory.anchors.map((a) => a.group.getWorldPosition(new a.group.position.constructor()).toArray()),
  );
  for (const [i, p] of points.entries()) {
    await lookAt(page, p);
    const bloomed = await until(page, (i) => window.unfade.memory.progress().bloomed > i, i, 60000);
    if (!report(bloomed, `looking at light ${i + 1} of ${points.length} brings it back`)) return;
  }
  await page.evaluate(() => window.__xr.quaternion.set(0, 0, 0, 1));
  const revived = await until(page, () => window.unfade.memory.revived, null, 30000);
  await frames(page, 6);
  await snap(page, `${id}-revived`);
  if (!report(revived, 'every light back revives the memory')) return;

  await press(page, 'b-button');
  const back = await until(page, () => window.unfade.mode === 'hub', null, 15000);
  report(back, 'B goes back to the darkroom');
}

const browser = await launch();
try {
  mkdirSync(SHOTS, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
  const errors = [];
  const missing = [];
  // A failed request is listed but does not fail the check: without npm run server
  // the API answers 502 and the pages fall back to the bundled samples on purpose.
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && !m.text().includes(INTENTIONAL) && errors.push(m.text()));
  page.on('pageerror', (e) => !e.message.includes(INTENTIONAL) && errors.push(e.message));
  page.on('response', (r) => r.status() >= 400 && missing.push(`${r.status()} ${new URL(r.url()).pathname}`));
  await page.addInitScript({
    content: `${IWER};
      window.__xr = new IWER.XRDevice(IWER.metaQuest2);
      window.__xr.installRuntime({ forceInstall: true });
      window.__xr.position.set(0, 1.6, 0);`,
  });

  await page.goto(`${BASE}/world.html?debug&net=local`, { waitUntil: 'load', timeout: 30000 });
  const loaded = await until(page, () => window.unfade && window.unfade.hub.prints.length > 0, null, 30000);
  if (report(loaded, 'the darkroom loads with prints on the line', BASE)) {
    await page.evaluate(() => window.unfade.room.send('memory:reset', { memoryId: null }));
    // Fewer pixels so software rendering keeps up; the view is the same.
    await page.evaluate(() => window.unfade.stage.renderer.xr.setFramebufferScaleFactor(0.35));
    await page.click('text=Step into the darkroom');
    const presenting = await until(page, () => window.unfade.stage.presenting, null, 15000);
    if (report(presenting, 'enters VR on the emulated Quest 2')) {
      await frames(page, 4);
      // Inside the headset the readout is the only console, so a thrown error has to show in it.
      await page.evaluate((m) => setTimeout(() => { throw new Error(m); }), INTENTIONAL);
      const shown = await until(page, (m) => window.unfade.readout?.text.includes(m), INTENTIONAL, 15000);
      const line = await page.evaluate(() => window.unfade.readout?.text.split('\n')[0] ?? '');
      report(shown && / ms, worst .* calls .* triangles/.test(line), 'the debug readout shows frame time, draw calls and the last error', line);
      await frames(page, 2);
      await draws(page, 'darkroom');
      await snap(page, 'darkroom');
      const ids = await page.evaluate(() => window.unfade.hub.prints.map((p) => p.item.spec.id));
      for (const id of SAMPLES) {
        if (report(ids.includes(id), `sample ${id} hangs on the line`)) await playOne(page, ids.indexOf(id));
      }
    }
  }
  const unique = [...new Set(errors)];
  report(unique.length === 0, 'no script errors in the console', unique.slice(0, 3).join(' | '));
  if (missing.length) console.log(`note  requests that failed: ${[...new Set(missing)].join(', ')}`);
} catch (err) {
  report(false, 'the check ran to the end', err.message.split('\n')[0]);
} finally {
  await browser.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed} of ${results.length} passed. Screenshots: xr-shots/`);
process.exitCode = failed ? 1 : 0;
