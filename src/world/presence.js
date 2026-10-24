import * as THREE from 'three';
import { FONTS, disposeMesh, makeGlow, makeText } from './text.js';

// Everyone inside a memory stands where its camera stood, so another person
// is usually on your own spot. Nearer than this, their light slides out along
// where they look: you see what they are looking at, not a glow in your eyes.
const NEAR_M = 0.5;

// Other people in the same room, drawn as soft lights where their head and
// hands are. Poses arrive in the shared space's own coordinates (the
// darkroom, or the memory), so everyone agrees where things are.
export class PeerAvatars {
  constructor(scene) {
    this.scene = scene;
    this.avatars = new Map();
  }

  // toWorld(localArray) -> Vector3, for the space this viewer is in now.
  update(dt, peers, { space, memoryId, toWorld, viewer, ignoreRoles = [], ignoreIds = [] }) {
    const seen = new Set();
    for (const [peerId, peer] of peers) {
      const p = peer.presence;
      if (!p?.head || ignoreRoles.includes(peer.role) || ignoreIds.includes(peerId)) continue;
      if (p.space !== space || (space === 'memory' && p.memoryId !== memoryId)) continue;
      seen.add(peerId);
      let a = this.avatars.get(peerId);
      if (!a) {
        a = this.make(peer);
        this.avatars.set(peerId, a);
      }
      let head = toWorld(p.head.p);
      const gap = viewer ? NEAR_M - head.distanceTo(viewer) : 0;
      if (gap > 0) {
        const gaze = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(...p.head.q));
        head = toWorld(gaze.multiplyScalar(gap).add(new THREE.Vector3(...p.head.p)).toArray());
      }
      if (a.group.position.lengthSq() === 0) a.group.position.copy(head);
      a.group.position.lerp(head, Math.min(1, dt * 12));
      ['l', 'r'].forEach((side, i) => {
        const hp = p.hands?.[side];
        a.hands[i].visible = Boolean(hp);
        if (hp) a.hands[i].position.lerp(toWorld(hp).sub(a.group.position), Math.min(1, dt * 12));
      });
    }
    for (const [peerId, a] of this.avatars) {
      if (!seen.has(peerId)) {
        this.scene.remove(a.group);
        disposeMesh(a.group);
        this.avatars.delete(peerId);
      }
    }
  }

  make(peer) {
    const group = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 14), new THREE.MeshBasicMaterial({ color: '#ffe9c9', transparent: true, opacity: 0.8 }));
    group.add(core);
    group.add(makeGlow('#f0a35e', 0.32, 0.75));
    const label = makeText(peer.name || 'someone', { font: FONTS.mono(36, 500), px: 36, lineHeightM: 0.035, maxChars: 18 });
    label.position.y = 0.11;
    group.add(label);
    // a person is never hidden inside the photo they share
    for (const o of [core, group.children[1], label]) {
      o.material.depthTest = false;
      o.renderOrder = 15;
    }
    const hands = [0, 1].map(() => {
      const h = makeGlow('#ffd9a8', 0.12, 0.8);
      h.visible = false;
      group.add(h);
      return h;
    });
    this.scene.add(group);
    return { group, hands, label };
  }

  faceLabels(headPos) {
    for (const a of this.avatars.values()) a.label.lookAt(headPos);
  }
}
