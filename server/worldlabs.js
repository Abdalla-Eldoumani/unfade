import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Turns one photo into a walkable Gaussian-splat world with World Labs'
// Marble API, and keeps the result on this laptop. One world at a time, a cap
// per run, and every failure ends as a plain-words status, never a throw.
// The key only ever comes from the environment.
const API = 'https://api.worldlabs.ai/marble/v1';
export const WORLD_MODEL = process.env.UNFADE_WORLD_MODEL || 'marble-1.1';
const MAX_WORLDS = Number(process.env.UNFADE_MAX_WORLDS) || 8;
const POLL_MS = 5000;
const DEADLINE_MS = 15 * 60 * 1000;
// What the page loads: the 100k splat in a headset, 500k on a laptop, the
// panorama for the fallback surround, the collider for later.
const ASSETS = [
  ['splatSmall', 'splat-100k.spz', (a) => a.splats?.spz_urls?.['100k']],
  ['splat', 'splat-500k.spz', (a) => a.splats?.spz_urls?.['500k']],
  ['pano', 'pano.png', (a) => a.imagery?.pano_url],
  ['collider', 'collider.glb', (a) => a.mesh?.collider_mesh_url],
];

export function hasWorldKey() {
  return Boolean(process.env.WORLDLABS_API_KEY);
}

export class Worlds {
  // dirFor(id) -> folder for that memory's world; photoFor(id) -> its photo path or null
  constructor({ dataDir, dirFor, photoFor }) {
    this.cacheDir = path.join(dataDir, 'worlds', '_cache');
    this.dirFor = dirFor;
    this.photoFor = photoFor;
    this.jobs = new Map(); // id -> { status, progress, reason }
    this.queue = [];
    this.running = false;
    this.used = 0;
  }

  get left() {
    return Math.max(0, MAX_WORLDS - this.used);
  }

  // The world as the page needs it, or null if there is none on disk.
  async ready(id) {
    try {
      const meta = JSON.parse(await fs.readFile(path.join(await this.dirFor(id), 'world.json'), 'utf8'));
      if (meta.status !== 'ready') return null;
      const url = (name) => (name ? `/api/world/${id}/file/${name}` : null);
      return {
        splat: url(meta.files.splat),
        splatSmall: url(meta.files.splatSmall || meta.files.splat),
        pano: url(meta.files.pano),
        collider: url(meta.files.collider),
        scale: meta.scale,
        groundOffset: meta.groundOffset,
      };
    } catch {
      return null;
    }
  }

  async status(id) {
    const world = await this.ready(id);
    if (world) return { status: 'ready', world };
    return this.jobs.get(id) || { status: 'none' };
  }

  // A file inside a memory's world folder, never outside it.
  async file(id, name) {
    if (!/^[a-z0-9][a-z0-9._-]{0,60}$/.test(name)) return null;
    const dir = await this.dirFor(id);
    return dir ? path.join(dir, name) : null;
  }

  // Starts (or queues) a world; answers at once with the current status.
  async start(id) {
    const current = await this.status(id);
    if (current.status === 'ready' || current.status === 'pending' || current.status === 'queued') return current;
    const photo = await this.photoFor(id);
    if (!photo) return this.fail(id, 'There is no memory with that id.');
    if (!hasWorldKey()) return this.fail(id, 'WORLDLABS_API_KEY is not set on the server, so no world was built.');
    if (this.used >= MAX_WORLDS) return this.fail(id, `This run reached its cap of ${MAX_WORLDS} worlds.`);
    this.used++;
    this.jobs.set(id, { status: 'queued', progress: 0 });
    this.queue.push({ id, photo });
    this.pump();
    return this.jobs.get(id);
  }

  fail(id, reason) {
    const job = { status: 'failed', reason };
    this.jobs.set(id, job);
    return job;
  }

