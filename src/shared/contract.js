// The shapes every part of the app agrees on: the memory file (spec 1) and
// the room messages (protocol 1). docs/CONTRACT.md explains each field.
// Changing anything here means telling the whole team first.

export const SPEC_VERSION = 1;
export const PROTOCOL_VERSION = 1;

export const SCALES = ['closeup', 'room', 'street', 'landscape'];
export const LIGHTS = ['warm_indoor', 'cool_indoor', 'daylight', 'golden_hour', 'overcast', 'night', 'candlelight'];
export const PARTICLES = ['dust', 'snow', 'rain', 'fireflies', 'confetti', 'petals', 'mist', 'none'];
export const SOUND_LAYERS = ['room_tone', 'wind', 'rain', 'waves', 'stream', 'fire', 'birds', 'crickets', 'city', 'night_air'];
export const LENSES = ['main', 'ultrawide', 'selfie', 'telephoto'];
export const MAX_ANCHORS = 3;
export const MAX_SOUND_LAYERS = 3;
export const DEPTH_ENCODING = 'rg16-disparity';

// Near and far distance in metres that normalized disparity maps onto.
export const DEPTH_RANGE_M = {
  closeup: [0.45, 2.4],
  room: [1.0, 6.5],
  street: [2.0, 28],
  landscape: [3.0, 70],
};

// Diagonal field of view of common phone cameras (35 mm equivalent focal
// lengths of about 26, 13, 24 and 77 mm).
export const LENS_DIAG_FOV_DEG = { main: 79.5, ultrawide: 118, selfie: 86, telephoto: 31 };

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

export function isMemoryId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

export function slugify(text) {
  const s = String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'memory';
}

// Horizontal and vertical field of view (degrees) for an image of this size,
// from the lens's diagonal field of view or a 35 mm equivalent focal length.
export function fieldOfView({ width, height, lens = 'main', focal35mm = null }) {
  const diag = focal35mm > 0
    ? (2 * Math.atan(43.27 / (2 * focal35mm)) * 180) / Math.PI
    : LENS_DIAG_FOV_DEG[lens] ?? LENS_DIAG_FOV_DEG.main;
  const t = Math.tan((diag * Math.PI) / 360);
  const d = Math.hypot(width, height);
  const h = (2 * Math.atan((t * width) / d) * 180) / Math.PI;
  const v = (2 * Math.atan((t * height) / d) * 180) / Math.PI;
  return { h, v };
}

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function pick(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}

function clamp01(v, fallback = 0.5) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

function size(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n <= 8192 ? n : 0;
}

function file(f, needEncoding) {
  const out = { src: str(f?.src, 64), width: size(f?.width), height: size(f?.height) };
  if (needEncoding) out.encoding = DEPTH_ENCODING;
  return out;
}

// Fills defaults and clamps every field so the rest of the app can trust the
// object. Never throws; check validateMemory() for what was wrong.
export function normalizeMemory(input) {
  const m = input && typeof input === 'object' ? input : {};
  const scene = m.scene || {};
  const layers = Array.isArray(scene.soundLayers) ? scene.soundLayers : [];
  const anchors = Array.isArray(m.anchors) ? m.anchors : [];
  const ids = new Set();
  return {
    spec: SPEC_VERSION,
    id: isMemoryId(m.id) ? m.id : slugify(m.title),
    title: str(m.title, 60) || 'Untitled memory',
    when: str(m.when, 40),
    where: str(m.where, 40),
    createdAt: str(m.createdAt, 40) || new Date(0).toISOString(),
    photo: file(m.photo, false),
    thumb: file(m.thumb || m.photo, false),
    depth: file(m.depth, true),
    camera: {
      lens: pick(m.camera?.lens, LENSES, 'main'),
      focal35mm: Number(m.camera?.focal35mm) > 0 ? Math.min(400, Number(m.camera.focal35mm)) : null,
    },
    scene: {
      scale: pick(scene.scale, SCALES, 'room'),
      light: pick(scene.light, LIGHTS, 'warm_indoor'),
      particles: pick(scene.particles, PARTICLES, 'dust'),
      soundLayers: [...new Set(layers.filter((l) => SOUND_LAYERS.includes(l)))].slice(0, MAX_SOUND_LAYERS),
    },
    palette: (Array.isArray(m.palette) ? m.palette : []).filter((c) => HEX_RE.test(c)).slice(0, 6),
    anchors: anchors.slice(0, MAX_ANCHORS).map((a, i) => {
      let id = /^[a-z0-9-]{1,16}$/.test(a?.id) ? a.id : `a${i + 1}`;
      while (ids.has(id)) id += 'x';
      ids.add(id);
      return {
        id,
        x: clamp01(a?.x),
        y: clamp01(a?.y),
        label: str(a?.label, 32) || 'this',
        question: str(a?.question, 80) || 'What do you remember here?',
        sound: a?.sound === 'none' ? 'none' : pick(a?.sound, SOUND_LAYERS, 'none'),
        note: str(a?.note, 160),
      };
    }),
    source: {
      analysis: pick(m.source?.analysis, ['claude', 'fallback', 'manual'], 'manual'),
      model: str(m.source?.model, 40) || null,
    },
    world: world(m.world),
  };
}

