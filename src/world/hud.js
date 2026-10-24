import { APP_NAME } from '../shared/brand.js';

// The flat overlay for laptops and phones (and the mirror on the big screen).
// Inside the headset none of this shows; the hints there are drawn in 3D.
export class Hud {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-top">
        <span class="hud-brand">${APP_NAME}</span>
        <span class="edge hud-status"></span>
      </div>
      <div class="hud-loading"><div class="hud-loading-print"></div><p class="edge"></p></div>
      <div class="hud-mirror" hidden>
        <p class="edge hud-mirror-who"></p>
        <h2 class="hud-mirror-title"></h2>
        <div class="hud-mirror-bar"><span></span></div>
      </div>
      <div class="hud-bottom">
        <p class="hud-hint"></p>
        <div class="hud-buttons"></div>
      </div>
    `;
    this.status = root.querySelector('.hud-status');
    this.hintEl = root.querySelector('.hud-hint');
    this.buttons = root.querySelector('.hud-buttons');
    this.loading = root.querySelector('.hud-loading');
    this.mirrorEl = root.querySelector('.hud-mirror');
  }

  setStatus(parts) {
    this.status.textContent = parts.filter(Boolean).join(' · ');
  }

  hint(text) {
    if (this.hintEl.textContent !== text) this.hintEl.textContent = text || '';
  }

  setButtons(list) {
    const key = JSON.stringify(list.map((b) => [b.label, b.kind, b.note]));
    if (key === this.lastButtons) return;
    this.lastButtons = key;
    this.buttons.replaceChildren(
      ...list.map((b) => {
        const el = document.createElement('button');
        el.className = b.kind === 'ghost' ? 'ghost' : '';
        el.innerHTML = b.note ? `<span class="edge">${b.note}</span>${b.label}` : b.label;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          b.onClick();
        });
        return el;
      }),
    );
  }

  showLoading(text) {
    this.loading.hidden = false;
    this.loading.querySelector('p').textContent = text;
  }

  hideLoading() {
    this.loading.hidden = true;
  }

  setMirror({ who, title, bloomed, total }) {
    this.mirrorEl.hidden = false;
    this.mirrorEl.querySelector('.hud-mirror-who').textContent = who;
    this.mirrorEl.querySelector('.hud-mirror-title').textContent = title || '';
    const pct = total ? (bloomed / total) * 100 : 0;
    this.mirrorEl.querySelector('.hud-mirror-bar').hidden = !total;
    this.mirrorEl.querySelector('.hud-mirror-bar span').style.width = `${pct}%`;
  }

  hideXrOverlay(presenting) {
    this.root.classList.toggle('in-xr', presenting);
  }
}
