import * as THREE from 'three';
import { DEPTH_RANGE_M, fieldOfView } from '../shared/contract.js';

// Grid cells along the photo's long edge: about 2 x SEGMENTS^2 / aspect
// triangles. The third lever if the headset drops frames: 160 is the first step down.
const SEGMENTS = 220;
// The background plate: its long edge in pixels (the haze only ever samples
// it heavily blurred), the head movement whose gaps it must reach behind, and
// how much farther (log depth) a pixel must be to count as behind.
const PLATE_SIZE = 160;
const PLATE_LEAN_M = 0.2;
const PLATE_STEP = 0.1;
// Soft depth edges: the cells each way a cell looks across, and per scale the
// log-depth range there that cuts it. 0.3 cuts about 1% more of a close-up
// than the per-cell jump alone.
// shortcut: off for street and landscape, where it cut thin far things (the
// launch towers) away whole; revisit if a street photo shows streaked edges.
const WINDOW_CELLS = 1;
const WINDOW_CUT = { closeup: 0.3, room: 0.3, street: Infinity, landscape: Infinity };

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

  // The depth model's edges are soft: a step from a cat to the wall behind
  // spreads over two to four cells, each too small to count as a cliff, and
  // those cells stretch into streaks. So a cell also counts the log-depth
  // range across the cells around it (WINDOW_CELLS each way), at a higher bar.
  const windowCut = WINDOW_CUT[spec.scene.scale];
  const at = (r, c) => logZ[Math.min(rows, Math.max(0, r)) * (cols + 1) + Math.min(cols, Math.max(0, c))];
  const around = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let dr = -WINDOW_CELLS; dr <= WINDOW_CELLS + 1; dr++) {
        for (let dc = -WINDOW_CELLS; dc <= WINDOW_CELLS + 1; dc++) {
          const z = at(r + dr, c + dc);
          lo = Math.min(lo, z);
          hi = Math.max(hi, z);
        }
      }
      around[r * cols + c] = hi - lo;
    }
  }

  // Unshared vertices, so each triangle carries its own cliff value: the
  // biggest log-depth jump between its corners, or the range around its cell.
  // Only triangles stretched across a gap are cut, which keeps the holes a
  // cell or two wide; the background plate shows through them.
  const tris = cols * rows * 2;
  const position = new Float32Array(tris * 9);
  const uv = new Float32Array(tris * 6);
  const edge = new Float32Array(tris * 3);
  let t = 0;
  const addTri = (i0, i1, i2, cell) => {
    const jump = Math.max(Math.abs(logZ[i0] - logZ[i1]), Math.abs(logZ[i1] - logZ[i2]), Math.abs(logZ[i0] - logZ[i2]));
    const e = Math.min(1, Math.max(0, (jump - 0.05) / 0.14, (around[cell] - windowCut) / 0.1 + 0.5));
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
      addTri(a, d, b, r * cols + c);
      addTri(b, d, d + 1, r * cols + c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
  geometry.computeBoundingSphere();

  return { geometry, pointAt, zAt, tanH, tanV, aspect, near, far };
}

// The photo, small, with the background across every depth edge grown in
// over the nearer side, one pixel a pass: a guess at what the nearer thing
// hides. The haze shows it through the gaps that open at depth edges when the
// head moves. Drawn into canvas.
export function backgroundPlate(spec, image, depth, canvas, tanH) {
  const [near, far] = DEPTH_RANGE_M[spec.scene.scale];
  const [w, h] = plateSize(depth);
  const logZ = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = sampleDepth(depth, (x + 0.5) / w, (y + 0.5) / h);
      logZ[y * w + x] = -Math.log(d * (1 / near - 1 / far) + 1 / far);
    }
  }
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  // a head moved PLATE_LEAN_M opens gaps reaching lean x (1/near - 1/far)
  // tan units inside the nearer thing; that many plate pixels, one per pass
  const passes = Math.ceil((PLATE_LEAN_M * (1 / near - 1 / far) * w) / (2 * tanH));
  // each pixel's colour, and how far away the thing it now shows is
  let rgb = img.data.slice();
  let shownZ = logZ.slice();
  for (let pass = 0; pass < passes; pass++) {
    const nextRgb = rgb.slice();
    const nextZ = shownZ.slice();
    let grown = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        // the mean of the neighbours that show something clearly farther away
        let n = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        let z = shownZ[i];
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
          if (j < 0 || shownZ[j] - shownZ[i] <= PLATE_STEP) continue;
          n++;
          r += rgb[j * 4];
          g += rgb[j * 4 + 1];
          b += rgb[j * 4 + 2];
          z = Math.max(z, shownZ[j]);
        }
        if (!n) continue;
        nextRgb.set([r / n, g / n, b / n], i * 4);
        nextZ[i] = z;
        grown++;
      }
    }
    rgb = nextRgb;
    shownZ = nextZ;
    if (!grown) break;
  }
  img.data.set(rgb);
  ctx.putImageData(img, 0, 0);
}

export function plateSize(depth) {
  const scale = PLATE_SIZE / Math.max(depth.width, depth.height);
  return [Math.max(2, Math.round(depth.width * scale)), Math.max(2, Math.round(depth.height * scale))];
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
