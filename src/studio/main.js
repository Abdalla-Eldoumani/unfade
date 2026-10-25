import '../shared/tokens.css';
import './studio.css';
import { LIGHTS, MAX_ANCHORS, MAX_SOUND_LAYERS, PARTICLES, SCALES, SOUND_LAYERS, normalizeMemory, slugify, validateMemory } from '../shared/contract.js';
import { applyBrand } from '../shared/brand.js';
import { ENVIRONMENTS, environmentUrl, pickEnvironment } from '../world/environments.js';
import { analyzePhoto } from './analyze.js';
import { depthToPngDataUrl, estimateDepth, loadDepthModel } from './depth.js';
import { decodeImage, imageStats, jpegDataUrl, palette, readFocal35, resizeToCanvas, videoFrame } from './image.js';

const LABELS = {
  scale: { closeup: 'Up close', room: 'A room', street: 'Outside, nearby', landscape: 'Far and wide' },
  light: { warm_indoor: 'Warm lamp light', cool_indoor: 'Cool indoor light', daylight: 'Daylight', golden_hour: 'Golden hour', overcast: 'Overcast', night: 'Night', candlelight: 'Candlelight' },
  particles: { dust: 'Dust in the light', snow: 'Snow', rain: 'Rain', fireflies: 'Fireflies', confetti: 'Confetti', petals: 'Petals', mist: 'Mist', none: 'Nothing' },
  sounds: { room_tone: 'A quiet room', wind: 'Wind', rain: 'Rain', waves: 'Waves', stream: 'Running water', fire: 'A fire', birds: 'Birds', crickets: 'Crickets', city: 'The city', night_air: 'Night air' },
  surroundings: {
    fireplace: 'A room by the fire',
    warm_restaurant_night: 'A warm room at night',
    wooden_lounge: 'A warm wooden room',
    lebombo: 'A bright room',
    ballroom: 'A hall for a party',
    urban_street_01: 'A city street',
    vignaioli_night: 'A town square at night',
    meadow_2: 'A meadow',
    misty_pines: 'A misty forest',
    spiaggia_di_mondello: 'A beach',
    the_sky_is_on_fire: 'The sea at sunset',
    spruit_sunrise: 'A field at golden hour',
    alps_field: 'Mountains',
    snowy_park_01: 'A snowy park',
    satara_night_no_lamps: 'A night under the stars',
  },
};

applyBrand('studio');
const $ = (sel, root = document) => root.querySelector(sel);
const el = {
  print: $('.print'),
  window: $('.print-window'),
  photo: $('.print-photo'),
  wiggle: $('.print-wiggle'),
  cream: $('.print-cream'),
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
  sounds: $('.sound-list'),
  addSpot: $('.add-spot'),
  warning: $('.warning'),
  save: $('.save'),
  download: $('.download'),
  saved: $('.saved'),
  worldOpt: $('.world-opt'),
  worldBox: $('.world-opt-box'),
  worldStatus: $('.world-status'),
  server: $('.studio-server'),
  wiggleToggle: $('.wiggle-toggle'),
  surroundings: $('.surroundings'),
  surroundingsView: $('.surroundings-view'),
  surroundingsName: $('.surroundings-name'),
  surroundingsEdge: $('.surroundings .edge'),
  sceneMore: $('.scene-more'),
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
  developedWords: '',
  taps: [],
};

function fillSelect(select, values, labels) {
  select.replaceChildren(...values.map((v) => new Option(labels[v] || v, v)));
}
fillSelect(el.scale, SCALES, LABELS.scale);
fillSelect(el.light, LIGHTS, LABELS.light);
fillSelect(el.particles, PARTICLES, LABELS.particles);
const soundBoxes = SOUND_LAYERS.map((v) => {
  const box = Object.assign(document.createElement('input'), { type: 'checkbox', value: v });
  const label = document.createElement('label');
  label.className = 'sound';
  label.append(box, LABELS.sounds[v] || v);
  el.sounds.append(label);
  return box;
});
// three at most: the others wait, disabled, until one is unticked
function limitSounds() {
  const full = soundBoxes.filter((b) => b.checked).length >= MAX_SOUND_LAYERS;
  for (const b of soundBoxes) b.disabled = full && !b.checked;
}
el.sounds.addEventListener('change', limitSounds);

