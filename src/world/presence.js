import * as THREE from 'three';
import { FONTS, disposeMesh, makeGlow, makeText } from './text.js';

// Other people in the same room, drawn as soft lights where their head and
// hands are. Poses arrive in the shared space's own coordinates (the
// darkroom, or the memory), so everyone agrees where things are.
export class PeerAvatars {
  constructor(scene) {
    this.scene = scene;
    this.avatars = new Map();
  }

  // toWorld(localArray) -> Vector3, for the space this viewer is in now.
  update(dt, peers, { space, memoryId, toWorld, ignoreRoles = [], ignoreIds = [] }) {
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
      const head = toWorld(p.head.p);
      // keep a little apart when two people stand on the same spot
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
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 14), new THREE.MeshBasicMaterial({ color: '#ffe9c9', transparent: true, opacity: 0.85 }));
    group.add(core);
    group.add(makeGlow('#f0a35e', 0.55, 0.7));
    const label = makeText(peer.name || 'someone', { font: FONTS.mono(36, 500), px: 36, lineHeightM: 0.035, maxChars: 18 });
    label.position.y = 0.16;
    group.add(label);
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
