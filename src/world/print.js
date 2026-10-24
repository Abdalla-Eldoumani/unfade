import * as THREE from 'three';
import { printMaterial } from './shaders.js';
import { FONTS, makeGlow, makeText } from './text.js';

export const FADED_LEVEL = 0.3;
const WINDOW_LONG = 0.17;

// One instant print: cream frame, the photo window (develop shader), the
// title written on the bottom strip, and a clothespin.
export class Print {
  constructor(item, texture) {
    this.item = item;
    this.id = item.spec.id;
    this.group = new THREE.Group();
    this.group.name = `print:${this.id}`;
    this.revived = false;
    this.develop = FADED_LEVEL;

    const photoAspect = item.spec.thumb.width / item.spec.thumb.height;
    const winAspect = Math.min(1.5, Math.max(0.8, photoAspect));
    const winW = winAspect >= 1 ? WINDOW_LONG : WINDOW_LONG * winAspect;
    const winH = winAspect >= 1 ? WINDOW_LONG / winAspect : WINDOW_LONG;
    const side = 0.012;
    const bottom = 0.042;
    const fw = winW + side * 2;
    const fh = winH + side + bottom;
    this.size = { width: fw, height: fh };

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(fw, fh, 0.003),
      // a little self-light so the paper still reads as paper under the safelight
      new THREE.MeshStandardMaterial({ color: '#efe7da', emissive: '#5a4a3e', roughness: 0.92, metalness: 0 }),
    );
    frame.position.y = -fh / 2;
    this.group.add(frame);

    // crop the photo to the window like a print would
    const crop = photoAspect > winAspect ? [winAspect / photoAspect, 1] : [1, photoAspect / winAspect];
    const offset = [(1 - crop[0]) / 2, (1 - crop[1]) / 2];
    this.material = printMaterial(texture, { crop, offset });
    const image = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), this.material);
    image.position.set(0, -side - winH / 2, 0.0018);
    this.group.add(image);
    this.image = image;

    const title = makeText(item.spec.title, {
      font: FONTS.hand(64, 600),
      color: '#3a2a20',
      shadow: false,
      lineHeightM: 0.024,
      maxChars: 22,
    });
    title.position.set(0, -fh + bottom * 0.5, 0.0019);
    const tw = title.userData.size.width;
    if (tw > fw * 0.9) title.scale.setScalar((fw * 0.9) / tw);
    this.group.add(title);

    const pin = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, 0.05, 0.012),
      new THREE.MeshStandardMaterial({ color: '#b08a5a', roughness: 0.8 }),
    );
    pin.position.set(0, 0.005, 0.004);
    this.pin = pin;
    this.group.add(pin);

    this.glow = makeGlow('#f0a35e', 0.55, 0);
    this.glow.position.set(0, -fh / 2, -0.02);
    this.group.add(this.glow);

    this.hitTargets = [frame, image];
    for (const m of this.hitTargets) m.userData.print = this;
    this.parts = [frame, image, title, pin];
    for (const m of this.parts) m.userData.renderOrder = m.renderOrder;

    this.slot = new THREE.Vector3();
    this.hover = 0;
    this.sway = Math.random() * Math.PI * 2;
    this.held = false;
  }

  setDevelop(v) {
    this.develop = Math.min(1, Math.max(0, v));
    this.material.uniforms.uDevelop.value = this.develop;
  }

  setRevived(on) {
    this.revived = on;
    this.material.uniforms.uWarm.value = on ? 1 : 0;
    this.setDevelop(on ? 1 : FADED_LEVEL);
    this.glow.material.opacity = on ? 0.55 : 0;
  }

  // While it rises to the eyes nothing in the room can be nearer, so it is
  // drawn over everything, back to front: in the emulator the room's ceiling
  // and floor otherwise cut into a print this big and close.
  setOnTop(on) {
    this.parts.forEach((m, i) => {
      m.material.depthTest = !on;
      m.renderOrder = on ? 30 + i : m.userData.renderOrder;
    });
    this.glow.visible = !on;
  }

  // Hanging on the line: gentle sway, lifts a little when pointed at.
  updateHanging(dt, t, hovered) {
    this.hover += ((hovered ? 1 : 0) - this.hover) * Math.min(1, dt * 10);
    this.group.position.lerp(this.slot, Math.min(1, dt * 6));
    this.group.position.z = this.slot.z + this.hover * 0.04;
    this.group.rotation.set(0, 0, Math.sin(t * 0.7 + this.sway) * 0.025);
    this.glow.material.opacity = this.revived ? 0.45 + 0.1 * Math.sin(t * 1.3 + this.sway) : this.hover * 0.25;
  }
}
