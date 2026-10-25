import * as THREE from 'three';
import { fileUrl, loadDepth } from '../shared/memories.js';
import { AnchorMarker } from './anchors.js';
import { backgroundPlate, buildDepthMesh, plateSize } from './depth-mesh.js';
import { ENVIRONMENTS, environmentUrl, pickEnvironment } from './environments.js';
import { makeParticles } from './particles.js';
import { memoryMaterial, peripheryMaterial } from './shaders.js';
import { FONTS, disposeMesh, glowMap, makeText } from './text.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WorldSplat, findPhotoView } from './world-splat.js';

const BLOOM_S = 2.2;
const BLOOM_RADIUS = 0.45;
const REVIVE_S = 2.6;
// The return lands in order: the sound swells at once, then the colour
// comes back, then the title writes in once most of the colour is there.
const COLOUR_AFTER_S = 0.5;
const TITLE_AFTER_S = 2.4;
// Through the gaps that open at depth edges when the head moves, show a guess
// at what the nearer thing hides (the background plate, depth-mesh.js) rather
// than a blurred copy of the nearer thing. false switches it off.
const GAP_FILL = true;
// A bloom's reach in a generated world, in metres, when fully open.
const SPLAT_BLOOM_M = 1.4;
// Walking in a generated world stops this far short of its collider mesh:
// a single photo shows only the front of things, so inside them is void.
const CLEARANCE_M = 0.35;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const loader = new THREE.TextureLoader();

// One memory, stood up in 3D around the viewer. Owns its anchors, blooms,
// haze and particles; knows nothing about input or networking.
export class MemoryScene {
  constructor({ maxAnisotropy = 4, stage = null } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'memory';
    this.maxAnisotropy = maxAnisotropy;
    this.stage = stage;
    this.splat = null;
    this.viewPitch = 0;
    this.viewFov = 1;
    this.item = null;
    this.anchors = [];
    this.blooms = [];
    this.vivid = 0;
    this.vividTarget = 0;
    this.fadeIn = 0;
    this.revived = false;
    this.revivedAt = 0;
    this.titleCard = null;
    this.intro = null;
    this.t = 0;
  }

  get spec() {
    return this.item?.spec;
  }

  async load(item) {
    this.dispose();
    this.item = item;
    const { spec } = item;
    const [photo, depth, surroundings] = await Promise.all([
      loader.loadAsync(fileUrl(item, 'photo')),
      loadDepth(fileUrl(item, 'depth')),
      loadSurroundings(item),
    ]);
    const { map: envMap, yaw: envYaw } = surroundings;
    photo.colorSpace = THREE.SRGBColorSpace;
    photo.anisotropy = this.maxAnisotropy;
    photo.generateMipmaps = true;
    photo.minFilter = THREE.LinearMipmapLinearFilter;
    if (envMap) {
      envMap.colorSpace = THREE.SRGBColorSpace;
      // mips let the shader blur the surroundings near the photo; repeat
      // closes the seam where the panorama's two ends meet behind the viewer
      envMap.generateMipmaps = true;
      envMap.minFilter = THREE.LinearMipmapLinearFilter;
      envMap.wrapS = THREE.RepeatWrapping;
    }

    this.built = buildDepthMesh(spec, depth);
    const { geometry, tanH, tanV, aspect } = this.built;

    this.material = memoryMaterial(photo, { aspect, palette: spec.palette });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    const env = envColors(spec);
    const maxDim = Math.max(spec.photo.width, spec.photo.height);
    let plate = null;
    if (GAP_FILL) {
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = plateSize(depth);
      plate = new THREE.CanvasTexture(canvas);
      plate.colorSpace = THREE.SRGBColorSpace;
      // made on the first frame inside, under the full paper fade, rather than
      // here: load runs while a print is being shaken in the hand
      this.platePending = () => {
        backgroundPlate(spec, photo.image, depth, canvas, tanH);
        plate.needsUpdate = true;
      };
    }
    const shared = { tanH, tanV, env, maxDim, aspect, bloom: this.material.uniforms.uBloom, plate, envMap, envYaw };
    this.periphery = new THREE.Mesh(new THREE.SphereGeometry(60, 48, 24), peripheryMaterial(photo, shared));
    this.periphery.renderOrder = -1;
    this.group.add(this.periphery);

    // A generated world replaces the photo sheet and the haze: it already
    // holds the photo's view and everything around it. If it fails to load,
    // the sheet and haze stay, so there is never nothing to see.
    if (spec.world && this.stage) {
      const splat = new WorldSplat();
      try {
        const view = spec.world.pano ? await findPhotoView(spec.world, photo.image, tanH, tanV) : { yaw: 0, pitch: 0 };
        const mesh = await splat.load(spec.world, { stage: this.stage, xr: this.stage.renderer.xr.isPresenting, view });
        // the photo looks this far up (+) or down (-) inside its world
        this.viewPitch = view.pitch;
        this.viewFov = view.fov ?? 1;
        if (this.item === item) {
          this.splat = splat;
          this.group.add(mesh);
          this.mesh.visible = false;
          this.periphery.visible = false;
          if (spec.world.collider) await this.loadCollider(spec.world, mesh, item);
        } else splat.dispose();
      } catch (err) {
        console.warn('the world did not load; showing the photo instead:', err.message);
        splat.dispose();
      }
    }

    this.particles = makeParticles(spec.scene.particles, spec.palette);
    if (this.particles) this.group.add(this.particles);

    const anchors = spec.anchors.length
      ? spec.anchors
      : [{ id: 'center', x: 0.5, y: 0.5, label: 'this moment', question: 'What do you remember here?', sound: 'none', note: '' }];
    for (const a of anchors) {
      const p = this.built.pointAt(a.x, a.y).multiplyScalar(0.94);
      if (this.splat) this.onWorld(p, a, tanH, tanV);
      const marker = new AnchorMarker(a, p);
      if (a.note) marker.addNote(a.note, '');
      this.anchors.push(marker);
      this.blooms.push({ r: 0, w: 0, active: false });
      this.group.add(marker.group);
    }

    this.intro = makeText('Look at a light to bring it back', { font: FONTS.hand(64, 500), lineHeightM: 0.05, maxChars: 34 });
    this.intro.position.set(0, -0.42, -1.4);
    this.intro.material.opacity = 0;
    this.group.add(this.intro);

    this.vivid = 0;
    this.vividTarget = 0;
    this.revived = false;
    return this;
  }