// The headset builds the world around the photo from these same fields
// (src/world/environments.js), so the studio shows it as they change.
function showSurroundings() {
  const name = pickEnvironment({
    place: state.place,
    scale: el.scale.value,
    light: el.light.value,
    particles: el.particles.value,
    soundLayers: soundBoxes.filter((b) => b.checked).map((b) => b.value),
  });
  const view = el.surroundingsView;
  // own: the headset surrounds the photo with its own colours, so show the photo softened
  view.style.filter = name ? '' : 'blur(10px) saturate(0.85)';
  view.style.backgroundImage = `url(${name ? environmentUrl(name) : state.photoUrl})`;
  view.style.backgroundSize = name ? '' : 'cover';
  // the part straight ahead in the headset, centred in the strip (the
  // panorama is drawn twice the strip's width)
  const ahead = (((0.25 + (ENVIRONMENTS[name]?.yaw ?? 0)) % 1) + 1) % 1;
  const w = view.clientWidth || 320;
  view.style.backgroundPosition = `${Math.round(w * 0.5 - ahead * 2 * w)}px 50%`;
  el.surroundingsName.textContent = name ? LABELS.surroundings[name] || '' : 'The photo\'s own colours';
  el.surroundings.hidden = false;
}
for (const input of [el.scale, el.light, el.particles, el.sounds]) {
  input.addEventListener('change', () => {
    // once the person has set the scene, it is no longer a guess
    state.place = null;
    el.surroundingsEdge.textContent = 'The world around it';
    showSurroundings();
  });
}
addEventListener('resize', () => !el.surroundings.hidden && showSurroundings());

// ---- server status ---------------------------------------------------------

