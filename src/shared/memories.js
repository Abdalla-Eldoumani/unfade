import { normalizeMemory, validateMemory } from './contract.js';

// Lists every memory as { base, spec }. Asks the server first (bundled plus
// saved memories); without a server, falls back to the bundled list so the
// headset still works on its own.
export async function listMemories({ timeoutMs = 2500 } = {}) {
  try {
    const res = await fetchWithTimeout('/api/memories', timeoutMs);
    if (res.ok) {
      const body = await res.json();
      return clean(body.memories || []);
    }
  } catch {
    // no server: use the bundled memories below
  }
  const res = await fetchWithTimeout('/memories/index.json', timeoutMs);
  const index = await res.json();
  const items = await Promise.all(
    (index.memories || []).map(async (id) => {
      const base = `/memories/${id}/`;
      try {
        const r = await fetchWithTimeout(`${base}memory.json`, timeoutMs);
        return { base, spec: await r.json() };
      } catch {
        return null;
      }
    }),
  );
  return clean(items.filter(Boolean));
}

function clean(items) {
  const out = [];
  for (const item of items) {
    const spec = normalizeMemory(item.spec);
    const errors = validateMemory(spec);
    if (errors.length) {
      console.warn(`skipping memory ${item.spec?.id}:`, errors.join('; '));
      continue;
    }
    out.push({ base: item.base, spec });
  }
  return out;
}

export function fileUrl(item, key) {
  return item.base + item.spec[key].src;
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, cache: 'no-cache' });
  } finally {
    clearTimeout(t);
  }
}

// Reads a depth PNG written by the studio: 16-bit disparity packed into the
// red (high byte) and green (low byte) channels, 1 = nearest.
export async function loadDepth(url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const data = new Float32Array(bmp.width * bmp.height);
  for (let i = 0; i < data.length; i++) data[i] = (px[i * 4] * 256 + px[i * 4 + 1]) / 65535;
  bmp.close();
  return { width: canvas.width, height: canvas.height, data };
}