  // Moves anchor point p onto the generated world: along the photo's ray as
  // Marble saw it (its tilt and width), at the collider's surface if it has
  // one, else at the depth map's distance.
  onWorld(p, a, tanH, tanV) {
    const dist = p.length();
    const dir = new THREE.Vector3((a.x - 0.5) * 2 * tanH * this.viewFov, (0.5 - a.y) * 2 * tanV * this.viewFov, -1)
      .normalize()
      .applyAxisAngle(X_AXIS, this.viewPitch);
    let reach = dist;
    if (this.collider) {
      this.group.updateMatrixWorld(true);
      const from = this.group.localToWorld(new THREE.Vector3());
      const along = dir.clone().transformDirection(this.group.matrixWorld);
      const hit = new THREE.Raycaster(from, along, 0.05, 50).intersectObject(this.collider, true)[0];
      if (hit) reach = Math.max(0.2, hit.distance * 0.94);
    }
    p.copy(dir).multiplyScalar(reach);
  }

  // The world's coarse collider, in the splat's own frame, never drawn.
  async loadCollider(world, splatMesh, item) {
    try {
      const gltf = await new GLTFLoader().loadAsync(world.collider);
      if (this.item !== item) return;
      const c = gltf.scene;
      c.quaternion.copy(splatMesh.quaternion);
      c.scale.copy(splatMesh.scale);
      c.visible = false;
      c.traverse((o) => {
        if (o.isMesh) o.material.side = THREE.DoubleSide;
      });
      this.collider = c;
      this.group.add(c);
    } catch (err) {
      console.warn('no collider for this world; walking is not blocked:', err.message);
    }
  }

