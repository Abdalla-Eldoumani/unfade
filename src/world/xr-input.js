import * as THREE from 'three';

// Quest controllers (or hands) as pointers. No controller models are loaded
// from a CDN; each hand gets a small paper-coloured ray instead.
export class XRInput {
  constructor(stage) {
    this.stage = stage;
    this.hands = [0, 1].map((i) => this.makeHand(i));
  }

  makeHand(i) {
    const { renderer, scene } = this.stage;
    const ray = renderer.xr.getController(i);
    const grip = renderer.xr.getControllerGrip(i);
    scene.add(ray, grip);
    const hand = { index: i, ray, grip, source: null, select: false, squeeze: false, events: [], buttons: [], velocity: new THREE.Vector3(), prev: null };

    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    geo.setAttribute('color', new THREE.Float32BufferAttribute([0.95, 0.91, 0.86, 0.95, 0.91, 0.86], 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 }));
    line.scale.z = 1.2;
    ray.add(line);
    hand.line = line;

    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: '#f1e9dc' }));
    ray.add(dot);
    const reticle = new THREE.Mesh(new THREE.RingGeometry(0.008, 0.013, 24), new THREE.MeshBasicMaterial({ color: '#f1e9dc', transparent: true, opacity: 0.8, depthTest: false }));
    reticle.visible = false;
    ray.add(reticle);
    hand.reticle = reticle;

    ray.addEventListener('connected', (e) => {
      hand.source = e.data;
      line.visible = e.data.targetRayMode === 'tracked-pointer';
    });
    ray.addEventListener('disconnected', () => {
      hand.source = null;
    });
    ray.addEventListener('selectstart', () => {
      hand.select = true;
      hand.events.push('selectstart');
    });
    ray.addEventListener('selectend', () => {
      hand.select = false;
      hand.events.push('selectend');
    });
    ray.addEventListener('squeezestart', () => {
      hand.squeeze = true;
      hand.events.push('squeezestart');
    });
    ray.addEventListener('squeezeend', () => {
      hand.squeeze = false;
    });
    return hand;
  }

  // Snapshot for this frame: rays, grips, button edges, velocity.
  frame(dt) {
    const out = [];
    for (const h of this.hands) {
      if (!h.source) {
        h.events.length = 0;
        continue;
      }
      const origin = h.ray.getWorldPosition(new THREE.Vector3());
      const rayQuat = h.ray.getWorldQuaternion(new THREE.Quaternion());
      const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(rayQuat);
      // a tracked hand may have no grip space; its pointer pose stands in
      const hasGrip = Boolean(h.source.gripSpace);
      const gripPos = hasGrip ? h.grip.getWorldPosition(new THREE.Vector3()) : origin.clone();
      const gripQuat = hasGrip ? h.grip.getWorldQuaternion(new THREE.Quaternion()) : rayQuat.clone();
      if (h.prev && dt > 0) h.velocity.copy(gripPos).sub(h.prev).divideScalar(dt);
      h.prev = gripPos.clone();

      const pads = h.source.gamepad?.buttons || [];
      const pressed = pads.map((b) => b?.pressed);
      const edge = (i) => pressed[i] && !h.buttons[i];
      const events = h.events.splice(0);
      out.push({
        id: `xr${h.index}`,
        hand: h,
        handedness: h.source.handedness,
        origin,
        direction,
        gripPos,
        gripQuat,
        velocity: h.velocity.clone(),
        selectPressed: events.includes('selectstart'),
        selectReleased: events.includes('selectend'),
        squeezePressed: events.includes('squeezestart'),
        selectDown: h.select,
        primaryPressed: edge(4), // A or X
        secondaryPressed: edge(5), // B or Y
      });
      h.buttons = pressed;
    }
    return out;
  }

  setRay(hand, distance) {
    hand.line.scale.z = distance ?? 1.2;
    hand.reticle.visible = distance != null;
    if (distance != null) hand.reticle.position.set(0, 0, -distance + 0.005);
  }

  pulse(hand, intensity = 0.5, ms = 30) {
    const pad = hand?.source?.gamepad;
    try {
      if (pad?.hapticActuators?.[0]?.pulse) pad.hapticActuators[0].pulse(intensity, ms);
      else pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity });
    } catch {
      // no haptics on this input
    }
  }
}
