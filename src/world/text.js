import * as THREE from 'three';

// Text in VR is drawn once onto a canvas and shown as a texture. The fonts
// must be loaded first or the canvas falls back to a system font.
export async function loadFonts() {
  const faces = ['500 64px Caveat', '600 64px Caveat', '400 64px "Young Serif"', '400 32px "IBM Plex Mono"', '500 32px "IBM Plex Mono"'];
  try {
    await Promise.all(faces.map((f) => document.fonts.load(f)));
  } catch {
    // keep going with whatever loaded
  }
}

export const FONTS = {
  hand: (px, weight = 500) => `${weight} ${px}px Caveat, cursive`,
  display: (px) => `400 ${px}px "Young Serif", Georgia, serif`,
  mono: (px, weight = 400) => `${weight} ${px}px "IBM Plex Mono", monospace`,
};

function wrap(ctx, text, maxWidth) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

// A plane of text, sized in metres by line height. Returns a Mesh whose
// material can be faded with .material.opacity.
export function makeText(text, {
  font = FONTS.hand(64),
  color = '#f1e9dc',
  px = 64,
  lineHeightM = 0.05,
  maxChars = 28,
  align = 'center',
  shadow = true,
  letterSpacing = 0,
  background = null,
} = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  const maxWidth = ctx.measureText('n'.repeat(maxChars)).width;
  const lines = wrap(ctx, text, maxWidth);
  const lineH = Math.round(px * 1.25);
  const pad = Math.round(px * 0.3);
  const width = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width), 1)) + pad * 2 + letterSpacing * 40;
  canvas.width = Math.min(2048, width);
  canvas.height = lines.length * lineH + pad * 2;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  if ('letterSpacing' in ctx && letterSpacing) ctx.letterSpacing = `${letterSpacing}px`;
  if (shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = px * 0.18;
  }
  ctx.fillStyle = color;
  const x = align === 'center' ? canvas.width / 2 : align === 'right' ? canvas.width - pad : pad;
  lines.forEach((l, i) => ctx.fillText(l, x, pad + lineH * (i + 0.5)));

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const heightM = (canvas.height / lineH) * lineHeightM;
  const widthM = heightM * (canvas.width / canvas.height);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthM, heightM), mat);
  mesh.userData.size = { width: widthM, height: heightM };
  mesh.renderOrder = 10;
  return mesh;
}

export function disposeMesh(mesh) {
  mesh.traverse((o) => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      for (const u of Object.values(m.uniforms || {})) if (u.value?.isTexture) u.value.dispose();
      m.dispose();
    }
  });
}

// Soft round glow used for lights, anchors and presence.
let glowTexture = null;
export function glowMap() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

export function makeGlow(color, size, opacity = 1) {
  const mat = new THREE.SpriteMaterial({
    map: glowMap(),
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(size);
  return s;
}
