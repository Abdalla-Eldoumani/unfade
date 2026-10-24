import * as THREE from 'three';
import { particleMaterial } from './shaders.js';

const COUNTS = { dust: 900, snow: 1400, rain: 1600, fireflies: 140, confetti: 700, petals: 260, mist: 90 };
const DEFAULT_COLORS = { snow: ['#ffffff', '#f4f7ff', '#e8eef8', '#ffffff'], rain: ['#cfd8e6', '#b8c4d6', '#dfe6f1', '#c4cfdf'] };

// Something in the air that belongs to the memory. Motion is all in the
// vertex shader, so thousands of particles cost one draw call.
export function makeParticles(type, palette = []) {
  if (!type || type === 'none') return null;
  const n = COUNTS[type] ?? 600;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n * 3);
  const color = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos.set([Math.random() * 8 - 4, Math.random() * 3.6 - 0.2, Math.random() * 9 - 7], i * 3);
    seed.set([Math.random(), Math.random(), Math.random()], i * 3);
    color[i] = Math.floor(Math.random() * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(color, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.6, -2.5), 12);

  const warm = ['#ffd9a8', '#f0a35e', '#ffe9c9', '#e9b98a'];
  const colors = DEFAULT_COLORS[type] || (type === 'confetti' || type === 'petals' ? fill(palette, warm) : warm);
  const points = new THREE.Points(geo, particleMaterial({ type, colors }));
  points.frustumCulled = false;
  points.renderOrder = 5;
  return points;
}

function fill(palette, fallback) {
  const out = palette.filter(Boolean).slice(0, 4);
  while (out.length < 4) out.push(fallback[out.length]);
  return out;
}
