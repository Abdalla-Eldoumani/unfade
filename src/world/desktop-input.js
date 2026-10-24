import * as THREE from 'three';

const MOVE_RADIUS = 0.6;
const SHAKE_SPEED = 700; // px per second
const SHAKE_GAP_MS = 70;

// Mouse, touch, keyboard and phone motion for anyone without a headset.
// Drag looks around; while holding a print, drag shakes it instead.
export class DesktopInput {
  constructor(stage, el) {
    this.stage = stage;
    this.el = el;
    this.camera = stage.camera;
    this.yaw = 0;
    this.pitch = 0;
    this.origin = new THREE.Vector3(0, 1.6, 0);
    this.offset = new THREE.Vector3();
    this.dolly = 0;
    this.mode = 'look';
    this.allowMove = false;
    this.ndc = new THREE.Vector2(0, 0);
    this.pointerInside = false;
    this.drag = null;
    this.queue = { click: false, back: false, stepIn: false, shake: 0, reset: false };
    this.keys = new Set();
    this.lastShake = 0;
    this.motion = null;
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');

    el.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointerleave', () => (this.pointerInside = false));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dolly = Math.min(0.5, Math.max(-0.5, this.dolly - e.deltaY * 0.0008));
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
  }

  setOrigin(position, yaw = 0, pitch = 0) {
    this.origin.copy(position);
    this.offset.set(0, 0, 0);
    this.dolly = 0;
    this.yaw = yaw;
    this.pitch = pitch;
    if (this.motion) this.motion.recenter = true;
  }

  setMode(mode, { allowMove = false } = {}) {
    this.mode = mode;
    this.allowMove = allowMove;
  }

  onDown(e) {
    this.el.setPointerCapture?.(e.pointerId);
    this.drag = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastT: performance.now(), vx: 0, moved: 0, id: e.pointerId };
    this.updateNdc(e);
  }

  onMove(e) {
    this.updateNdc(e);
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const now = performance.now();
    const dx = e.clientX - d.lastX;
    const dy = e.movementY ?? 0;
    const dtS = Math.max(1, now - d.lastT) / 1000;
    d.moved += Math.abs(dx) + Math.abs(dy);
    if (this.mode === 'shake') {
      const vx = dx / dtS;
      if (Math.sign(vx) !== Math.sign(d.vx) && Math.abs(vx) > SHAKE_SPEED && now - this.lastShake > SHAKE_GAP_MS) {
        this.queue.shake++;
        this.lastShake = now;
      }
      if (Math.abs(vx) > 50) d.vx = vx;
    } else if (d.moved > 4) {
      const k = 0.0042;
      if (this.motion) this.motion.extraYaw += dx * k;
      else {
        this.yaw += dx * k;
        this.pitch = Math.min(1.2, Math.max(-1.2, this.pitch + (e.clientY - (d.lastY ?? e.clientY)) * k));
      }
    }
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    d.lastT = now;
  }

  onUp(e) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    if (d.moved < 8) this.queue.click = true;
    this.drag = null;
  }

  updateNdc(e) {
    const r = this.el.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.pointerInside = true;
  }

  onKey(e, down) {
    if (e.target?.closest?.('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (down) {
      if (k === 'escape' || k === 'backspace') this.queue.back = true;
      if (k === 'enter') this.queue.stepIn = true;
      if (k === ' ') {
        e.preventDefault();
        const now = performance.now();
        if (now - this.lastShake > 110) {
          this.queue.shake++;
          this.lastShake = now;
        }
      }
      if (k === 'r' && e.shiftKey) this.queue.reset = true;
      this.keys.add(k);
    } else this.keys.delete(k);
  }

  // Phone motion: iOS asks for permission, which has to come from a tap.
  async enableMotion() {
    try {
      if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
        if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return false;
      }
      if (typeof DeviceMotionEvent?.requestPermission === 'function') await DeviceMotionEvent.requestPermission();
    } catch {
      return false;
    }
    this.motion = { q: null, recenter: true, base: 0, extraYaw: 0 };
    const zee = new THREE.Vector3(0, 0, 1);
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    const q0 = new THREE.Quaternion();
    const euler = new THREE.Euler();
    window.addEventListener('deviceorientation', (e) => {
      if (e.alpha == null) return;
      const deg = Math.PI / 180;
      euler.set(e.beta * deg, e.alpha * deg, -e.gamma * deg, 'YXZ');
      const q = new THREE.Quaternion().setFromEuler(euler).multiply(q1);
      const orient = (screen.orientation?.angle ?? window.orientation ?? 0) * deg;
      q.multiply(q0.setFromAxisAngle(zee, -orient));
      this.motion.q = q;
    });
    window.addEventListener('devicemotion', (e) => {
      const a = e.acceleration;
      if (!a || a.x == null) return;
      const now = performance.now();
      if (Math.hypot(a.x, a.y, a.z) > 12 && now - this.lastShake > 120) {
        this.queue.shake++;
        this.lastShake = now;
      }
    });
    return true;
  }

  frame(dt) {
    const cam = this.camera;
    if (this.allowMove) {
      const f = (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0);
      const s = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
      if (f || s) {
        const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        this.offset.addScaledVector(fwd, f * dt * 0.7).addScaledVector(right, s * dt * 0.7);
        if (this.offset.length() > MOVE_RADIUS) this.offset.setLength(MOVE_RADIUS);
      }
    }
    if (this.motion?.q) {
      const q = this.motion.q.clone();
      const deviceYaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
      if (this.motion.recenter) {
        this.motion.base = this.yaw - deviceYaw;
        this.motion.extraYaw = 0;
        this.motion.recenter = false;
      }
      const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.motion.base + this.motion.extraYaw);
      cam.quaternion.copy(turn.multiply(q));
      this.yaw = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ').y;
    } else {
      this._euler.set(this.pitch, this.yaw, 0, 'YXZ');
      cam.quaternion.setFromEuler(this._euler);
    }
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    cam.position.copy(this.origin).add(this.offset).addScaledVector(forward, this.allowMove ? this.dolly : 0);
    cam.updateMatrixWorld();

    const ray = new THREE.Raycaster();
    ray.setFromCamera(this.ndc, cam);
    const q = this.queue;
    const out = {
      pointers: this.pointerInside || q.click
        ? [{ id: 'mouse', origin: ray.ray.origin.clone(), direction: ray.ray.direction.clone(), selectPressed: q.click, selectDown: Boolean(this.drag) }]
        : [],
      back: q.back,
      stepIn: q.stepIn,
      shake: q.shake,
      reset: q.reset,
    };
    this.queue = { click: false, back: false, stepIn: false, shake: 0, reset: false };
    return out;
  }
}