fetch('/api/health', { signal: AbortSignal.timeout(3000) })
  .then((r) => r.json())
  .then((h) => {
    el.server.textContent = h.claude ? 'Server live · Claude on' : 'Server live · Claude off';
    // a 3D place is offered only when the server can build one; off unless chosen
    el.worldOpt.hidden = !h.worlds;
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

// A phone's photo is well under this; past it, decoding can run a phone out of memory.
const MAX_PHOTO_MB = 40;

function refuse(text) {
  setProgress(text);
  el.progress.scrollIntoView({ block: 'nearest' });
}

async function loadFile(file) {
  setProgress('');
  const isVideo = file.type.startsWith('video/');
  if (file.type && !file.type.startsWith('image/') && !isVideo) {
    return refuse(`"${file.name}" is not a photo or a video. Choose a JPEG, PNG or WebP photo, or a short video.`);
  }
  if (!isVideo && file.size > MAX_PHOTO_MB * 1e6) {
    return refuse(`"${file.name}" is ${Math.round(file.size / 1e6)} MB, more than the ${MAX_PHOTO_MB} MB the studio can open. Choose a smaller copy of it.`);
  }
  try {
    const bitmap = isVideo ? await videoFrame(file) : await decodeImage(file);
    state.photo = resizeToCanvas(bitmap, 2048);
    state.thumb = resizeToCanvas(bitmap, 512);
    state.focal35 = isVideo ? null : await readFocal35(file);
  } catch (err) {
    return refuse(err.message);
  }
  state.photoUrl = jpegDataUrl(state.photo, 0.9);
  state.place = null;
  state.anchors = [];
  state.taps = [];
  state.depth = null;
  state.developed = false;
  el.photo.src = state.photoUrl;
  el.photo.hidden = false;
  el.window.style.aspectRatio = `${state.photo.width} / ${state.photo.height}`;
  el.print.dataset.state = 'loaded';
  el.develop.disabled = false;
  el.develop.textContent = 'Develop';
  el.develop.classList.remove('ghost');
  el.surroundings.hidden = true;
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

// Claude reads the photo and these words, so after developing, only new words
// (or a first try that never reached Claude) are worth developing again for.
const words = () => [el.title, el.when, el.where].map((input) => input.value.trim()).join('\n');
const canDevelopAgain = () => state.source === 'fallback' || words() !== state.developedWords;

for (const input of [el.title, el.when, el.where]) {
  input.addEventListener('input', () => {
    if (!state.developed || el.print.dataset.state === 'developing') return;
    el.develop.disabled = !canDevelopAgain();
    if (state.source !== 'fallback') setProgress(el.develop.disabled ? 'Developed.' : 'Your words changed. Develop again to fit the spots to them; it replaces the spots below.');
  });
}

// half of .anchor-dot's 34 px: a tap this close to a spot is on it
const DOT_RADIUS_PX = 17;

async function develop() {
  if (!state.photo) return;
  el.develop.disabled = true;
  // a spot added now would be replaced by the new ones
  el.addSpot.disabled = true;
  state.developed = false;
  state.taps = [];
  el.print.dataset.state = 'developing';
  // on a phone the print has scrolled away by the time Develop is tapped, and the
  // person needs it in view to watch it develop and to touch the spots
  el.print.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  const print = developPrint();
  try {
    setProgress('Reading the depth of the photo...');
    // the depth model holds the page until it is done, so let the blank print and these words show first
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
    state.depth = await estimateDepth(state.photo);
    print.toward(0.15);
    setProgress('Looking for the spots worth remembering...');
    const stats = imageStats(state.photo);
    const result = await analyzePhoto(state.photo, {
      hints: { title: el.title.value.trim(), when: el.when.value.trim(), where: el.where.value.trim() },
      stats,
    });
    state.palette = palette(state.photo);
    // the old spots stay away while the cream clears, so a tap where one was is held too
    el.anchors.replaceChildren();
    el.print.dataset.state = 'review';
    await print.finish();
    el.anchors.classList.add('arriving');
    applyAnalysis(result);
    // a held tap that lands on a spot now there is that spot, as it is once developed
    const r = el.window.getBoundingClientRect();
    for (const [x, y] of state.taps.splice(0)) {
      if (!state.anchors.some((a) => Math.hypot((a.x - x) * r.width, (a.y - y) * r.height) < DOT_RADIUS_PX)) addSpot(x, y);
    }
    setTimeout(() => el.anchors.classList.remove('arriving'), MAX_ANCHORS * 450 + 900);
    state.developed = true;
    state.developedWords = words();
    el.develop.textContent = 'Develop again';
    // the next step is hanging it; developing again is the quiet choice now
    el.develop.classList.add('ghost');
    el.review.hidden = false;
    el.saveStep.hidden = false;
    el.wiggleToggle.hidden = false;
    setProgress('Developed.');
  } catch (err) {
    console.error(err);
    print.cancel();
    el.print.dataset.state = 'loaded';
    // the spots from before, and the button to add one, come back
    renderAnchors();
    setProgress(err.message);
  } finally {
    el.develop.disabled = state.developed && !canDevelopAgain();
  }
}

function applyAnalysis({ analysis: a, source, model, warning }) {
  state.source = source;
  state.model = model;
  state.lens = a.lens || 'main';
  state.titleSuggestion = a.titleSuggestion || '';
  state.place = a.place || null;
  if (state.titleSuggestion && !el.title.value) el.title.placeholder = state.titleSuggestion;
  el.scale.value = a.scale;
  el.light.value = a.light;
  el.particles.value = a.particles;
  for (const b of soundBoxes) b.checked = (a.soundLayers || []).includes(b.value);
  limitSounds();
  state.anchors = (a.anchors || []).slice(0, MAX_ANCHORS).map((x, i) => ({ ...x, id: `a${i + 1}`, note: '' }));
  el.warning.hidden = !warning;
  el.warning.textContent = visitorWarning(warning);
  renderAnchors();
  // Without Claude the scene is a guess from the photo's brightness alone (a
  // sunset coast comes back as a warm room), so the controls open under it.
  const guessed = source !== 'claude';
  el.surroundingsEdge.textContent = guessed ? 'A first guess' : 'The world around it';
  el.sceneMore.open = guessed;
  showSurroundings();
}

// A missing or refused key is the team's to fix, not the visitor's: they
// read what to do, and the server's own words go to the console.
function visitorWarning(warning) {
  if (!warning) return '';
  if (!/ANTHROPIC_API_KEY|API key/i.test(warning)) return warning;
  console.warn(warning);
  return 'Claude is not connected right now, so tap the photo to choose up to three spots yourself.';
}

function setProgress(text) {
  el.progress.textContent = text;
}

// The headset's metaphor: a blank cream print the photo comes up through. The
// depth model holds the main thread for seconds (longer on a phone), so the
// cream is an opacity animation, which the compositor keeps running meanwhile.
// The work takes an unknown time, so the cream eases toward a level and slows
// down there rather than clearing before the work is done.
const SLOWING = 'cubic-bezier(0.05, 0.7, 0.2, 1)';

function developPrint() {
  let anim = el.cream.animate(
    [{ opacity: 0, easing: 'ease-out' }, { opacity: 1, offset: 0.015, easing: SLOWING }, { opacity: 0.3 }],
    { duration: 40000, fill: 'forwards' },
  );
  let stopped = false;
  // the first frame after the model lets go still carries the time from before
  // it started, so where the cream really is can only be read a frame later
  const toward = (opacity, duration, easing) => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
    if (stopped) return resolve();
    const from = getComputedStyle(el.cream).opacity;
    anim.cancel();
    anim = el.cream.animate([{ opacity: from }, { opacity }], { duration, easing, fill: 'forwards' });
    resolve();
  })));
  return {
    toward: (opacity) => toward(opacity, 30000, SLOWING),
    // the work is done: the rest of the way in the time every develop takes
    finish: () => toward(0, 900, 'cubic-bezier(0.22, 0.61, 0.36, 1)').then(() => anim.finished).then(() => anim.cancel()),
    cancel: () => {
      stopped = true;
      anim.cancel();
    },
  };
}