  async pump() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const { id, photo } = this.queue.shift();
      try {
        await this.build(id, photo);
        this.jobs.delete(id);
        console.log(`world ready for ${id}`);
      } catch (err) {
        console.warn(`world failed for ${id}: ${err.message}`);
        this.fail(id, err.message);
      }
    }
    this.running = false;
  }

  async build(id, photoPath) {
    const job = this.jobs.get(id);
    job.status = 'pending';
    const bytes = await fs.readFile(photoPath);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const dir = await this.dirFor(id);
    await fs.mkdir(dir, { recursive: true });

    // the same photo never generates twice
    const cached = await fs.readFile(path.join(this.cacheDir, `${hash}.txt`), 'utf8').catch(() => null);
    if (cached && cached !== dir && (await fs.stat(path.join(cached, 'world.json')).catch(() => null))) {
      await fs.cp(cached, dir, { recursive: true });
      this.used--;
      return;
    }

    const ext = path.extname(photoPath).slice(1).toLowerCase() || 'jpg';
    const op = await call('POST', '/worlds:generate', {
      display_name: `unfade ${id}`.slice(0, 64),
      model: WORLD_MODEL,
      permission: { public: false },
      world_prompt: { type: 'image', is_pano: false, image_prompt: { source: 'data_base64', data_base64: bytes.toString('base64'), extension: ext } },
    });
    let done = op;
    const deadline = Date.now() + DEADLINE_MS;
    while (!done.done) {
      if (Date.now() > deadline) throw new Error('World Labs took longer than 15 minutes, so the world was left unbuilt.');
      await new Promise((r) => setTimeout(r, POLL_MS));
      done = await call('GET', `/operations/${encodeURIComponent(op.operation_id)}`);
      const p = Number(done.metadata?.progress?.percentage ?? done.metadata?.progress ?? NaN);
      if (Number.isFinite(p)) job.progress = Math.max(0, Math.min(100, p));
    }
    if (done.error) throw new Error(`World Labs could not build this world (${String(done.error.code || done.error.message || 'no details').slice(0, 80)}).`);

    const assets = done.response?.assets || {};
    const files = {};
    for (const [key, name, pick] of ASSETS) {
      const url = pick(assets);
      if (!url) continue;
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) }).catch(() => null);
      if (!res?.ok) continue;
      await fs.writeFile(path.join(dir, name), Buffer.from(await res.arrayBuffer()));
      files[key] = name;
    }
    if (!files.splat && !files.splatSmall) throw new Error('World Labs finished but sent no splat file.');
    const sem = assets.splats?.semantics_metadata || {};
    await fs.writeFile(path.join(dir, 'world.json'), JSON.stringify({
      status: 'ready',
      files,
      scale: Number(sem.metric_scale_factor) || 1,
      groundOffset: Number(sem.ground_plane_offset) || 0,
      model: WORLD_MODEL,
      cost: done.cost ?? null,
      worldId: done.response?.world_id || done.metadata?.world_id || null,
      hash,
      at: new Date().toISOString(),
    }, null, 1));
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(path.join(this.cacheDir, `${hash}.txt`), dir);
  }
}

// One request to the API. Failures become plain words that never quote the key.
async function call(method, route, body) {
  let res;
  try {
    res = await fetch(`${API}${route}`, {
      method,
      signal: AbortSignal.timeout(60000),
      headers: { 'content-type': 'application/json', 'WLT-Api-Key': process.env.WORLDLABS_API_KEY || '' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`World Labs could not be reached from this laptop (${err.cause?.code || err.name}).`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new Error(`World Labs did not accept the API key (${res.status}).`);
  if (res.status === 402) throw new Error('The World Labs account has run out of credits (402).');
  if (res.status === 429) throw new Error('World Labs has had too many requests for now (429).');
  // 400 and 422 name the field at fault, never the key
  const detail = (Array.isArray(data.detail) ? data.detail.map((d) => `${(d.loc || []).join('.')}: ${d.msg}`).join('; ') : data.detail || data.message || '').toString().slice(0, 160);
  if (!res.ok) throw new Error(`World Labs refused the request (${res.status}${detail ? `: ${detail}` : ''}).`);
  return data;
}

// node server/worldlabs.js --samples : builds the bundled samples' worlds once.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--samples')) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const bundled = path.join(root, 'public', 'memories');
  const { memories } = JSON.parse(await fs.readFile(path.join(bundled, 'index.json'), 'utf8'));
  const ids = memories.map((m) => (typeof m === 'string' ? m : m.id));
  const worlds = new Worlds({
    dataDir: path.join(root, 'data'),
    dirFor: async (id) => path.join(root, 'data', 'worlds', id),
    photoFor: async (id) => path.join(bundled, id, 'photo.jpg'),
  });
  for (const id of ids) {
    const s = await worlds.start(id);
    console.log(id, s.status, s.reason || '');
  }
  const tick = setInterval(async () => {
    const all = await Promise.all(ids.map(async (id) => [id, await worlds.status(id)]));
    console.log(all.map(([id, s]) => `${id}: ${s.status}${s.progress ? ` ${s.progress}%` : ''}${s.reason ? ` (${s.reason})` : ''}`).join(' | '));
    if (all.every(([, s]) => s.status === 'ready' || s.status === 'failed')) clearInterval(tick);
  }, 15000);
}
