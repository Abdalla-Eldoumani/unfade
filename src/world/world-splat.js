import * as THREE from 'three';
import { SparkRenderer, SplatMesh, dyno, isQuest2 } from '@sparkjsdev/spark';
import { AGE_CAST, PAPER } from './shaders.js';

// A memory's generated world (server/worldlabs.js): a Gaussian splat from
// World Labs' Marble, drawn with Spark. Marble writes splats in an OpenCV
// frame (y down, z forward); a half turn about x makes it three's (y up,
// -z forward), with the photo's camera at the origin, which the memory group
// puts at the viewer's eyes. metric_scale_factor turns its units into metres.
// The 100k splat in a headset (the Quest 2 is weak), 500k on a laptop.
const SMALL_IN_XR = true;
// Spark's default Gaussian extent is sqrt(8); sqrt(5) is its advice for VR.
const XR_MAX_STD_DEV = Math.sqrt(5);
const BLOOMS = 3;

let spark = null;

// Marble gives no camera pose, and it reads a photo's field of view its own
// way (the espresso close-up became a cup a few degrees wide on a café
// table). Its panorama is centred on the photo's heading (u 0.5 at -z,
// growing to the right), so the photo's tilt, turn and width are where a
// small colour copy of it best matches the panorama: coarse, then fine.
// Cached per world in localStorage. Returns radians and a scale on tanH/tanV.
const VIEW_VERSION = 2;
export async function findPhotoView(world, photoImage, tanH, tanV) {
  const key = `unfade-view:${VIEW_VERSION}:${world.pano}`;
  try {
    const hit = JSON.parse(localStorage.getItem(key) || 'null');
    if (hit && Number.isFinite(hit.yaw)) return hit;
  } catch {
    // no storage; work it out again
  }
  const rgb = (src, w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const out = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      out[i * 3] = d[i * 4];
      out[i * 3 + 1] = d[i * 4 + 1];
      out[i * 3 + 2] = d[i * 4 + 2];
    }
    return out;
  };
  const pano = new Image();
  pano.src = world.pano;
  await pano.decode();
  const PW = 768;
  const PH = 384;
  const P = rgb(pano, PW, PH);
  const FW = 40;
  const FH = Math.max(8, Math.round((FW * tanV) / tanH));
  const F = rgb(photoImage, FW, FH);
  const n = FW * FH * 3;
  let fm = 0;
  for (const x of F) fm += x;
  fm /= n;
  let fn = 0;
  for (let k = 0; k < n; k++) {
    F[k] -= fm;
    fn += F[k] * F[k];
  }
  fn = Math.sqrt(fn);
  const sample = new Float32Array(n);
  const score = (yawDeg, pitchDeg, fov) => {
    const cp = Math.cos((pitchDeg * Math.PI) / 180);
    const sp = Math.sin((pitchDeg * Math.PI) / 180);
    const cy = Math.cos((yawDeg * Math.PI) / 180);
    const sy = Math.sin((yawDeg * Math.PI) / 180);
    let m = 0;
    for (let j = 0; j < FH; j++) {
      for (let i = 0; i < FW; i++) {
        // the camera's ray, tilted about x, then turned about y (three's YXZ)
        const x0 = ((i + 0.5) / FW - 0.5) * 2 * tanH * fov;
        const y0 = (0.5 - (j + 0.5) / FH) * 2 * tanV * fov;
        const y1 = y0 * cp + sp;
        const z1 = y0 * sp - cp;
        const x2 = x0 * cy + z1 * sy;
        const z2 = -x0 * sy + z1 * cy;
        const lon = Math.atan2(x2, -z2);
        const lat = Math.asin(y1 / Math.hypot(x2, y1, z2));
        const u = (((0.5 + lon / (2 * Math.PI)) % 1) + 1) % 1;
        const v = 0.5 - lat / Math.PI;
        const p = (Math.min(PH - 1, Math.floor(v * PH)) * PW + Math.min(PW - 1, Math.floor(u * PW))) * 3;
        const k = (j * FW + i) * 3;
        sample[k] = P[p];
        sample[k + 1] = P[p + 1];
        sample[k + 2] = P[p + 2];
        m += P[p] + P[p + 1] + P[p + 2];
      }
    }
    m /= n;
    let dot = 0;
    let sn = 0;
    for (let k = 0; k < n; k++) {
      const d = sample[k] - m;
      dot += d * F[k];
      sn += d * d;
    }
    return dot / (Math.sqrt(sn) * fn + 1e-6);
  };
  let best = { s: -2, yaw: 0, pitch: 0, fov: 1 };
  for (const fov of [0.3, 0.4, 0.55, 0.7, 0.85, 1, 1.15]) {
    for (let pitch = -85; pitch <= 60; pitch += 5) {
      for (let yaw = -30; yaw <= 30; yaw += 5) {
        const s = score(yaw, pitch, fov);
        if (s > best.s) best = { s, yaw, pitch, fov };
      }
    }
  }
  const coarse = best;
  for (let fov = coarse.fov * 0.85; fov <= coarse.fov * 1.16; fov += coarse.fov * 0.05) {
    for (let pitch = coarse.pitch - 4; pitch <= coarse.pitch + 4; pitch += 1) {
      for (let yaw = coarse.yaw - 4; yaw <= coarse.yaw + 4; yaw += 1) {
        const p = Math.max(-89, Math.min(89, pitch));
        const s = score(yaw, p, fov);
        if (s > best.s) best = { s, yaw, pitch: p, fov };
      }
    }
  }
  const view = { yaw: (best.yaw * Math.PI) / 180, pitch: (best.pitch * Math.PI) / 180, fov: best.fov, score: best.s };
  try {
    localStorage.setItem(key, JSON.stringify(view));
  } catch {
    // no storage; fine
  }
  return view;
}

