import '../shared/tokens.css';
import './studio.css';
import { LIGHTS, MAX_ANCHORS, MAX_SOUND_LAYERS, PARTICLES, SCALES, SOUND_LAYERS, normalizeMemory, slugify, validateMemory } from '../shared/contract.js';
import { applyBrand } from '../shared/brand.js';
import { analyzePhoto } from './analyze.js';
import { depthToPngDataUrl, estimateDepth, loadDepthModel } from './depth.js';
import { decodeImage, imageStats, jpegDataUrl, palette, readFocal35, resizeToCanvas } from './image.js';

const LABELS = {
  scale: { closeup: 'Up close', room: 'A room', street: 'Outside, nearby', landscape: 'Far and wide' },
  light: { warm_indoor: 'Warm lamp light', cool_indoor: 'Cool indoor light', daylight: 'Daylight', golden_hour: 'Golden hour', overcast: 'Overcast', night: 'Night', candlelight: 'Candlelight' },
  particles: { dust: 'Dust in the light', snow: 'Snow', rain: 'Rain', fireflies: 'Fireflies', confetti: 'Confetti', petals: 'Petals', mist: 'Mist', none: 'Nothing' },
  sounds: { room_tone: 'A quiet room', wind: 'Wind', rain: 'Rain', waves: 'Waves', stream: 'Running water', fire: 'A fire', birds: 'Birds', crickets: 'Crickets', city: 'The city', night_air: 'Night air' },
};

applyBrand('studio');
const $ = (sel, root = document) => root.querySelector(sel);
const el = {
  print: $('.print'),
  window: $('.print-window'),
  photo: $('.print-photo'),
  wiggle: $('.print-wiggle'),
  anchors: $('.anchors'),
  title: $('.print-title'),
  when: $('input[name=when]'),
  where: $('input[name=where]'),
  develop: $('.develop'),
  progress: $('.progress'),
  review: $('[data-step=review]'),
  saveStep: $('[data-step=save]'),
  list: $('.anchor-list'),
  scale: $('select[name=scale]'),
  light: $('select[name=light]'),
  particles: $('select[name=particles]'),
  sounds: $('select[name=sounds]'),
  warning: $('.warning'),
  save: $('.save'),
  download: $('.download'),
  saved: $('.saved'),
  server: $('.studio-server'),
  wiggleToggle: $('.wiggle-toggle'),
};

const state = {
  photo: null,
  thumb: null,
  photoUrl: '',
  depth: null,
  anchors: [],
  lens: 'main',
  focal35: null,
  palette: [],
  titleSuggestion: '',
  source: 'manual',
  model: null,
  developed: false,
};

function fillSelect(select, values, labels) {
  select.replaceChildren(...values.map((v) => new Option(labels[v] || v, v)));
}
fillSelect(el.scale, SCALES, LABELS.scale);
fillSelect(el.light, LIGHTS, LABELS.light);
fillSelect(el.particles, PARTICLES, LABELS.particles);
fillSelect(el.sounds, SOUND_LAYERS, LABELS.sounds);
el.sounds.addEventListener('change', () => {
  const chosen = [...el.sounds.selectedOptions];
  if (chosen.length > MAX_SOUND_LAYERS) chosen.at(-1).selected = false;
});

// ---- server status ---------------------------------------------------------

fetch('/api/health', { signal: AbortSignal.timeout(3000) })
  .then((r) => r.json())
  .then((h) => {
    el.server.textContent = h.claude ? 'Server live · Claude on' : 'Server live · Claude off';
  })
  .catch(() => {
    el.server.textContent = 'No server · files only';
  });

// ---- choosing a photo ------------------------------------------------------

for (const input of document.querySelectorAll('.file-input')) {
  input.addEventListener('change', () => input.files[0] && loadFile(input.files[0]));
}
el.print.addEventListener('dragover', (e) => {
  e.preventDefault();
  el.print.classList.add('drag');
});
el.print.addEventListener('dragleave', () => el.print.classList.remove('drag'));
el.print.addEventListener('drop', (e) => {
  e.preventDefault();
  el.print.classList.remove('drag');
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});

async function loadFile(file) {
  setProgress('');
  try {
    const bitmap = await decodeImage(file);
    state.photo = resizeToCanvas(bitmap, 2048);
    state.thumb = resizeToCanvas(bitmap, 512);
    state.focal35 = await readFocal35(file);
  } catch (err) {
    setProgress(err.message);
    return;
  }
  state.photoUrl = jpegDataUrl(state.photo, 0.9);
  state.anchors = [];
  state.depth = null;
  state.developed = false;
  el.photo.src = state.photoUrl;
  el.photo.hidden = false;
  el.window.style.aspectRatio = `${state.photo.width} / ${state.photo.height}`;
  el.print.dataset.state = 'loaded';
  el.develop.disabled = false;
  el.review.hidden = true;
  el.saveStep.hidden = true;
  el.saved.hidden = true;
  el.wiggleToggle.hidden = true;
  stopWiggle();
  renderAnchors();
  loadDepthModel().catch(() => {});
}

