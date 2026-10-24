import * as THREE from 'three';
import { ringMaterial } from './shaders.js';
import { FONTS, disposeMesh, makeGlow, makeText } from './text.js';

const DWELL_S = 1.1;
const LOOK_DEG = 7;

// A soft light at a spot worth remembering, with its question written above.
// Looking at it (or pointing and pulling the trigger) brings it back.
export class AnchorMarker {
  constructor(anchor, localPos) {
    this.anchor = anchor;
    this.id = anchor.id;
    this.group = new THREE.Group();
    this.group.position.copy(localPos);
    // same apparent size at any distance (1.5 m reference)
    this.scale = Math.min(3, Math.max(0.6, localPos.length() / 1.5));

    this.glow = makeGlow('#f0a35e', 0.22 * this.scale, 0.85);
    this.group.add(this.glow);

    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.06, 64), ringMaterial('#f1e9dc'));
    this.ring.scale.setScalar(this.scale);
    this.group.add(this.ring);

    this.question = makeText(anchor.question, { font: FONTS.hand(64, 600), lineHeightM: 0.042 * this.scale, maxChars: 24 });
    this.question.position.y = 0.11 * this.scale + this.question.userData.size.height / 2;
    this.group.add(this.question);
    // the spot sits on the photo's surface; draw its light and words on top
    // so nearer parts of the photo never cut them off
    for (const o of [this.glow, this.ring, this.question]) onTop(o);

    this.notes = [];
    this.dwell = 0;
    this.bloomed = false;
    this.bloomAt = 0;
    this.now = 0;
    this.nudge = 0;
    this._world = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  worldPosition() {
    return this.group.getWorldPosition(this._world);
  }

  // Degrees between a ray and the direction to this anchor.
  angleFrom(origin, direction) {
    this._dir.copy(this.worldPosition()).sub(origin).normalize();
    return THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.max(-1, this._dir.dot(direction)))));
  }

  isLookedAt(origin, direction) {
    return !this.bloomed && this.angleFrom(origin, direction) < LOOK_DEG;
  }

  // Returns true on the frame the look completes.
  update(dt, t, headPos, looked) {
    this.now = t;
    this.group.lookAt(headPos);
    for (const n of this.notes) {
      const from = Math.max(n.userData.addedAt, this.bloomed ? this.bloomAt + 0.6 : Infinity);
      n.material.opacity = Math.min(1, Math.max(0, (t - from) / 1.2));
    }
    if (this.bloomed) {
      const k = Math.min(1, (t - this.bloomAt) / 1.6);
      this.glow.material.opacity = 0.85 * (1 - k) + 0.12;
      this.glow.scale.setScalar(0.22 * this.scale * (1 + k * 1.5));
      this.ring.material.uniforms.uOpacity.value = 0.9 * (1 - k);
      this.question.material.opacity = 1 - 0.6 * k;
      return false;
    }
    this.nudge = Math.max(0, this.nudge - dt);
    const pulse = 0.75 + 0.25 * Math.sin(t * 2.4 + this.anchor.x * 10) + this.nudge * 0.6;
    this.glow.material.opacity = Math.min(1, 0.65 * pulse);
    this.dwell = looked ? this.dwell + dt : Math.max(0, this.dwell - dt * 2);
    this.ring.material.uniforms.uProgress.value = Math.min(1, this.dwell / DWELL_S);
    return this.dwell >= DWELL_S;
  }

  bloom(t) {
    if (this.bloomed) return;
    this.bloomed = true;
    this.bloomAt = t;
    this.ring.material.uniforms.uProgress.value = 1;
  }

  // A note is the person's own words; it writes in once the spot is back.
  addNote(text, author) {
    const body = author ? `${text}\n${author}` : text;
    const note = makeText(body, { font: FONTS.hand(64, 500), lineHeightM: 0.036 * this.scale, maxChars: 26, color: '#ffe9c9' });
    const below = this.notes.reduce((h, n) => h + n.userData.size.height + 0.01 * this.scale, 0);
    note.position.y = -0.09 * this.scale - below - note.userData.size.height / 2;
    note.material.opacity = 0;
    note.userData.addedAt = this.now;
    onTop(note);
    this.notes.push(note);
    this.group.add(note);
  }

  pulse() {
    this.nudge = 1.5;
  }

  dispose() {
    disposeMesh(this.group);
  }
}

function onTop(obj) {
  obj.material.depthTest = false;
  obj.renderOrder = 20;
}