// One Spark renderer for the whole page; it draws every SplatMesh in the scene.
export function ensureSpark(stage) {
  if (spark) return spark;
  spark = new SparkRenderer({ renderer: stage.renderer });
  stage.scene.add(spark);
  return spark;
}

export class WorldSplat {
  constructor() {
    this.mesh = null;
    this.vivid = dyno.dynoFloat(0);
    this.blooms = Array.from({ length: BLOOMS }, () => dyno.dynoVec4(new THREE.Vector4(0, 0, 0, 0)));
    this._v = new THREE.Vector3();
  }

  // world: the memory's normalized world field; view: where the photo looks
  // ({ yaw, pitch } in radians, findPhotoView). Resolves once loaded.
  async load(world, { stage, xr = false, view = { yaw: 0, pitch: 0 } }) {
    const s = ensureSpark(stage);
    s.maxStdDev = xr ? XR_MAX_STD_DEV : Math.sqrt(8);
    const url = xr && SMALL_IN_XR ? world.splatSmall : world.splat;
    const mesh = new SplatMesh({ url: isQuest2() ? world.splatSmall : url, objectModifier: this.fadeModifier() });
    await mesh.initialized;
    // Marble's world stands upright, not along the photo; turn it so the
    // photo's heading is straight ahead (its pitch is left to the viewer)
    mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -view.yaw).multiply(new THREE.Quaternion(1, 0, 0, 0));
    mesh.scale.setScalar(world.scale);
    this.mesh = mesh;
    this.scale = world.scale;
    // the ground under the camera, in the memory group's frame (metres, y up)
    this.groundY = -world.groundOffset;
    return mesh;
  }

  // Each splat's colour: the faded print look, back to its own colour by
  // uVivid everywhere and inside each bloom's sphere (object space).
  fadeModifier() {
    const { vivid, blooms } = this;
    const paper = PAPER.clone();
    const cast = AGE_CAST;
    return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
      const fade = new dyno.Dyno({
        inTypes: { gsplat: dyno.Gsplat, vivid: 'float', b0: 'vec4', b1: 'vec4', b2: 'vec4' },
        outTypes: { gsplat: dyno.Gsplat },
        inputs: { gsplat, vivid, b0: blooms[0], b1: blooms[1], b2: blooms[2] },
        statements: ({ inputs, outputs }) => [
          `${outputs.gsplat} = ${inputs.gsplat};`,
          `vec3 c = ${outputs.gsplat}.rgba.rgb;`,
          `float l = dot(c, vec3(0.2126, 0.7152, 0.0722));`,
          `vec3 faded = mix(mix(vec3(l), c, 0.22), vec3(${paper.r.toFixed(4)}, ${paper.g.toFixed(4)}, ${paper.b.toFixed(4)}), 0.38) * vec3(${cast.x}, ${cast.y}, ${cast.z});`,
          `float local = ${inputs.vivid};`,
          `vec4 bs[3] = vec4[3](${inputs.b0}, ${inputs.b1}, ${inputs.b2});`,
          `for (int i = 0; i < 3; i++) {`,
          `  if (bs[i].w <= 0.0) continue;`,
          `  float d = distance(${outputs.gsplat}.center, bs[i].xyz);`,
          `  local = max(local, 1.0 - smoothstep(bs[i].w * 0.55, bs[i].w, d));`,
          `}`,
          `${outputs.gsplat}.rgba.rgb = mix(faded, c, clamp(local, 0.0, 1.0));`,
        ],
      });
      return { gsplat: fade.outputs.gsplat };
    });
  }

  setVivid(v) {
    this.vivid.value = v;
  }

  // points: [{ position: Vector3 in world space, radius: metres }], up to three
  setBlooms(points) {
    if (!this.mesh) return;
    this.mesh.updateMatrixWorld();
    for (let i = 0; i < BLOOMS; i++) {
      const p = points[i];
      if (!p || p.radius <= 0) {
        this.blooms[i].value.set(0, 0, 0, 0);
        continue;
      }
      this._v.copy(p.position);
      this.mesh.worldToLocal(this._v);
      this.blooms[i].value.set(this._v.x, this._v.y, this._v.z, p.radius / this.scale);
    }
  }

  dispose() {
    if (!this.mesh) return;
    this.mesh.removeFromParent();
    this.mesh.dispose?.();
    this.mesh = null;
  }
}