// ---- developing ------------------------------------------------------------

el.develop.addEventListener('click', develop);

async function develop() {
  if (!state.photo) return;
  el.develop.disabled = true;
  el.print.dataset.state = 'developing';
  try {
    setProgress('Reading the depth of the photo...');
    state.depth = await estimateDepth(state.photo);
    setProgress('Looking for the spots worth remembering...');
    const stats = imageStats(state.photo);
    const result = await analyzePhoto(state.photo, {
      hints: { title: el.title.value.trim(), when: el.when.value.trim(), where: el.where.value.trim() },
      stats,
    });
    applyAnalysis(result);
    state.palette = palette(state.photo);
    state.developed = true;
    el.print.dataset.state = 'review';
    el.review.hidden = false;
    el.saveStep.hidden = false;
    el.wiggleToggle.hidden = false;
    setProgress('Developed.');
  } catch (err) {
    console.error(err);
    el.print.dataset.state = 'loaded';
    setProgress(err.message);
  } finally {
    el.develop.disabled = false;
  }
}

function applyAnalysis({ analysis: a, source, model, warning }) {
  state.source = source;
  state.model = model;
  state.lens = a.lens || 'main';
  state.titleSuggestion = a.titleSuggestion || '';
  if (state.titleSuggestion && !el.title.value) el.title.placeholder = state.titleSuggestion;
  el.scale.value = a.scale;
  el.light.value = a.light;
  el.particles.value = a.particles;
  for (const opt of el.sounds.options) opt.selected = (a.soundLayers || []).includes(opt.value);
  state.anchors = (a.anchors || []).slice(0, MAX_ANCHORS).map((x, i) => ({ ...x, id: `a${i + 1}`, note: '' }));
  el.warning.hidden = !warning;
  el.warning.textContent = warning || '';
  renderAnchors();
}

function setProgress(text) {
  el.progress.textContent = text;
}

// ---- anchors ---------------------------------------------------------------

