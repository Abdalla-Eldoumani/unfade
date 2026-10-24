// One-time setup after `npm install`: copies the onnxruntime wasm files next
// to the app and downloads the depth model (27 MB) so nothing is fetched from
// a CDN at the venue. Safe to run again; it skips what is already there.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ortSrc = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
const ortDst = path.join(root, 'public', 'ort');
const ORT_FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];

const MODEL = {
  // onnx-community/depth-anything-v2-small, Apache-2.0, pinned to one commit
  url: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model_quantized.onnx',
  file: path.join(root, 'public', 'models', 'depth-anything-v2-small', 'model_quantized.onnx'),
  sha256: 'fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d',
  size: 27258801,
};

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copyOrt() {
  if (!fs.existsSync(ortSrc)) {
    console.error('onnxruntime-web is not installed. Run `npm install` first.');
    process.exit(1);
  }
  fs.mkdirSync(ortDst, { recursive: true });
  for (const f of ORT_FILES) fs.copyFileSync(path.join(ortSrc, f), path.join(ortDst, f));
  console.log(`copied ${ORT_FILES.length} onnxruntime files to public/ort/`);
}

async function downloadModel() {
  if (fs.existsSync(MODEL.file) && sha256(MODEL.file) === MODEL.sha256) {
    console.log('depth model already downloaded and verified');
    return;
  }
  fs.mkdirSync(path.dirname(MODEL.file), { recursive: true });
  console.log('downloading the depth model (27 MB) from Hugging Face...');
  const res = await fetch(MODEL.url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const tmp = MODEL.file + '.part';
  const out = fs.createWriteStream(tmp);
  let got = 0;
  let lastPct = -1;
  for await (const chunk of res.body) {
    out.write(chunk);
    got += chunk.length;
    const decile = Math.floor((got / MODEL.size) * 10);
    if (decile !== lastPct) {
      lastPct = decile;
      process.stdout.write(`  ${decile * 10}%\n`);
    }
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  const hash = sha256(tmp);
  if (hash !== MODEL.sha256) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`checksum mismatch (got ${hash}); the file was not kept`);
  }
  fs.renameSync(tmp, MODEL.file);
  console.log('depth model downloaded and verified');
}

copyOrt();
downloadModel()
  .then(() => {
    console.log('\nSetup done. Next:');
    console.log('  npm run cert      (once, so the headset gets HTTPS)');
    console.log('  npm run dev       (pages, in one terminal)');
    console.log('  npm run server    (API and rooms, in a second terminal)');
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
