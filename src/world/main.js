import * as THREE from 'three';
import '../shared/tokens.css';
import { applyBrand } from '../shared/brand.js';
import './world.css';
import { MSG, focusPeer } from '../shared/contract.js';
import { fileUrl, listMemories } from '../shared/memories.js';
import { joinRoom } from '../shared/room.js';
import { createAudio } from '../sound/soundscape.js';
import { DesktopInput } from './desktop-input.js';
import { Hub } from './hub.js';
import { Hud } from './hud.js';
import { MemoryScene } from './memory-scene.js';
import { PeerAvatars } from './presence.js';
import { Readout } from './readout.js';
import { Stage, xrSupported } from './stage.js';
import { loadFonts } from './text.js';
import { XRInput } from './xr-input.js';

applyBrand('darkroom');
const params = new URLSearchParams(location.search);
const IS_MIRROR = params.has('mirror');
const IS_PHONE = matchMedia('(pointer: coarse)').matches;
const NAME = (params.get('name') || (IS_MIRROR ? 'big screen' : 'visitor')).slice(0, 24);
// Feel of the print; tune these on the headset.
const DEVELOPED = 0.98; // develop level that counts as done
const SHAKE_STEP = 0.11; // added by each shake
const SELF_DEVELOP = 0.03; // added per second while held
const SHAKE_SPEED = 0.55; // m/s a controller must move for a reversal to count
const STEP_IN_M = 0.3; // print this close to the eyes steps in
const LINE_BELOW_EYES = 0.28; // m, where the line hangs in VR
// Stepping in: the print rises to the eye line and grows until its photo is
// all there is to see, while the paper flash takes over for the last part.
const RISE_S = 0.8; // s from the hand to filling the view
const FLASH_S = 0.3; // s of paper flash, ending with the rise
const RISE_M = 0.32; // m in front of the eyes where the print ends up
const RISE_GROW = 6; // times bigger at the end: its photo then overfills the view
const textureLoader = new THREE.TextureLoader();
const UP = new THREE.Vector3(0, 1, 0);

function yawOf(q) {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-f.x, -f.z);
}

function round(arr, d = 3) {
  const k = 10 ** d;
  return arr.map((v) => Math.round(v * k) / k);
}

class World {
  async start() {
    this.hud = new Hud(document.getElementById('hud'));
    this.hud.showLoading('Warming up the darkroom');
    this.stage = new Stage(document.getElementById('stage'));
    // early, so errors while loading are caught too
    if (params.has('debug')) this.readout = new Readout(this.stage.camera);
    this.audio = createAudio();
    this.hub = new Hub();
    this.stage.scene.add(this.hub.group);
    this.memory = new MemoryScene({ maxAnisotropy: this.stage.maxAnisotropy });
    this.memory.group.visible = false;
    this.stage.scene.add(this.memory.group);
    this.xr = new XRInput(this.stage);
    this.desk = new DesktopInput(this.stage, this.stage.renderer.domElement);
    this.avatars = new PeerAvatars(this.stage.scene);
    this.raycaster = new THREE.Raycaster();
    this.items = new Map();
    this.mode = 'hub';
    this.busy = false;
    this.held = null;
    this.t = 0;
    this.fade = { mesh: makeFadeSphere(), from: 0, to: 0, start: 0, dur: 0, resolve: null };
    this.stage.scene.add(this.fade.mesh);
    this.hubSound = null;
    this.memSound = null;
    this.mirrorPrint = null;

    await loadFonts();
    const [items, xrOk] = await Promise.all([listMemories(), xrSupported()]);
    this.xrOk = xrOk;
    await Promise.all(items.map((item) => this.addItem(item, false)));
    const role = IS_MIRROR ? 'mirror' : xrOk ? 'headset' : IS_PHONE ? 'phone' : 'desktop';
    this.room = await joinRoom({ name: NAME, role });
    this.bindRoom();
    this.syncRevived();
    this.setHubCamera();
    this.desk.setMode('look');

    const r = this.stage.renderer;
    r.xr.addEventListener('sessionstart', () => {
      this.stage.hasPose = false;
      this.needsPlacement = true;
      this.hud.hideXrOverlay(true);
    });
    r.xr.addEventListener('sessionend', () => {
      this.hud.hideXrOverlay(false);
      if (this.mode === 'hub') this.setHubCamera();
    });
    r.domElement.addEventListener('pointerdown', () => this.unlockAudio());

    this.hud.hideLoading();
    if (params.has('debug')) window.unfade = this;
    this.stage.start((dt, t) => {
      try {
        this.frame(dt, t);
      } finally {
        // also after a frame that threw, so its error reaches the readout
        this.readout?.update(this.stage.renderer.info.render, this.stage.presenting);
      }
    });
    const direct = params.get('memory');
    if (direct && this.items.has(direct)) this.openDirect(direct);
  }

