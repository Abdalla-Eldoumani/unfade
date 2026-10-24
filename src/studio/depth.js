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
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const plane = W * H;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) input[c * plane + i] = (px[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  }
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, H, W]) });
  const pred = out[session.outputNames[0]];
  const [, oh, ow] = pred.dims;
  return { width: ow, height: oh, data: normalize(pred.data) };
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
