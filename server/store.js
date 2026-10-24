import fs from 'node:fs/promises';
import path from 'node:path';
import { isMemoryId, normalizeMemory, validateMemory } from '../src/shared/contract.js';

// Memories made in the studio are saved under data/memories/<id>/ on the
// laptop that runs the server. Bundled demo memories live in public/memories.
const LIMITS = { photo: 6e6, thumb: 1e6, depth: 3e6 };
const KINDS = {
  photo: { mime: 'image/jpeg', file: 'photo.jpg', magic: [0xff, 0xd8, 0xff] },
  thumb: { mime: 'image/jpeg', file: 'thumb.jpg', magic: [0xff, 0xd8, 0xff] },
  depth: { mime: 'image/png', file: 'depth.png', magic: [0x89, 0x50, 0x4e, 0x47] },
};

export class Store {
  constructor({ dataDir, bundledDir }) {
    this.dir = path.join(dataDir, 'memories');
    this.bundledDir = bundledDir;
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async bundled() {
    try {
      const index = JSON.parse(await fs.readFile(path.join(this.bundledDir, 'index.json'), 'utf8'));
      const out = [];
      for (const id of index.memories || []) {
        if (!isMemoryId(id)) continue;
        try {
          const spec = JSON.parse(await fs.readFile(path.join(this.bundledDir, id, 'memory.json'), 'utf8'));
          out.push({ base: `/memories/${id}/`, spec });
        } catch {
          // listed but missing; skip it
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  async saved() {
    const out = [];
    let names = [];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return out;
    }
    for (const id of names.sort()) {
      if (!isMemoryId(id)) continue;
      try {
        const spec = JSON.parse(await fs.readFile(path.join(this.dir, id, 'memory.json'), 'utf8'));
        out.push({ base: `/saved/${id}/`, spec });
      } catch {
        // half-written folder; skip it
      }
    }
    return out;
  }

  async all() {
    return [...(await this.bundled()), ...(await this.saved())];
  }

  async uniqueId(wanted) {
    const taken = new Set((await this.all()).map((m) => m.spec.id));
    const base = isMemoryId(wanted) ? wanted.slice(0, 40) : 'memory';
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  async save({ memory, photo, thumb, depth }) {
    const files = {};
    for (const [key, dataUrl] of Object.entries({ photo, thumb, depth })) {
      files[key] = decode(dataUrl, KINDS[key], LIMITS[key], key);
    }
    const spec = normalizeMemory(memory);
    spec.id = await this.uniqueId(spec.id);
    spec.createdAt = new Date().toISOString();
    for (const key of Object.keys(KINDS)) spec[key].src = KINDS[key].file;
    const errors = validateMemory(spec);
    if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400 });

    const dir = path.join(this.dir, spec.id);
    await fs.mkdir(dir, { recursive: true });
    for (const key of Object.keys(KINDS)) await fs.writeFile(path.join(dir, KINDS[key].file), files[key]);
    // memory.json last, so a half-saved folder is never listed
    await fs.writeFile(path.join(dir, 'memory.json'), JSON.stringify(spec, null, 2));
    return { base: `/saved/${spec.id}/`, spec };
  }

  async remove(id) {
    if (!isMemoryId(id)) return false;
    await fs.rm(path.join(this.dir, id), { recursive: true, force: true });
    return true;
  }

  // Absolute path for /saved/<id>/<file>, or null if it is not one of ours.
  savedFile(id, name) {
    if (!isMemoryId(id) || !Object.values(KINDS).some((k) => k.file === name)) return null;
    return path.join(this.dir, id, name);
  }
}

function decode(dataUrl, kind, limit, key) {
  const prefix = `data:${kind.mime};base64,`;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) {
    throw Object.assign(new Error(`${key} must be a ${kind.mime} data URL`), { status: 400 });
  }
  const buf = Buffer.from(dataUrl.slice(prefix.length), 'base64');
  if (buf.length === 0 || buf.length > limit) {
    throw Object.assign(new Error(`${key} is empty or larger than ${limit / 1e6} MB`), { status: 413 });
  }
  if (!kind.magic.every((b, i) => buf[i] === b)) {
    throw Object.assign(new Error(`${key} is not really a ${kind.mime}`), { status: 400 });
  }
  return buf;
}
