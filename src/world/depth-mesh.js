import * as THREE from 'three';
import { DEPTH_RANGE_M, fieldOfView } from '../shared/contract.js';

// Grid cells along the photo's long edge: about 2 x SEGMENTS^2 / aspect
// triangles. The third lever if the headset drops frames: 160 is the first step down.
const SEGMENTS = 220;
// How far the background plate looks (depth-map pixels) for what is behind an
// edge, and how much farther (log depth) a pixel must be to count as behind.
const PLATE_RADIUS = 20;
const PLATE_STEP = 0.1;

// Turns a photo plus its depth map into a grid of triangles, as if every
// pixel were pushed out along the ray the camera saw it on. Standing at the
// origin you see the photo exactly; moving your head gives real parallax.
export function buildDepthMesh(spec, depth, { segments = SEGMENTS } = {}) {
  const { width: pw, height: ph } = spec.photo;
  const aspect = pw / ph;
  const fov = fieldOfView({ width: pw, height: ph, lens: spec.camera.lens, focal35mm: spec.camera.focal35mm });
  const tanH = Math.tan((fov.h * Math.PI) / 360);
  const tanV = Math.tan((fov.v * Math.PI) / 360);
  const [near, far] = DEPTH_RANGE_M[spec.scene.scale];
  const invNear = 1 / near;
  const invFar = 1 / far;

  const cols = aspect >= 1 ? segments : Math.max(8, Math.round(segments * aspect));
  const rows = aspect >= 1 ? Math.max(8, Math.round(segments / aspect)) : segments;

  // Disparity (1 = near) to metres, interpolated in inverse depth.
  const zAt = (u, v) => 1 / (sampleDepth(depth, u, v) * (invNear - invFar) + invFar);
  const pointAt = (u, v, out = new THREE.Vector3()) => {
    const z = zAt(u, v);
    return out.set((u - 0.5) * 2 * tanH * z, (0.5 - v) * 2 * tanV * z, -z);
  };

  const count = (cols + 1) * (rows + 1);
  const gridPos = new Float32Array(count * 3);
  const gridUv = new Float32Array(count * 2);
  const logZ = new Float32Array(count);
  const p = new THREE.Vector3();
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const i = r * (cols + 1) + c;
      const u = c / cols;
      const v = r / rows;
      pointAt(u, v, p);
      gridPos.set([p.x, p.y, p.z], i * 3);
      gridUv.set([u, 1 - v], i * 2);
      logZ[i] = Math.log(-p.z);
    }
  }

  // Unshared vertices, so each triangle carries its own cliff value: the
  // biggest log-depth jump between its corners. Only triangles stretched
  // across a gap dissolve, which keeps the holes one cell wide.
  const tris = cols * rows * 2;
  const position = new Float32Array(tris * 9);
  const uv = new Float32Array(tris * 6);
  const edge = new Float32Array(tris * 3);
  let t = 0;
  const addTri = (i0, i1, i2) => {
    const jump = Math.max(Math.abs(logZ[i0] - logZ[i1]), Math.abs(logZ[i1] - logZ[i2]), Math.abs(logZ[i0] - logZ[i2]));
    const e = Math.min(1, Math.max(0, (jump - 0.05) / 0.14));
    [i0, i1, i2].forEach((i, k) => {
      const v = t * 3 + k;
      position[v * 3] = gridPos[i * 3];
      position[v * 3 + 1] = gridPos[i * 3 + 1];
      position[v * 3 + 2] = gridPos[i * 3 + 2];
      uv[v * 2] = gridUv[i * 2];
      uv[v * 2 + 1] = gridUv[i * 2 + 1];
      edge[v] = e;
    });
    t++;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const d = a + cols + 1;
      addTri(a, d, b);
      addTri(b, d, d + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
  geometry.computeBoundingSphere();

  return { geometry, pointAt, zAt, tanH, tanV, aspect, near, far };
}

// The photo at the depth map's size, with every pixel on the near side of a
// depth edge taking the colour of the farthest pixel within PLATE_RADIUS: a
// guess at what the nearer thing hides. The haze shows it through the gaps
// that open at depth edges when the head moves. Drawn into canvas.
export function backgroundPlate(spec, image, depth, canvas) {
  const { width: w, height: h, data } = depth;
  const [near, far] = DEPTH_RANGE_M[spec.scene.scale];
  const logZ = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) logZ[i] = -Math.log(data[i] * (1 / near - 1 / far) + 1 / far);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const src = img.data.slice();
  const r = PLATE_RADIUS;
  // the farthest pixel in the square around each one: rows first, then columns
  const rowFar = new Float32Array(w * h);
  const rowAt = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = -Infinity;
      let at = 0;
      for (let k = Math.max(0, x - r), end = Math.min(w - 1, x + r); k <= end; k++) {
        if (logZ[y * w + k] > best) {
          best = logZ[y * w + k];
          at = y * w + k;
        }
      }
      rowFar[y * w + x] = best;
      rowAt[y * w + x] = at;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let best = -Infinity;
      let at = 0;
      for (let k = Math.max(0, y - r), end = Math.min(h - 1, y + r); k <= end; k++) {
        if (rowFar[k * w + x] > best) {
          best = rowFar[k * w + x];
          at = rowAt[k * w + x];
        }
      }
      const i = y * w + x;
      if (best - logZ[i] > PLATE_STEP) img.data.set(src.subarray(at * 4, at * 4 + 4), i * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Bilinear sample of the depth map at (u, v), v = 0 at the top.
export function sampleDepth(depth, u, v) {
  const { width: w, height: h, data } = depth;
  const x = Math.min(w - 1, Math.max(0, u * (w - 1)));
  const y = Math.min(h - 1, Math.max(0, v * (h - 1)));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const top = data[y0 * w + x0] * (1 - fx) + data[y0 * w + x1] * fx;
  const bottom = data[y1 * w + x0] * (1 - fx) + data[y1 * w + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}
