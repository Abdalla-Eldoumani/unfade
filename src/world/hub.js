import * as THREE from 'three';
import { Print } from './print.js';
import { makeParticles } from './particles.js';
import { FONTS, disposeMesh, makeGlow, makeText } from './text.js';

const SPACING = 0.27;
const PER_LINE = 6;

// The darkroom: a dim warm room, a red safelight on the far wall, and a
// drying line with every memory clipped to it as a faded print.
export class Hub {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'hub';
    this.prints = [];
    this.lineY = 1.35;
    this.lineZ = -0.85;

    const room = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.4, 3.2, 48, 1, true),
      new THREE.MeshStandardMaterial({ color: '#1a1310', roughness: 1, side: THREE.BackSide }),
    );
    room.position.y = 1.6;
    this.group.add(room);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.4, 48),
      new THREE.MeshStandardMaterial({ color: '#120d0a', roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);

    // lit by the safelight too, so the wall does not end in a hard black rim
    const ceiling = new THREE.Mesh(new THREE.CircleGeometry(3.4, 48), new THREE.MeshStandardMaterial({ color: '#140e0b', roughness: 1 }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 3.2;
    this.group.add(ceiling);

    // Safelight: the only real light, deep amber-red, on the far wall: a dark
    // housing with a glowing filter set into it.
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.12), new THREE.MeshStandardMaterial({ color: '#1c1410', roughness: 0.6 }));
    housing.position.set(0, 2.25, -3.3);
    this.group.add(housing);
    const lamp = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.22), new THREE.MeshBasicMaterial({ color: '#d9472b' }));
    lamp.position.set(0, 2.25, -3.235);
    this.group.add(lamp);

    // A bench with three developing trays under the line.
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.55), new THREE.MeshStandardMaterial({ color: '#2a1e18', roughness: 0.85 }));
    bench.position.set(0, 0.82, -1.25);
    this.group.add(bench);
    const trayMat = new THREE.MeshStandardMaterial({ color: '#3b2f29', roughness: 0.5 });
    const liquidMat = new THREE.MeshStandardMaterial({ color: '#070606', roughness: 0.08, metalness: 0.2 });
    [-0.52, 0, 0.52].forEach((x) => {
      const tray = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.34), trayMat);
      tray.position.set(x, 0.87, -1.25);
      const liquid = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), liquidMat);
      liquid.rotation.x = -Math.PI / 2;
      liquid.position.set(x, 0.887, -1.25);
      this.group.add(tray, liquid);
    });
    this.lampGlow = makeGlow('#ff5a36', 2.2, 0.55);
    this.lampGlow.position.set(0, 2.25, -3.15);
    this.group.add(this.lampGlow);
    this.safelight = new THREE.PointLight('#ff4a2a', 9, 9, 1.6);
    this.safelight.position.set(0, 2.2, -2.9);
    this.group.add(this.safelight);
    this.group.add(new THREE.HemisphereLight('#3a1f17', '#050302', 0.9));
    // a warm lamp over the line, so the prints are the warmest, brightest
    // thing in the room and the red stays at the far wall
    const front = new THREE.PointLight('#ffcf9e', 1.5, 4, 2);
    front.position.set(0, 2.05, -0.15);
    this.group.add(front);

    this.line = new THREE.Group();
    this.group.add(this.line);
    // a soft amber halo behind the prints, so they read against the dark
    this.lineGlow = makeGlow('#ffb070', 3.4, 0.14);
    this.lineGlow.position.z = -0.3;
    this.line.add(this.lineGlow);
    this.lineMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0025, 0.0025, 1, 6),
      new THREE.MeshStandardMaterial({ color: '#8a7a6a', roughness: 0.7 }),
    );
    this.lineMesh.rotation.z = Math.PI / 2;
    this.line.add(this.lineMesh);

    this.dust = makeParticles('dust', []);
    if (this.dust) {
      this.dust.material.uniforms.uOpacity.value = 0.35;
      this.dust.material.uniforms.uColors.value.forEach((c) => c.set('#ff8a5c'));
      this.group.add(this.dust);
    }

    this.hintMesh = null;
    this.setLine(this.lineY);
  }

  // Move the line to suit the person's height (seated or standing).
  setLine(y) {
    this.lineY = Math.min(1.5, Math.max(0.95, y));
    this.line.position.set(0, this.lineY, this.lineZ);
    this.layout();
    if (this.hintMesh) this.hintMesh.position.set(0, this.lineY + 0.2, this.lineZ);
  }

  place(position, yaw) {
    this.group.position.set(position.x, 0, position.z);
    this.group.rotation.set(0, yaw, 0);
  }

  hint(text) {
    if (this.hintText === text) return;
    this.hintText = text;
    if (this.hintMesh) {
      this.group.remove(this.hintMesh);
      disposeMesh(this.hintMesh);
      this.hintMesh = null;
    }
    if (!text) return;
    this.hintMesh = makeText(text, { font: FONTS.hand(64, 500), lineHeightM: 0.055, maxChars: 34 });
    // above the line, where nothing hangs and the bench cannot hide it
    this.hintMesh.position.set(0, this.lineY + 0.2, this.lineZ);
    this.hintMesh.material.opacity = 0.85;
    this.group.add(this.hintMesh);
  }

  addPrint(item, texture) {
    const print = new Print(item, texture);
    this.prints.push(print);
    this.line.add(print.group);
    this.layout();
    print.group.position.copy(print.slot).add(new THREE.Vector3(0, 0.25, 0));
    return print;
  }

  layout() {
    const lines = Math.ceil(this.prints.length / PER_LINE) || 1;
    const widest = Math.min(PER_LINE, this.prints.length);
    this.lineMesh.scale.y = Math.max(1.2, widest * SPACING + 0.3);
    this.prints.forEach((p, i) => {
      const row = Math.floor(i / PER_LINE);
      const inRow = Math.min(PER_LINE, this.prints.length - row * PER_LINE);
      const col = i % PER_LINE;
      p.slot.set((col - (inRow - 1) / 2) * SPACING, -row * 0.32, 0);
    });
    this.rows = lines;
  }

  pick(raycaster) {
    const targets = this.prints.filter((p) => !p.held).flatMap((p) => p.hitTargets);
    const hit = raycaster.intersectObjects(targets, false)[0];
    return hit ? { print: hit.object.userData.print, distance: hit.distance } : null;
  }

  // Detach a print so it can follow a hand; it stays a child of the scene.
  take(print, scene) {
    print.held = true;
    print.pin.visible = false;
    scene.attach(print.group);
  }

  giveBack(print) {
    print.held = false;
    print.pin.visible = true;
    this.line.attach(print.group);
  }

  update(dt, t, hovered) {
    for (const p of this.prints) if (!p.held) p.updateHanging(dt, t, p === hovered);
    this.lampGlow.material.opacity = 0.5 + Math.sin(t * 2.1) * 0.02 + Math.sin(t * 7.3) * 0.01;
    if (this.dust) this.dust.material.uniforms.uTime.value = t;
  }

  setVisible(v) {
    this.group.visible = v;
  }
}