  // True when moving the eye from a to b (world space) would come within
  // CLEARANCE_M of the world's surfaces.
  blocked(a, b) {
    if (!this.collider) return false;
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-6) return false;
    this.collider.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(a, dir.divideScalar(len), 0, len + CLEARANCE_M);
    return ray.intersectObject(this.collider, true).length > 0;
  }

  // Stand the memory around the viewer: its camera position is their eyes.
  placeAt(position, yaw) {
    this.group.position.copy(position);
    this.group.rotation.set(0, yaw, 0);
  }

  anchorById(id) {
    return this.anchors.findIndex((a) => a.id === id);
  }

  bloom(anchorId, t = this.t) {
    const i = this.anchorById(anchorId);
    if (i < 0 || this.anchors[i].bloomed) return false;
    this.anchors[i].bloom(t);
    this.blooms[i] = { r: 0, w: 1, active: true, start: t };
    if (this.anchors.every((a) => a.bloomed)) this.revive(t);
    return true;
  }

  revive(t = this.t) {
    if (this.revived) return;
    this.revived = true;
    this.revivedAt = t;
    this.vividTarget = 1;
    const s = this.spec;
    const lines = [s.title, [s.when, s.where].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
    this.titleCard = makeText(lines, { font: FONTS.hand(64, 600), lineHeightM: 0.095, maxChars: 26 });
    // Centred under the photo, below the eye line, and nearer than whatever
    // the photo shows anywhere behind it (corners, edges and middle, clamped
    // to the photo), so both eyes agree it is in front; scaled with its
    // distance, so it always looks the same size.
    const at = new THREE.Vector3(0, -0.32, -1.25);
    const { width, height } = this.titleCard.userData.size;
    const { tanH, tanV, pointAt } = this.built;
    const clamp01 = (x) => Math.min(1, Math.max(0, x));
    let nearest = Infinity;
    for (const fx of [-0.5, 0, 0.5]) {
      for (const fy of [-0.5, 0, 0.5]) {
        const u = clamp01(0.5 + (fx * width) / -at.z / (2 * tanH));
        const v = clamp01(0.5 - (at.y + fy * height) / -at.z / (2 * tanV));
        nearest = Math.min(nearest, -pointAt(u, v).z);
      }
    }
    at.multiplyScalar(Math.min(1, (nearest * 0.9) / -at.z));
    this.titleCard.position.copy(at);
    this.titleCard.scale.setScalar(at.z / -1.25);
    this.titleCard.material.opacity = 0;
    this.titleCard.material.depthTest = false;
    this.titleCard.renderOrder = 22;
    // a soft dark falloff behind the words, so they read over a bright photo
    const shade = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 1.35, height * 2),
      new THREE.MeshBasicMaterial({ map: glowMap(), color: '#0c0907', transparent: true, opacity: 0, depthWrite: false, depthTest: false }),
    );
    shade.position.z = -0.01;
    shade.renderOrder = 21;
    this.titleCard.add(shade);
    this.titleCard.userData.shade = shade;
    this.group.add(this.titleCard);
  }

  addNote(anchorId, text, author) {
    const i = this.anchorById(anchorId);
    const marker = this.anchors[i >= 0 ? i : 0];
    marker?.addNote(text, author);
  }

  nudge(anchorId) {
    const i = this.anchorById(anchorId);
    if (i >= 0) this.anchors[i].pulse();
  }

  // rays: [{ origin, direction }] from the head and any pointers.
  // Returns the ids of anchors whose look just completed.
  update(dt, t, headPos, rays, pointScale) {
    this.t = t;
    if (this.platePending) {
      this.platePending();
      this.platePending = null;
    }
    const done = [];
    // a short grace period, so the faded memory is seen before anything returns
    const settled = t - (this.enteredAt ?? t) > 2.5;
    for (const marker of this.anchors) {
      const looked = settled && rays.some((r) => marker.isLookedAt(r.origin, r.direction));
      if (marker.update(dt, t, headPos, looked)) done.push(marker.id);
    }
    const u = this.material.uniforms;
    this.blooms.forEach((b, i) => {
      if (b.active) b.r = Math.min(BLOOM_RADIUS, BLOOM_RADIUS * easeOut(Math.min(1, (t - b.start) / BLOOM_S)));
      const a = this.anchors[i].anchor;
      u.uBloom.value[i].set(a.x, 1 - a.y, b.r, b.w);
    });
    // on the same clock as the title, so the order holds even when frames are slow
    if (this.vivid < this.vividTarget) this.vivid = Math.min(this.vividTarget, Math.max(this.vivid, (t - this.revivedAt - COLOUR_AFTER_S) / REVIVE_S));
    const bloomed = this.anchors.filter((a) => a.bloomed).length / this.anchors.length;
    const vividAll = Math.max(this.vivid, bloomed * 0.6);
    u.uVivid.value = this.vivid;
    u.uTime.value = t;
    u.uFadeIn.value = this.fadeIn;
    const pu = this.periphery.material.uniforms;
    pu.uVivid.value = vividAll;
    pu.uCore.value = this.vivid;
    pu.uFadeIn.value = this.fadeIn;
    if (this.splat) {
      this.splat.setVivid(this.vivid);
      this.splat.setBlooms(this.blooms.map((b, i) => ({
        position: this.anchors[i].group.getWorldPosition(new THREE.Vector3()),
        radius: (b.r / BLOOM_RADIUS) * SPLAT_BLOOM_M * b.w,
      })));
    }
    if (this.particles) {
      const pm = this.particles.material.uniforms;
      pm.uTime.value = t;
      pm.uScale.value = pointScale;
      pm.uOpacity.value = this.fadeIn * (0.25 + 0.75 * vividAll);
    }
    if (this.intro) {
      const shown = t - (this.enteredAt ?? t);
      this.intro.material.opacity = this.fadeIn * Math.max(0, Math.min(1, shown - 0.8) - Math.max(0, (shown - 6) / 1.5));
      this.intro.lookAt(headPos);
    }
    if (this.titleCard) {
      const k = t - this.revivedAt;
      const o = Math.min(1, Math.max(0, (k - TITLE_AFTER_S) / 1.2)) * (k > 9 ? Math.max(0.35, 1 - (k - 9) / 2) : 1);
      this.titleCard.material.opacity = o;
      this.titleCard.userData.shade.material.opacity = o * 0.6;
      this.titleCard.lookAt(headPos);
    }
    return done;
  }

  reset() {
    this.anchors.forEach((a, i) => {
      a.bloomed = false;
      a.dwell = 0;
      a.ring.material.uniforms.uOpacity.value = 0.9;
      a.question.material.opacity = 1;
      a.glow.scale.setScalar(0.22 * a.scale);
      this.blooms[i] = { r: 0, w: 0, active: false };
    });
    this.revived = false;
    this.vivid = 0;
    this.vividTarget = 0;
    if (this.titleCard) {
      this.group.remove(this.titleCard);
      disposeMesh(this.titleCard);
      this.titleCard = null;
    }
  }

  progress() {
    return { bloomed: this.anchors.filter((a) => a.bloomed).length, total: this.anchors.length };
  }

  dispose() {
    this.splat?.dispose();
    this.splat = null;
    this.viewPitch = 0;
    this.viewFov = 1;
    this.collider = null;
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      disposeMesh(child);
    }
    this.anchors = [];
    this.blooms = [];
    this.titleCard = null;
    this.intro = null;
    this.item = null;
    this.platePending = null;
  }
}