  async addItem(item, animate) {
    if (this.items.has(item.spec.id)) return;
    this.items.set(item.spec.id, item);
    const tex = await textureLoader.loadAsync(fileUrl(item, 'thumb')).catch(() => null);
    if (!tex) return;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.stage.maxAnisotropy;
    const print = this.hub.addPrint(item, tex);
    if (!animate) print.group.position.copy(print.slot);
    this.syncRevived();
  }

  // ---- room ---------------------------------------------------------------

  bindRoom() {
    const room = this.room;
    room.on('state', () => {
      this.syncRevived();
      if (this.mode === 'memory') this.applyStoredState();
    });
    room.on(MSG.ANCHOR_BLOOM, (msg) => this.onBloom(msg.data));
    room.on(MSG.NOTE_ADD, (msg) => {
      const d = msg.data;
      if (this.mode === 'memory' && d.memoryId === this.memory.spec?.id) this.memory.addNote(d.anchorId, d.text, d.author);
    });
    room.on(MSG.ANCHOR_NUDGE, (msg) => {
      if (this.mode === 'memory' && msg.data.memoryId === this.memory.spec?.id) this.memory.nudge(msg.data.anchorId);
    });
    room.on(MSG.MEMORY_OPEN, (msg) => {
      if (!IS_MIRROR && this.items.has(msg.data.memoryId)) this.openDirect(msg.data.memoryId);
    });
    room.on(MSG.MEMORY_RESET, (msg) => {
      const id = msg.data.memoryId;
      if (this.mode === 'memory' && (!id || id === this.memory.spec?.id)) {
        this.memory.reset();
        this.memSound?.setVivid(0);
      }
      this.syncRevived();
    });
    room.on(MSG.MEMORY_ADDED, (msg) => {
      this.addItem(msg.data, true).then(() => this.audio.oneShot('unclip'));
    });
  }

  anchorIds(spec) {
    return spec.anchors.length ? spec.anchors.map((a) => a.id) : ['center'];
  }

  syncRevived() {
    const blooms = this.room?.state.blooms || {};
    for (const print of this.hub.prints) {
      const done = blooms[print.id] || [];
      const revived = this.anchorIds(print.item.spec).every((id) => done.includes(id));
      if (!print.held && print.revived !== revived) print.setRevived(revived);
    }
  }

  applyStoredState() {
    const id = this.memory.spec.id;
    for (const anchorId of this.room.state.blooms[id] || []) this.memory.bloom(anchorId, this.t - 10);
    if (this.memory.revived) this.memory.vivid = 1;
    for (const n of this.room.state.notes[id] || []) this.memory.addNote(n.anchorId, n.text, n.author);
    this.memSound?.setVivid(this.memory.vivid);
  }

  onBloom({ memoryId, anchorId }) {
    if (this.mode !== 'memory' || memoryId !== this.memory.spec?.id) {
      this.syncRevived();
      return;
    }
    const wasRevived = this.memory.revived;
    if (!this.memory.bloom(anchorId, this.t)) return;
    const marker = this.memory.anchors.find((a) => a.id === anchorId);
    this.audio.oneShot('bloom');
    if (marker?.anchor.sound && marker.anchor.sound !== 'none') this.memSound?.swell(marker.anchor.sound);
    for (const h of this.xr.hands) this.xr.pulse(h, 0.35, 60);
    const p = this.memory.progress();
    this.memSound?.setVivid(this.memory.revived ? 1 : (p.bloomed / p.total) * 0.6);
    if (this.memory.revived && !wasRevived) {
      this.audio.oneShot('revive');
      // the sound swells first; the colour and then the title follow it (memory-scene.js)
      const layers = this.memory.spec.scene.soundLayers;
      for (const layer of layers.length ? layers : ['room_tone']) this.memSound?.swell(layer);
      this.syncRevived();
    }
  }

