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

  // world: the memory's normalized world field. Resolves once the splat is loaded.
  async load(world, { stage, xr = false }) {
    const s = ensureSpark(stage);
    s.maxStdDev = xr ? XR_MAX_STD_DEV : Math.sqrt(8);
    const url = xr && SMALL_IN_XR ? world.splatSmall : world.splat;
    const mesh = new SplatMesh({ url: isQuest2() ? world.splatSmall : url, worldModifier: undefined, objectModifier: this.fadeModifier() });
    await mesh.initialized;
    mesh.quaternion.set(1, 0, 0, 0);
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