// Optional: a generated splat world for this memory (server/worldlabs.js),
// files as server paths. Anything missing or malformed means no world.
const WORLD_URL_RE = /^\/api\/world\/[a-z0-9-]{1,48}\/file\/[a-z0-9._-]{1,64}$/;
function world(w) {
  if (!w || typeof w !== 'object') return null;
  const url = (v) => (typeof v === 'string' && WORLD_URL_RE.test(v) ? v : null);
  const splat = url(w.splat) || url(w.splatSmall);
  if (!splat) return null;
  const scale = Number(w.scale);
  const groundOffset = Number(w.groundOffset);
  return {
    splat,
    splatSmall: url(w.splatSmall) || splat,
    pano: url(w.pano),
    collider: url(w.collider),
    scale: scale > 0 && scale < 1000 ? scale : 1,
    groundOffset: Number.isFinite(groundOffset) && Math.abs(groundOffset) < 1000 ? groundOffset : 0,
  };
}

// Returns a list of problems; an empty list means the memory can be shown.
export function validateMemory(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return ['memory is not an object'];
  if (m.spec !== SPEC_VERSION) errors.push(`spec must be ${SPEC_VERSION}`);
  if (!isMemoryId(m.id)) errors.push('id must be lowercase letters, digits and dashes');
  for (const key of ['photo', 'thumb', 'depth']) {
    const f = m[key];
    if (!f?.src || !/^[a-z0-9._-]+$/i.test(f.src)) errors.push(`${key}.src is missing or unsafe`);
    if (!(f?.width > 0 && f?.height > 0)) errors.push(`${key} needs width and height`);
  }
  if (m.depth?.encoding !== DEPTH_ENCODING) errors.push(`depth.encoding must be ${DEPTH_ENCODING}`);
  if (!Array.isArray(m.anchors)) errors.push('anchors must be an array');
  else if (m.anchors.length > MAX_ANCHORS) errors.push(`at most ${MAX_ANCHORS} anchors`);
  return errors;
}

// Room messages. Every message is { v, type, from, at, data }.
export const MSG = {
  WELCOME: 'welcome', // server -> joiner: { peerId, room, state, peers }
  PEER_JOIN: 'peer:join', // server -> room: { peer }
  PEER_LEAVE: 'peer:leave', // server -> room: { peerId }
  PRESENCE: 'presence', // client -> room, about 15 per second, not stored
  MEMORY_OPEN: 'memory:open', // { memoryId } ask the headset to open a memory
  MEMORY_ADDED: 'memory:added', // server -> everyone: { base, spec }
  MEMORY_RESET: 'memory:reset', // { memoryId | null } clear blooms and notes
  ANCHOR_BLOOM: 'anchor:bloom', // { memoryId, anchorId } stored
  ANCHOR_NUDGE: 'anchor:nudge', // { memoryId, anchorId } not stored
  NOTE_ADD: 'note:add', // { memoryId, anchorId | null, text, author } stored
  STATE_REQUEST: 'state:request', // local rooms only
  STATE: 'state', // local rooms only: { state }
};

export const ROLES = ['headset', 'desktop', 'phone', 'mirror', 'guide', 'studio'];

// The visitor the mirror and the guide follow: whoever is inside a headset
// session first (a phone can also report WebXR support), then any headset,
// then a laptop or phone.
export function focusPeer(peers) {
  const list = [...peers.values()].filter((p) => p.presence?.head);
  return list.find((p) => p.presence.mode === 'xr')
    || list.find((p) => p.role === 'headset')
    || list.find((p) => p.role === 'desktop' || p.role === 'phone')
    || null;
}

export function emptyRoomState() {
  return { blooms: {}, notes: {} };
}

// Applies a stored message to a room state. The server and the local room
// both use this, so they agree on what a message does.
export function applyToState(state, msg) {
  const d = msg?.data || {};
  if (msg.type === MSG.ANCHOR_BLOOM && isMemoryId(d.memoryId) && typeof d.anchorId === 'string') {
    const list = (state.blooms[d.memoryId] ||= []);
    if (!list.includes(d.anchorId) && list.length < 16) list.push(d.anchorId.slice(0, 16));
  } else if (msg.type === MSG.NOTE_ADD && isMemoryId(d.memoryId) && typeof d.text === 'string' && d.text.trim()) {
    const list = (state.notes[d.memoryId] ||= []);
    list.push({
      anchorId: typeof d.anchorId === 'string' ? d.anchorId.slice(0, 16) : null,
      text: d.text.trim().slice(0, 160),
      author: str(d.author, 24) || 'someone',
      at: msg.at || Date.now(),
    });
    if (list.length > 30) list.splice(0, list.length - 30);
  } else if (msg.type === MSG.MEMORY_RESET) {
    if (isMemoryId(d.memoryId)) {
      delete state.blooms[d.memoryId];
      delete state.notes[d.memoryId];
    } else {
      state.blooms = {};
      state.notes = {};
    }
  }
  return state;
}

export const STORED_TYPES = new Set([MSG.ANCHOR_BLOOM, MSG.NOTE_ADD, MSG.MEMORY_RESET]);

export function envelope(type, data, from = null) {
  return { v: PROTOCOL_VERSION, type, from, at: Date.now(), data: data ?? {} };
}