  // ---- frame --------------------------------------------------------------

  frame(dt, t) {
    this.t = t;
    const presenting = this.stage.presenting;
    let pointers = [];
    const actions = { back: false, stepIn: false, shake: 0, reset: false };
    if (presenting) {
      if (this.needsPlacement) this.placeForHeadset();
      pointers = this.xr.frame(dt);
      actions.back = pointers.some((p) => p.secondaryPressed);
      actions.stepIn = pointers.some((p) => p.primaryPressed);
    } else if (!IS_MIRROR) {
      const d = this.desk.frame(dt);
      pointers = d.pointers;
      Object.assign(actions, { back: d.back, stepIn: d.stepIn, shake: d.shake, reset: d.reset });
    } else {
      this.mirrorFrame(dt);
    }
    const head = this.stage.head();
    if (actions.reset) this.room.send(MSG.MEMORY_RESET, { memoryId: null });

    if (this.mode === 'hub') this.hubFrame(dt, t, head, pointers, actions, presenting);
    else this.memoryFrame(dt, t, head, pointers, actions);

    this.updateFade(t, head);
    if (!IS_MIRROR) this.sendPresence(head, pointers, presenting);
    const space = this.mode === 'memory' ? this.memory.group : this.hub.group;
    this.avatars.update(dt, this.room.peers, {
      space: this.mode,
      memoryId: this.memory.spec?.id,
      toWorld: (arr) => new THREE.Vector3(...arr).applyMatrix4(space.matrixWorld),
      viewer: head.position,
      ignoreRoles: ['mirror', 'guide', 'studio'],
      // the mirror looks out of its target's eyes, so it must not draw them
      ignoreIds: IS_MIRROR && this.mirrorTarget ? [this.mirrorTarget] : [],
    });
    this.avatars.faceLabels(head.position);
    if (!presenting && t - (this.lastHud || 0) > 0.2) {
      this.lastHud = t;
      this.refreshHud();
    }
  }

  placeForHeadset() {
    const head = this.stage.head();
    if (!this.stage.hasPose) return;
    this.needsPlacement = false;
    if (this.mode === 'hub') {
      this.hub.place(head.position, yawOf(head.quaternion));
      this.hub.setLine(head.position.y - LINE_BELOW_EYES);
    } else {
      this.memory.placeAt(head.position, yawOf(head.quaternion));
    }
  }

  setHubCamera() {
    this.hub.place(new THREE.Vector3(), 0);
    this.hub.setLine(1.35);
    const portrait = innerWidth < innerHeight;
    this.desk.setOrigin(new THREE.Vector3(0, 1.5, portrait ? 0.55 : 0.05), 0, portrait ? -0.16 : -0.2);
    this.desk.setMode(this.held ? 'shake' : 'look');
  }

  hubFrame(dt, t, head, pointers, actions, presenting) {
    let hovered = null;
    if (this.held?.rising) {
      this.updateRise(t, head);
    } else if (this.held) {
      this.updateHeld(dt, t, head, pointers, actions, presenting);
    } else {
      for (const p of pointers) {
        this.raycaster.set(p.origin, p.direction);
        const hit = this.hub.pick(this.raycaster);
        if (p.hand) this.xr.setRay(p.hand, hit?.distance);
        if (!hit) continue;
        hovered = hit.print;
        if (p.selectPressed && !this.busy) {
          this.pickUp(hit.print, p);
          break;
        }
      }
    }
    this.hub.update(dt, t, hovered);
    this.hub.dust && (this.hub.dust.material.uniforms.uScale.value = this.pointScale());
    if (presenting && !this.held?.rising) {
      const developed = this.held && this.held.print.develop >= DEVELOPED;
      this.hub.hint(this.held ? (developed ? 'Hold it up to your eyes' : 'Shake it') : 'Point at a photo and pull the trigger');
    } else this.hub.hint('');
  }