// Scene-aware environment colours for the periphery sphere: top (ceiling/sky),
// mid (walls/horizon), bot (floor/ground), and whether to draw stars.
// Hand-tuned environments for the sample memories, picked from the actual
// photos. The shader multiplies these for floor/wall/ceiling detail.
const ENV_OVERRIDES = {
  'morning-coffee': {
    // dark oak café table, warm brown walls, amber overhead lamp
    top: [0xD4, 0xA8, 0x6B, 0.50],
    mid: [0x8B, 0x68, 0x40, 0.40],
    bot: [0x5C, 0x3A, 0x22, 0.35],
    night: 0,
  },
  'the-cat': {
    // coastal cliff at golden hour, warm sunset sky, rocky ground
    top: [0xE8, 0xB8, 0x8A, 0.50],
    mid: [0xD4, 0x95, 0x6B, 0.40],
    bot: [0x5C, 0x6B, 0x4A, 0.25],
    night: 0,
  },
  'launch-night': {
    // clear starry night, milky way, dark rocky terrain
    top: [0x12, 0x18, 0x30, 0.35],
    mid: [0x20, 0x1C, 0x28, 0.15],
    bot: [0x18, 0x14, 0x10, 0.10],
    night: 1,
  },
};

function envColors(spec) {
  const c = (hex, s) => new THREE.Color(hex).multiplyScalar(s);
  const fromArr = ([r, g, b, s]) => new THREE.Color(r / 255, g / 255, b / 255).multiplyScalar(s);
  const ov = ENV_OVERRIDES[spec.id];
  if (ov) return { top: fromArr(ov.top), mid: fromArr(ov.mid), bot: fromArr(ov.bot), night: ov.night };
  // fallback for unknown memories: derive from palette and light
  const { light } = spec.scene;
  const palette = spec.palette;
  if (light === 'night') {
    return {
      top: c(palette[1] || '#1b2335', 0.35),
      mid: c(palette[4] || '#b89b6e', 0.2),
      bot: c(palette[0] || '#2b364f', 0.1),
      night: 1,
    };
  }
  return {
    top: c(palette[1] || '#c77f4b', 0.45),
    mid: c(palette[0] || '#916a4c', 0.3),
    bot: c(palette[4] || palette[2] || '#4d2f1a', 0.18),
    night: 0,
  };
}

// A sample can bring its own env.jpg; any other memory gets a panorama from
// the library, picked from its scene. No panorama at all (a failed load)
// leaves the palette's sky and ground in the shader.
async function loadSurroundings(item) {
  const own = item.base?.startsWith('/memories/') ? await loader.loadAsync(item.base + 'env.jpg').catch(() => null) : null;
  if (own) return { map: own, yaw: 0 };
  const name = pickEnvironment(item.spec.scene);
  const map = await loader.loadAsync(environmentUrl(name)).catch(() => null);
  return { map, yaw: ENVIRONMENTS[name]?.yaw ?? 0 };
}

function easeOut(x) {
  return 1 - Math.pow(1 - x, 3);
}