// ---- anchors ---------------------------------------------------------------

function renderAnchors() {
  el.addSpot.disabled = state.anchors.length >= MAX_ANCHORS;
  el.anchors.replaceChildren(
    ...state.anchors.map((a, i) => {
      const dot = document.createElement('button');
      dot.className = 'anchor-dot';
      dot.textContent = String(i + 1);
      dot.style.left = `${a.x * 100}%`;
      dot.style.top = `${a.y * 100}%`;
      dot.style.setProperty('--i', i);
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
  const place = (x, y) => {
    a.x = Math.min(1, Math.max(0, x));
    a.y = Math.min(1, Math.max(0, y));
    dot.style.left = `${a.x * 100}%`;
    dot.style.top = `${a.y * 100}%`;
  };
  // the arrow keys move a spot too: a small step, or a bigger one with Shift
  dot.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] || [0, 0];
    if (!dx && !dy) return;
    e.preventDefault();
    place(a.x + dx, a.y + dy);
  });
  dot.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dot.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const r = el.window.getBoundingClientRect();
      place((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height);
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
  if (e.target.closest('.anchor-dot')) return;
  const r = el.window.getBoundingClientRect();
  const at = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  if (state.developed) addSpot(...at);
  // a tap while the print is still coming up waits for its spots, after them and three at most
  else if (['developing', 'review'].includes(el.print.dataset.state)) state.taps.push(at);
});

// the keyboard's way to add one: in the middle, focused, ready for the arrow keys
el.addSpot.addEventListener('click', () => {
  addSpot(0.5, 0.5);
  el.anchors.lastElementChild?.focus();
});

function addSpot(x, y) {
  if (state.anchors.length >= MAX_ANCHORS) return;
  state.anchors.push({ id: `a${state.anchors.length + 1}`, x, y, label: `spot ${state.anchors.length + 1}`, question: 'What do you remember here?', sound: 'none', note: '' });
  renderAnchors();
}

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
      soundLayers: soundBoxes.filter((b) => b.checked).map((b) => b.value),
      place: state.place,
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
    if (!el.worldOpt.hidden && el.worldBox.checked) buildWorld(body.spec.id);
  } catch (err) {
    el.saved.textContent = `Could not save: ${err.message}. You can still download the files.`;
  } finally {
    el.saved.hidden = false;
    el.save.disabled = false;
  }
});

// Builds the 3D place around a hung memory (server/worldlabs.js) and says
// how it is going. The print is already on the line; this never holds it up.
const WORLD_POLL_MS = 5000;
const WORLD_GIVE_UP_MS = 16 * 60 * 1000;
async function buildWorld(id) {
  const say = (text) => {
    el.worldStatus.textContent = text;
    el.worldStatus.hidden = false;
  };
  const started = Date.now();
  say('Building the place around it. This takes about five minutes; you can step in now and it appears next time.');
  try {
    let s = await (await fetch(`/api/world/${id}`, { method: 'POST' })).json();
    while (s.status === 'queued' || s.status === 'pending') {
      if (Date.now() - started > WORLD_GIVE_UP_MS) {
        say('The place is still being built. The memory works without it.');
        return;
      }
      await new Promise((r) => setTimeout(r, WORLD_POLL_MS));
      s = await (await fetch(`/api/world/${id}`)).json();
      const mins = Math.max(1, 5 - Math.floor((Date.now() - started) / 60000));
      if (s.status === 'pending') say(`Building the place around it. About ${mins} more minute${mins === 1 ? '' : 's'}.`);
      if (s.status === 'queued') say('Waiting for another place to finish first.');
    }
    if (s.status === 'ready') say('The place around it is ready. Step in again to stand inside it.');
    else say(`The place could not be built (${s.reason || 'no reason given'}). The memory works without it.`);
  } catch {
    say('The place could not be built, because the server stopped answering. The memory works without it.');
  }
}

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
