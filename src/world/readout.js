import { FONTS, disposeMesh, makeText } from './text.js';

const LINE_M = 0.03; // at 1 m: about 34 px a line on a Quest 2, 19 px on a laptop
// How far down the half view it sits: in the headset below the prints on the
// line and the title card; on a laptop above the overlay's hint and buttons.
const DOWN_XR = 0.6;
const DOWN_WINDOW = 0.5;

// Behind ?debug: frame time over the last second, draw calls, triangles and
// the last error, written near the bottom of the view. Inside the headset
// there is no console without developer mode, so this is the only one.
export class Readout {
  constructor(camera) {
    this.camera = camera;
    this.mesh = null;
    this.text = '';
    this.error = 'none';
    this.frames = [];
    this.prev = 0;
    this.drawnAt = 0;
    const keep = (msg) => (this.error = String(msg).replace(/\s+/g, ' ').slice(0, 96));
    addEventListener('error', (e) => keep(e.message));
    addEventListener('unhandledrejection', (e) => keep(e.reason?.message ?? e.reason));
    const original = console.error.bind(console);
    console.error = (...args) => {
      keep(args.map((a) => a?.message ?? a).join(' '));
      original(...args);
    };
  }

  // Call before rendering, so renderer.info still counts the frame just drawn
  // (both eyes in a headset).
  update(info, presenting) {
    const now = performance.now();
    if (this.prev) this.frames.push(now - this.prev);
    this.prev = now;
    // redrawn once a second: a new texture every frame would cost more than it measures
    if (!this.mesh || now - this.drawnAt >= 1000) this.redraw(info, now);
    // camera.fov follows the headset's view once a session renders
    const down = Math.tan((this.camera.fov * Math.PI) / 360) * (presenting ? DOWN_XR : DOWN_WINDOW);
    this.mesh.position.set(0, -down, -1);
  }

  redraw(info, now) {
    this.drawnAt = now;
    const ms = this.frames.reduce((a, b) => a + b, 0) / (this.frames.length || 1);
    const worst = Math.max(0, ...this.frames);
    this.frames.length = 0;
    this.text = `${ms.toFixed(1)} ms, worst ${worst.toFixed(1)} · ${info.calls} calls · ${info.triangles.toLocaleString('en-US')} triangles\nlast error: ${this.error}`;
    if (this.mesh) {
      this.camera.remove(this.mesh);
      disposeMesh(this.mesh);
    }
    this.mesh = makeText(this.text, {
      font: FONTS.mono(32),
      px: 32,
      lineHeightM: LINE_M,
      maxChars: 60,
      shadow: false,
      background: 'rgba(12, 9, 7, 0.8)',
    });
    // over everything, the fades included, so a stuck fade still shows its error
    this.mesh.material.depthTest = false;
    this.mesh.renderOrder = 10000;
    this.camera.add(this.mesh);
  }
}
