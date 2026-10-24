import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// WebXR only runs on HTTPS (or localhost), so the dev server uses the
// self-signed cert from `npm run cert` when it exists.
const certDir = fileURLToPath(new URL('./.cert/', import.meta.url));
const https = fs.existsSync(certDir + 'cert.pem')
  ? { key: fs.readFileSync(certDir + 'key.pem'), cert: fs.readFileSync(certDir + 'cert.pem') }
  : undefined;

// Cross-origin isolation lets the depth model use several threads.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

// onnxruntime-web imports its own .mjs from /ort/ at run time. Vite's dev
// server refuses JS imports of files in public/, so serve /ort/ untouched
// before Vite sees the request. The build copies public/ as is, so the demo
// server needs nothing special.
const ortDir = fileURLToPath(new URL('./public/ort/', import.meta.url));
const ortTypes = { '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm' };
const serveOrt = {
  name: 'serve-ort-raw',
  configureServer(server) {
    server.middlewares.use('/ort', (req, res, next) => {
      const name = path.basename(decodeURIComponent(req.url.split('?')[0]));
      const file = path.join(ortDir, name);
      if (!ortTypes[path.extname(name)] || !fs.existsSync(file)) return next();
      res.writeHead(200, { ...isolation, 'Content-Type': ortTypes[path.extname(name)], 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    });
  },
};

// 127.0.0.1, not localhost: the dev API listens on IPv4 only, and Windows
// resolves localhost to ::1 first.
const api = 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [serveOrt],
  server: {
    host: true,
    port: 5173,
    https,
    headers: isolation,
    proxy: {
      '/api': api,
      '/saved': api,
      '/ws': { target: api, ws: true },
    },
  },
  preview: { host: true, port: 4173, https, headers: isolation },
  // onnxruntime-web loads its own wasm from /ort/; pre-bundling breaks that.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  build: {
    target: 'es2022',
    // three.js alone is about 600 kB; one chunk per page is fine here
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      input: {
        index: 'index.html',
        world: 'world.html',
        studio: 'studio.html',
        guide: 'guide.html',
      },
    },
  },
});