function renderAnchors() {
  el.anchors.replaceChildren(
    ...state.anchors.map((a, i) => {
      const dot = document.createElement('button');
      dot.className = 'anchor-dot';
      dot.textContent = String(i + 1);
      dot.style.left = `${a.x * 100}%`;
      dot.style.top = `${a.y * 100}%`;
      dot.setAttribute('aria-label', `Spot ${i + 1}: ${a.label}`);
      dragDot(dot, a);
      return dot;
    }),
  );
  el.list.replaceChildren(
    ...state.anchors.map((a, i) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="anchor-head"><span class="anchor-num">${i + 1}</span><input class="anchor-label" maxlength="32" aria-label="What it is" /><button class="ghost remove" aria-label="Remove spot ${i + 1}">Remove</button></div>
        <label>Question <input class="anchor-question" maxlength="80" /></label>
        <label>What you remember, if you like <textarea class="anchor-note" maxlength="160" rows="2" placeholder="Only your own words go here"></textarea></label>`;
      const label = $('.anchor-label', li);
      const q = $('.anchor-question', li);
      const note = $('.anchor-note', li);
      label.value = a.label;
      q.value = a.question;
      note.value = a.note;
      label.addEventListener('input', () => (a.label = label.value));
      q.addEventListener('input', () => (a.question = q.value));
      note.addEventListener('input', () => (a.note = note.value));
      $('.remove', li).addEventListener('click', () => {
        state.anchors.splice(i, 1);
        state.anchors.forEach((x, j) => (x.id = `a${j + 1}`));
        renderAnchors();
      });
      return li;
    }),
  );
}

function dragDot(dot, a) {
  dot.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dot.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const r = el.window.getBoundingClientRect();
      a.x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      a.y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      dot.style.left = `${a.x * 100}%`;
      dot.style.top = `${a.y * 100}%`;
    };
    const up = () => {
      dot.removeEventListener('pointermove', move);
      dot.removeEventListener('pointerup', up);
    };
    dot.addEventListener('pointermove', move);
    dot.addEventListener('pointerup', up);
  });
}

el.window.addEventListener('click', (e) => {
  if (!state.developed || e.target.closest('.anchor-dot') || state.anchors.length >= MAX_ANCHORS) return;
  const r = el.window.getBoundingClientRect();
  state.anchors.push({
    id: `a${state.anchors.length + 1}`,
    x: (e.clientX - r.left) / r.width,
    y: (e.clientY - r.top) / r.height,
    label: 'this',
    question: 'What do you remember here?',
    sound: 'none',
    note: '',
  });
  renderAnchors();
});

// ---- depth preview: the photo sways as if seen from two eyes ---------------

let wiggleRaf = 0;
el.wiggleToggle.addEventListener('click', () => {
  if (wiggleRaf) stopWiggle();
  else startWiggle();
});

function startWiggle() {
  if (!state.depth) return;
  const W = 360;
  const H = Math.round((W * state.photo.height) / state.photo.width);
  const canvas = el.wiggle;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  // drawn straight to W x H: resizeToCanvas never enlarges a small photo
  ctx.drawImage(state.photo, 0, 0, W, H);
  const src = ctx.getImageData(0, 0, W, H).data;
  const d = new Float32Array(W * H);
  const { width: dw, height: dh, data } = state.depth;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d[y * W + x] = data[Math.floor((y / H) * dh) * dw + Math.floor((x / W) * dw)];
  const out = ctx.createImageData(W, H);
  canvas.hidden = false;
  el.wiggleToggle.textContent = 'Hide the depth';
  const draw = (t) => {
    const shift = Math.sin(t / 260) * 7;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const sx = Math.min(W - 1, Math.max(0, Math.round(x - (d[i] - 0.5) * shift)));
        const s = (y * W + sx) * 4;
        out.data[i * 4] = src[s];
        out.data[i * 4 + 1] = src[s + 1];
        out.data[i * 4 + 2] = src[s + 2];
        out.data[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    wiggleRaf = requestAnimationFrame(draw);
  };
  wiggleRaf = requestAnimationFrame(draw);
}

function stopWiggle() {
  cancelAnimationFrame(wiggleRaf);
  wiggleRaf = 0;
  el.wiggle.hidden = true;
  el.wiggleToggle.textContent = 'See the depth';
}

// ---- saving ----------------------------------------------------------------

// The title is always the person's own words; Claude's suggestion only ever
// sits in the placeholder.
function needsTitle() {
  if (el.title.value.trim()) return false;
  el.saved.hidden = false;
  el.saved.textContent = 'Give it a title in your own words first.';
  el.title.focus();
  return true;
}

function buildSpec() {
  const title = el.title.value.trim();
  const spec = normalizeMemory({
    id: slugify(title),
    title,
    when: el.when.value,
    where: el.where.value,
    createdAt: new Date().toISOString(),
    photo: { src: 'photo.jpg', width: state.photo.width, height: state.photo.height },
    thumb: { src: 'thumb.jpg', width: state.thumb.width, height: state.thumb.height },
    depth: { src: 'depth.png', width: state.depth.width, height: state.depth.height },
    camera: { lens: state.lens, focal35mm: state.focal35 },
    scene: {
      scale: el.scale.value,
      light: el.light.value,
      particles: el.particles.value,
      soundLayers: [...el.sounds.selectedOptions].map((o) => o.value),
    },
    palette: state.palette,
    anchors: state.anchors,
    source: { analysis: state.source, model: state.model },
  });
  const errors = validateMemory(spec);
  if (errors.length) throw new Error(errors.join('; '));
  return spec;
}

el.save.addEventListener('click', async () => {
  if (needsTitle()) return;
  el.save.disabled = true;
  el.saved.hidden = true;
  try {
    const memory = buildSpec();
    const res = await fetch('/api/memories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        memory,
        photo: state.photoUrl,
        thumb: jpegDataUrl(state.thumb, 0.85),
        depth: depthToPngDataUrl(state.depth),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `server said ${res.status}`);
    el.saved.innerHTML = `“${escapeHtml(body.spec.title)}” is on the line. <a href="/world.html">Open the darkroom</a> or put on the headset.`;
  } catch (err) {
    el.saved.textContent = `Could not save: ${err.message}. You can still download the files.`;
  } finally {
    el.saved.hidden = false;
    el.save.disabled = false;
  }
});

el.download.addEventListener('click', () => {
  if (needsTitle()) return;
  try {
    const spec = buildSpec();
    const files = [
      ['memory.json', `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(spec, null, 2))}`],
      ['photo.jpg', state.photoUrl],
      ['thumb.jpg', jpegDataUrl(state.thumb, 0.85)],
      ['depth.png', depthToPngDataUrl(state.depth)],
    ];
    files.forEach(([name, url], i) =>
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${spec.id}-${name}`;
        a.click();
      }, i * 300),
    );
    el.saved.hidden = false;
    el.saved.textContent = `Downloading four files for ${spec.id}. They go in public/memories/ only if the team agreed to make this photo public and everyone in it said yes: then put them in public/memories/${spec.id}/ without the "${spec.id}-" prefix and add the id to index.json.`;
  } catch (err) {
    el.saved.hidden = false;
    el.saved.textContent = err.message;
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
