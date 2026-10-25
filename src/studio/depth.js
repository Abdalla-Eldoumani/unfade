import * as ort from 'onnxruntime-web/wasm';

// Depth Anything V2 Small (Apache-2.0), run in the browser with
// onnxruntime-web. `npm run setup` puts the model and the wasm runtime in
// public/, so nothing is fetched from a CDN.
const MODEL_URL = '/models/depth-anything-v2-small/model_quantized.onnx';
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

ort.env.wasm.wasmPaths = '/ort/';
// Several threads need cross-origin isolation, which the dev and demo
// servers turn on; without it the model still runs, just slower.
ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

let sessionPromise = null;

export function loadDepthModel() {
  sessionPromise ??= ort.InferenceSession.create(MODEL_URL, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  }).catch((err) => {
    sessionPromise = null;
    throw new Error(`The depth model did not load (${err.message}). Did you run npm run setup?`);
  });
  return sessionPromise;
}

// The model's resize rule (DPT with keep_aspect_ratio, ensure_multiple_of 14,
// size 518): scale as little as possible so one side lands on 518.
export function modelInputSize(width, height, size = 518, multiple = 14) {
  let sh = size / height;
  let sw = size / width;
  if (Math.abs(1 - sw) < Math.abs(1 - sh)) sh = sw;
  else sw = sh;
  const fit = (v) => Math.max(multiple, Math.round(v / multiple) * multiple);
  return { width: fit(sw * width), height: fit(sh * height) };
}

// Returns { width, height, data } with data in 0..1, where 1 is nearest.
export async function estimateDepth(source) {
  const session = await loadDepthModel();
  const { width: W, height: H } = modelInputSize(source.width, source.height);
  const px = pixelsAt(source, W, H);
  const plane = W * H;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) input[c * plane + i] = (px[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  }
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, H, W]) });
  const pred = out[session.outputNames[0]];
  const [, oh, ow] = pred.dims;
  const depth = { width: ow, height: oh, data: normalize(pred.data) };
  return snapToPhoto(depth, ow === W && oh === H ? px : pixelsAt(source, ow, oh));
}

function pixelsAt(source, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

// Halos when someone leans come from the model's depth edges not lining up
// with the photo's: it blurs across boundaries. A guided filter (He, Sun and
// Tang 2010) with the photo's colour as the guide fits the depth in each small
// window as a straight function of the colour, so a soft depth edge becomes a
// step exactly where the colour changes, and flat areas stay flat. It also
// opens the sky the model fills in between thin things (a tower's lattice).
// Radius 2 and eps 1e-3 were picked by eye on the samples and test photos: a
// wider radius softens clean edges, a smaller eps copies texture into depth.
// `rgba` is the photo at the depth map's size; the result stays in 0..1.
export function snapToPhoto({ width: w, height: h, data: p }, rgba, radius = 2, eps = 1e-3) {
  const n = w * h;
  const I = [0, 1, 2].map((c) => Float32Array.from({ length: n }, (_, i) => rgba[i * 4 + c] / 255));
  const box = (src) => boxMean(src, w, h, radius);
  const times = (a, b) => a.map((v, i) => v * b[i]);
  const mI = I.map(box);
  const mp = box(p);
  const mIp = I.map((c) => box(times(c, p)));
  const [rr, rg, rb, gg, gb, bb] = [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]].map(([a, b]) => box(times(I[a], I[b])));
  const A = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const m0 = mI[0][i], m1 = mI[1][i], m2 = mI[2][i];
    // the colour covariance in this window, steadied by eps, and its inverse by cofactors
    const s00 = rr[i] - m0 * m0 + eps, s01 = rg[i] - m0 * m1, s02 = rb[i] - m0 * m2;
    const s11 = gg[i] - m1 * m1 + eps, s12 = gb[i] - m1 * m2, s22 = bb[i] - m2 * m2 + eps;
    const c00 = s11 * s22 - s12 * s12, c01 = s12 * s02 - s01 * s22, c02 = s01 * s12 - s11 * s02;
    const c11 = s00 * s22 - s02 * s02, c12 = s01 * s02 - s00 * s12, c22 = s00 * s11 - s01 * s01;
    const det = s00 * c00 + s01 * c01 + s02 * c02;
    const v0 = mIp[0][i] - m0 * mp[i], v1 = mIp[1][i] - m1 * mp[i], v2 = mIp[2][i] - m2 * mp[i];
    A[0][i] = (c00 * v0 + c01 * v1 + c02 * v2) / det;
    A[1][i] = (c01 * v0 + c11 * v1 + c12 * v2) / det;
    A[2][i] = (c02 * v0 + c12 * v1 + c22 * v2) / det;
    B[i] = mp[i] - A[0][i] * m0 - A[1][i] * m1 - A[2][i] * m2;
  }
  const mA = A.map(box);
  const mB = box(B);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = Math.min(1, Math.max(0, mA[0][i] * I[0][i] + mA[1][i] * I[1][i] + mA[2][i] * I[2][i] + mB[i]));
  return { width: w, height: h, data: q };
}

// Mean over a (2r+1) square window, shrunk at the borders, in two running sums.
function boxMean(src, w, h, r) {
  const pass = (from, to, len, count, stride, step) => {
    for (let k = 0; k < count; k++) {
      const base = k * stride;
      let sum = 0;
      for (let x = 0; x <= Math.min(r, len - 1); x++) sum += from[base + x * step];
      for (let x = 0; x < len; x++) {
        to[base + x * step] = sum / (Math.min(len - 1, x + r) - Math.max(0, x - r) + 1);
        if (x + r + 1 < len) sum += from[base + (x + r + 1) * step];
        if (x - r >= 0) sum -= from[base + (x - r) * step];
      }
    }
  };
  const rows = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  pass(src, rows, w, h, w, 1);
  pass(rows, out, h, w, 1, w);
  return out;
}

// 0..1 range that ignores the most extreme 1% at each end, so a few stray
// pixels cannot flatten the rest.
function normalize(raw) {
  const sample = [];
  for (let i = 0; i < raw.length; i += 7) sample.push(raw[i]);
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(sample.length * 0.01)];
  const hi = sample[Math.max(0, Math.ceil(sample.length * 0.99) - 1)];
  const span = Math.max(1e-6, hi - lo);
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = Math.min(1, Math.max(0, (raw[i] - lo) / span));
  return out;
}

// 16-bit disparity packed into red (high byte) and green (low byte).
export function depthToPngDataUrl({ width, height, data }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < data.length; i++) {
    const v = Math.round(data[i] * 65535);
    img.data[i * 4] = v >> 8;
    img.data[i * 4 + 1] = v & 255;
    img.data[i * 4 + 2] = v >> 8;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}