  pickUp(print, pointer) {
    this.unlockAudio();
    this.audio.oneShot('unclip');
    this.hub.take(print, this.stage.scene);
    this.held = { print, hand: pointer.hand || null, lastDir: null, lastTick: 0, chimed: print.develop >= DEVELOPED };
    this.desk.setMode('shake');
    if (pointer.hand) this.xr.pulse(pointer.hand, 0.6, 40);
    this.preload = this.memory.load(this.items.get(print.id)).catch((err) => {
      console.error('could not load memory', err);
      return null;
    });
  }

  updateHeld(dt, t, head, pointers, actions, presenting) {
    const h = this.held;
    const print = h.print;
    const g = print.group;
    let shakes = actions.shake;
    let enter = false;
    let putBack = actions.back;

    const ptr = presenting ? pointers.find((p) => p.hand === h.hand) : null;
    if (ptr) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ptr.gripQuat);
      g.position.lerp(ptr.gripPos.clone().addScaledVector(fwd, 0.08).addScaledVector(UP, 0.03), Math.min(1, dt * 25));
      const speed = ptr.velocity.length();
      if (speed > SHAKE_SPEED) {
        const dir = ptr.velocity.clone().normalize();
        if (h.lastDir && dir.dot(h.lastDir) < -0.2 && t - h.lastTick > 0.08) {
          shakes++;
          h.lastTick = t;
        }
        h.lastDir = dir;
      }
      if (print.develop >= DEVELOPED && (g.position.distanceTo(head.position) < STEP_IN_M || ptr.selectPressed)) enter = true;
      if (ptr.squeezePressed) putBack = true;
    } else {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(head.quaternion);
      const down = new THREE.Vector3(0, -1, 0).applyQuaternion(head.quaternion);
      g.position.lerp(head.position.clone().addScaledVector(fwd, 0.42).addScaledVector(down, -0.005), Math.min(1, dt * 10));
      const clicked = pointers.some((p) => p.selectPressed);
      if (print.develop >= DEVELOPED && (clicked || actions.stepIn)) enter = true;
    }
    g.lookAt(head.position);
    g.rotateZ(Math.sin(t * 1.5) * 0.02);
    if (presenting && actions.stepIn && print.develop >= DEVELOPED) enter = true;

    if (shakes > 0) {
      print.setDevelop(print.develop + SHAKE_STEP * shakes);
      this.audio.oneShot('tick');
      if (h.hand) this.xr.pulse(h.hand, 0.4, 25);
    }
    print.setDevelop(print.develop + dt * SELF_DEVELOP);
    if (!h.chimed && print.develop >= DEVELOPED) {
      h.chimed = true;
      this.audio.oneShot('developed');
      if (h.hand) this.xr.pulse(h.hand, 0.8, 120);
    }
    if (enter) this.enterFromPrint(print);
    else if (putBack) this.putBack();
  }

  // Only the print and the fade move; the camera stays with the head.
  updateRise(t, head) {
    const { print, rising } = this.held;
    const g = print.group;
    const u = Math.min(1, (t - rising.start) / RISE_S);
    // lifted and turned upright quickly, then growing late and fast: a fall more than a lift
    const k = 1 - (1 - u) ** 3;
    const s = 1 + (RISE_GROW - 1) * u * u * u;
    const yaw = yawOf(head.quaternion);
    const ahead = new THREE.Vector3(0, 0, -1).applyAxisAngle(UP, yaw);
    // straight ahead at eye height, where the memory's photo will be
    const end = head.position.clone().addScaledVector(ahead, RISE_M);
    end.y -= print.image.position.y * s;
    g.position.lerpVectors(rising.from, end, k);
    g.quaternion.slerpQuaternions(rising.turn, new THREE.Quaternion().setFromAxisAngle(UP, yaw), k);
    g.scale.setScalar(s);
  }

  putBack() {
    if (this.held.rising) return;
    const { print } = this.held;
    this.hub.giveBack(print);
    if (!print.revived) print.setDevelop(Math.max(0.3, Math.min(print.develop, 0.3)));
    this.held = null;
    this.desk.setMode('look');
  }

  async enterFromPrint(print) {
    if (this.busy) return;
    this.busy = true;
    this.audio.oneShot('step-in');
    this.held.rising = { start: this.t, from: print.group.position.clone(), turn: print.group.quaternion.clone() };
    print.setOnTop(true);
    await this.fadeTo(1, FLASH_S, '#f1e9dc', RISE_S - FLASH_S);
    const loaded = await this.preload;
    print.setOnTop(false);
    print.group.scale.setScalar(1);
    this.hub.giveBack(print);
    // straight onto its peg, not falling from where the rise left it
    print.group.position.copy(print.slot);
    this.held = null;
    if (!loaded) {
      this.desk.setMode('look');
      await this.fadeTo(0, 0.4);
      this.busy = false;
      return;
    }
    this.showMemory();
    await this.fadeTo(0, 1.2);
    this.busy = false;
  }

  // Open a memory without the print: from the guide, a link, or the mirror.
  async openDirect(memoryId) {
    if (this.busy) return;
    if (this.mode === 'memory' && this.memory.spec?.id === memoryId) return;
    this.busy = true;
    if (this.held) this.putBack();
    await this.fadeTo(1, 0.5, '#f1e9dc');
    try {
      await this.memory.load(this.items.get(memoryId));
      this.showMemory();
    } catch (err) {
      console.error('could not open memory', err);
    }
    await this.fadeTo(0, 1.0);
    this.busy = false;
  }

  showMemory() {
    const head = this.stage.head();
    const yaw = yawOf(head.quaternion);
    if (IS_MIRROR) this.memory.placeAt(new THREE.Vector3(0, 1.6, 0), 0);
    else this.memory.placeAt(head.position, yaw);
    this.memory.group.updateMatrixWorld(true);
    this.hub.setVisible(false);
    this.memory.group.visible = true;
    this.memory.fadeIn = 1;
    this.memory.enteredAt = this.t;
    this.mode = 'memory';
    if (!this.stage.presenting && !IS_MIRROR) {
      this.desk.setOrigin(head.position, yaw, 0);
      this.desk.setMode('look', { allowMove: true });
    }
    this.hubSound?.stop(1.5);
    this.hubSound = null;
    if (this.audio.ready) this.memSound = this.audio.scene(this.memory.spec.scene.soundLayers);
    this.applyStoredState();
  }

  memoryFrame(dt, t, head, pointers, actions) {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(head.quaternion);
    const rays = [{ origin: head.position.clone(), direction: forward }, ...pointers.map((p) => ({ origin: p.origin, direction: p.direction }))];
    const done = this.memory.update(dt, t, head.position, rays, this.pointScale());
    const id = this.memory.spec.id;
    for (const anchorId of done) this.room.send(MSG.ANCHOR_BLOOM, { memoryId: id, anchorId });
    for (const p of pointers) {
      if (p.hand) this.xr.setRay(p.hand, null);
      if (!p.selectPressed) continue;
      const target = this.memory.anchors.find((a) => !a.bloomed && a.angleFrom(p.origin, p.direction) < 8);
      if (target) this.room.send(MSG.ANCHOR_BLOOM, { memoryId: id, anchorId: target.id });
    }
    if (actions.back && !IS_MIRROR) this.leaveMemory();
  }

  async leaveMemory() {
    if (this.busy) return;
    this.busy = true;
    this.audio.oneShot('leave');
    await this.fadeTo(1, 0.6, '#0c0907');
    this.memory.group.visible = false;
    this.hub.setVisible(true);
    this.mode = 'hub';
    this.memSound?.stop(1);
    this.memSound = null;
    this.startHubSound();
    if (this.stage.presenting) this.needsPlacement = true;
    else if (!IS_MIRROR) this.setHubCamera();
    this.syncRevived();
    await this.fadeTo(0, 0.8);
    this.busy = false;
  }

  // ---- mirror (big screen follows the headset) ----------------------------

  mirrorFrame(dt) {
    const target = focusPeer(this.room.peers);
    this.mirrorTarget = target?.peerId || null;
    const cam = this.stage.camera;
    if (!target) {
      this.hud.setMirror({ who: 'Waiting for the headset', title: '', bloomed: 0, total: 0 });
      cam.position.set(Math.sin(this.t * 0.1) * 0.15, 1.5, 0.1);
      cam.lookAt(0, 1.25, -0.85);
      return;
    }
    const p = target.presence;
    if (!this.busy) {
      if (p.space === 'memory' && p.memoryId && (this.mode !== 'memory' || this.memory.spec?.id !== p.memoryId) && this.items.has(p.memoryId)) this.openDirect(p.memoryId);
      else if (p.space === 'hub' && this.mode === 'memory') this.leaveMemory();
    }
    // Follow only while both are in the same place: while one changes place its
    // pose belongs to the other space, and reading it in this one sends the
    // camera into the floor. Hold still under the fade instead.
    const here = p.space === this.mode && (p.space === 'hub' || p.memoryId === this.memory.spec?.id);
    if (here) {
      const space = this.mode === 'memory' ? this.memory.group : this.hub.group;
      space.updateMatrixWorld(true);
      const pos = new THREE.Vector3(...p.head.p).applyMatrix4(space.matrixWorld);
      const q = new THREE.Quaternion(...p.head.q).premultiply(space.getWorldQuaternion(new THREE.Quaternion()));
      // behind a full fade go straight there; otherwise ease, the same at any frame rate
      const hidden = this.fade.mesh.material.opacity > 0.95;
      cam.position.lerp(pos, hidden ? 1 : 1 - Math.exp(-dt * 8));
      cam.quaternion.slerp(q, hidden ? 1 : 1 - Math.exp(-dt * 6));
      this.mirrorHeld(p, space);
    }
    const name = target.name || 'the headset';
    const prog = this.mode === 'memory' ? this.memory.progress() : { bloomed: 0, total: 0 };
    const title = this.mode === 'memory' ? this.memory.spec?.title : p.held ? this.items.get(p.held.memoryId)?.spec.title : '';
    this.hud.setMirror({ who: this.mode === 'memory' ? `${name} is inside` : `${name} is in the darkroom`, title, ...prog });
  }

  mirrorHeld(p, space) {
    const print = p.held && this.hub.prints.find((x) => x.id === p.held.memoryId);
    if (this.mirrorPrint && this.mirrorPrint !== print) {
      this.hub.giveBack(this.mirrorPrint);
      this.mirrorPrint = null;
    }
    if (!print || this.mode !== 'hub') return;
    if (!this.mirrorPrint) {
      this.hub.take(print, this.stage.scene);
      this.mirrorPrint = print;
    }
    const hand = p.hands?.r || p.hands?.l;
    const at = hand ? new THREE.Vector3(...hand).applyMatrix4(space.matrixWorld) : new THREE.Vector3(0, -0.05, -0.4).applyMatrix4(this.stage.camera.matrixWorld);
    print.group.position.lerp(at, 0.3);
    print.group.lookAt(this.stage.camera.position);
    print.setDevelop(p.held.develop);
  }

  // ---- presence -------------------------------------------------------------

  sendPresence(head, pointers, presenting) {
    if (!this.room) return;
    const space = this.mode === 'memory' ? this.memory.group : this.hub.group;
    const inv = space.getWorldQuaternion(new THREE.Quaternion()).invert();
    const local = (v) => round(space.worldToLocal(v.clone()).toArray());
    const hands = {};
    for (const p of pointers) if (p.gripPos && p.handedness) hands[p.handedness === 'left' ? 'l' : 'r'] = local(p.gripPos);
    this.room.presence({
      space: this.mode,
      memoryId: this.mode === 'memory' ? this.memory.spec.id : null,
      head: { p: local(head.position), q: round(head.quaternion.clone().premultiply(inv).toArray(), 4) },
      hands,
      held: this.held ? { memoryId: this.held.print.id, develop: Math.round(this.held.print.develop * 100) / 100 } : null,
      mode: presenting ? 'xr' : IS_PHONE ? 'phone' : 'desktop',
    });
  }

  pointScale() {
    return this.stage.presenting ? 950 : this.stage.renderer.domElement.height / 2;
  }

  // ---- fades, sound, overlay ------------------------------------------------

  fadeTo(to, seconds, color, delay = 0) {
    const f = this.fade;
    if (color) f.mesh.material.color.set(color);
    f.from = f.mesh.material.opacity;
    f.to = to;
    f.start = this.t + delay;
    f.dur = seconds;
    f.resolve?.();
    return new Promise((resolve) => (f.resolve = resolve));
  }

  updateFade(t, head) {
    const f = this.fade;
    f.mesh.position.copy(head.position);
    if (!f.resolve) return;
    const k = f.dur > 0 ? Math.min(1, Math.max(0, (t - f.start) / f.dur)) : 1;
    f.mesh.material.opacity = f.from + (f.to - f.from) * k * k * (3 - 2 * k);
    f.mesh.visible = f.mesh.material.opacity > 0.001;
    if (k >= 1) {
      const r = f.resolve;
      f.resolve = null;
      r();
    }
  }

  unlockAudio() {
    if (this.audio.ready) return;
    if (!this.audio.unlock()) return;
    if (this.mode === 'hub') this.startHubSound();
    else this.memSound = this.audio.scene(this.memory.spec.scene.soundLayers);
  }

  startHubSound() {
    if (this.audio.ready && !this.hubSound) this.hubSound = this.audio.ambience(['room_tone', 'drips'], { gain: 0.45 });
  }

  async enterXR() {
    this.unlockAudio();
    try {
      await this.stage.enterXR();
    } catch (err) {
      this.hud.hint(`Could not start VR: ${err.message}`);
    }
  }

  refreshHud() {
    const peers = this.room ? this.room.peers.size : 0;
    this.hud.setStatus([
      this.room ? `room ${this.room.room}` : '',
      peers ? `${peers + 1} here` : '',
      this.room?.kind === 'ws' ? 'live' : 'this device only',
    ]);
    if (IS_MIRROR) {
      this.hud.hint('');
      this.hud.setButtons([]);
      return;
    }
    const buttons = [];
    let hint = '';
    if (this.mode === 'hub') {
      if (this.held) {
        const developed = this.held.print.develop >= DEVELOPED;
        hint = developed
          ? (IS_PHONE ? 'Tap the photo to step inside' : 'Click the photo to step inside')
          : IS_PHONE ? (this.desk.motion ? 'Shake your phone' : 'Swipe side to side to shake it') : 'Shake it: drag side to side, or tap space';
        if (developed) buttons.push({ label: 'Step inside', onClick: () => this.enterFromPrint(this.held.print) });
        buttons.push({ label: 'Put it back', kind: 'ghost', onClick: () => this.putBack() });
      } else {
        hint = this.hub.prints.length ? 'Pick a photo off the line' : 'No memories yet. Make one in the studio.';
        if (this.xrOk) buttons.push({ label: 'Step into the darkroom', note: 'Meta Quest', onClick: () => this.enterXR() });
      }
    } else {
      const p = this.memory.progress();
      hint = this.memory.revived ? 'It is back.' : `Look at the lights to bring it back · ${p.bloomed} of ${p.total}`;
      buttons.push({ label: 'Back to the darkroom', kind: 'ghost', onClick: () => this.leaveMemory() });
    }
    if (IS_PHONE && !this.desk.motion && !this.stage.presenting) {
      buttons.push({ label: 'Use motion', kind: 'ghost', onClick: () => this.desk.enableMotion() });
    }
    this.hud.hint(hint);
    this.hud.setButtons(buttons);
  }
}

function makeFadeSphere() {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 24, 16),
    new THREE.MeshBasicMaterial({ color: '#0c0907', transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false }),
  );
  mesh.renderOrder = 9999;
  mesh.visible = false;
  mesh.frustumCulled = false;
  return mesh;
}

new World().start().catch((err) => {
  console.error(err);
  const el = document.querySelector('.hud-loading p');
  if (el) el.textContent = `Something went wrong: ${err.message}`;
});
