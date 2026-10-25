import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MSG, envelope } from '../src/shared/contract.js';
import { MODEL, analyzeWithClaude, fallbackAnalysis, hasKey } from './claude.js';
import { Rooms } from './rooms.js';
import { Store } from './store.js';

// The only backend: serves the built app, runs /api, relays rooms on /ws.
//   npm run server   dev mode: http://localhost:8787, API and rooms only (Vite serves the pages)
//   npm start        demo mode: https://<laptop-ip>:8443, serves dist/ too
const root = fileURLToPath(new URL('..', import.meta.url));
const dev = process.argv.includes('--dev');
const certDir = path.join(root, '.cert');
const hasCert = fs.existsSync(path.join(certDir, 'cert.pem'));
const port = Number(process.env.PORT) || (dev ? 8787 : hasCert ? 8443 : 8080);
const distDir = path.join(root, 'dist');
const store = new Store({
  dataDir: path.join(root, 'data'),
  bundledDir: dev ? path.join(root, 'public', 'memories') : path.join(distDir, 'memories'),
});
const rooms = new Rooms();

// Spending guard: every analysis costs money, so cap it per run and per minute.
const MAX_ANALYSES = Number(process.env.UNFADE_MAX_ANALYSES) || 150;
const PER_MINUTE = 6;
let analysesUsed = 0;
let minute = { at: 0, count: 0 };
let inFlight = 0;
const cache = new Map();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

const BASE_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function json(res, status, body) {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error(`request larger than ${limit / 1e6} MB`), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('body is not JSON'), { status: 400 });
  }
}

function sendFile(res, file, { immutable = false } = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return json(res, 404, { error: 'not found' });
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const cache = immutable ? 'public, max-age=31536000, immutable' : 'no-store';
    res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': cache });
    fs.createReadStream(file).pipe(res);
  });
}

// Static files from dist/, never outside it.
function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.normalize(path.join(distDir, rel));
  if (!file.startsWith(distDir + path.sep)) return json(res, 403, { error: 'forbidden' });
  if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html';
  sendFile(res, file, { immutable: rel.startsWith('/assets/') });
}

async function analyze(req, res) {
  const body = await readJson(req, 4e6);
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(body.image || '');
  const width = Math.round(Number(body.width));
  const height = Math.round(Number(body.height));
  if (!m || !(width > 0 && height > 0 && width <= 2600 && height <= 2600)) {
    return json(res, 400, { error: 'send image as a data URL with its width and height' });
  }
  const fallback = (warning) => json(res, 200, {
    analysis: fallbackAnalysis(body.stats), source: 'fallback', model: null, warning,
  });

  if (!hasKey()) return fallback('ANTHROPIC_API_KEY is not set on the server, so no questions were written.');
  const hash = createHash('sha256').update(m[2]).update(JSON.stringify(body.hints || {})).digest('hex');
  if (cache.has(hash)) return json(res, 200, { analysis: cache.get(hash), source: 'claude', model: MODEL, cached: true });

  const now = Date.now();
  if (now - minute.at > 60000) minute = { at: now, count: 0 };
  if (analysesUsed >= MAX_ANALYSES) return fallback(`This run reached its cap of ${MAX_ANALYSES} analyses.`);
  if (minute.count >= PER_MINUTE || inFlight >= 2) return fallback('Too many photos at once; try again in a minute.');
  minute.count++;
  analysesUsed++;
  inFlight++;
  try {
    const analysis = await analyzeWithClaude({
      base64: m[2], mediaType: m[1], width, height, hints: body.hints || {},
    });
    cache.set(hash, analysis);
    return json(res, 200, { analysis, source: 'claude', model: MODEL });
  } catch (err) {
    console.warn('analysis failed:', err.message);
    return fallback(err.message);
  } finally {
    inFlight--;
  }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  const { pathname } = url;
  try {
    if (pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        claude: hasKey(),
        model: MODEL,
        analysesLeft: Math.max(0, MAX_ANALYSES - analysesUsed),
        rooms: rooms.summary(),
        lan: lanAddresses(),
      });
    }
    if (pathname === '/api/memories' && req.method === 'GET') {
      return json(res, 200, { memories: await store.all() });
    }
    if (pathname === '/api/memories' && req.method === 'POST') {
      const body = await readJson(req, 15e6);
      const saved = await store.save(body);
      rooms.broadcastAll(envelope(MSG.MEMORY_ADDED, saved, 'server'));
      console.log(`saved memory ${saved.spec.id}`);
      return json(res, 201, saved);
    }
    const del = /^\/api\/memories\/([a-z0-9-]+)$/.exec(pathname);
    if (del && req.method === 'DELETE') {
      return json(res, 200, { removed: await store.remove(del[1]) });
    }
    if (pathname === '/api/analyze' && req.method === 'POST') return await analyze(req, res);
    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'unknown endpoint' });

    const saved = /^\/saved\/([a-z0-9-]+)\/([a-z0-9.]+)$/.exec(pathname);
    if (saved && req.method === 'GET') {
      const file = store.savedFile(saved[1], saved[2]);
      return file ? sendFile(res, file) : json(res, 404, { error: 'not found' });
    }
    if (dev) return json(res, 404, { error: 'in dev mode the pages come from Vite on port 5173' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
    return serveStatic(res, pathname);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    return json(res, status, { error: err.message });
  }
}

// The laptop's own hotspot (192.168.137.x on Windows) first, since that is
// what the headset joins; link-local addresses are never reachable.
function lanAddresses() {
  const rank = (ip) => (ip.startsWith('192.168.137.') || ip.startsWith('172.20.10.') ? 0 : ip.startsWith('192.168.') ? 1 : ip.startsWith('10.') ? 2 : 3);
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map((i) => i.address)
    .sort((a, b) => rank(a) - rank(b));
}

async function main() {
  await store.init();
  if (!dev && !fs.existsSync(path.join(distDir, 'index.html'))) {
    console.error('No dist/ folder. Run `npm run build` first, or use `npm run server` with `npm run dev`.');
    process.exit(1);
  }
  const useTls = !dev && hasCert;
  const server = useTls
    ? https.createServer({ key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')) }, handle)
    : http.createServer(handle);
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://local').pathname === '/ws') rooms.handleUpgrade(req, socket, head);
    else socket.destroy();
  });
  const host = dev ? '127.0.0.1' : '0.0.0.0';
  server.listen(port, host, () => {
    const scheme = useTls ? 'https' : 'http';
    console.log(`${dev ? 'dev API' : 'demo server'} on ${scheme}://localhost:${port}`);
    if (!dev) {
      for (const ip of lanAddresses()) console.log(`  on your network: ${scheme}://${ip}:${port}/`);
      if (!useTls) console.log('  no .cert/ found: the headset needs HTTPS, run `npm run cert` first');
    }
    console.log(hasKey() ? `  Claude: ${MODEL}` : '  Claude: off (ANTHROPIC_API_KEY not set), using fallback analysis');
  });
  const stop = () => {
    rooms.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main();
