import '../shared/tokens.css';
import './guide.css';
import { applyBrand } from '../shared/brand.js';
import { MSG, focusPeer } from '../shared/contract.js';
import { fileUrl, listMemories } from '../shared/memories.js';
import { joinRoom } from '../shared/room.js';

// The companion: someone next to the headset (or a twin on their phone)
// sees which memory is open, adds what they remember, and runs the demo.
applyBrand('guide');
const $ = (s, r = document) => r.querySelector(s);
const params = new URLSearchParams(location.search);
const ui = {
  status: $('.guide-status'),
  where: $('.now-where'),
  title: $('.now-title'),
  photoBox: $('.now-photo'),
  photo: $('.now-photo img'),
  dots: $('.now-dots'),
  anchors: $('.now-anchors'),
  form: $('.note-form'),
  memories: $('.memories'),
  peers: $('.peers'),
  reset: $('.reset'),
};

let items = new Map();
let room;
let current = null;

async function start() {
  for (const item of await listMemories()) items.set(item.spec.id, item);
  room = await joinRoom({ name: params.get('name') || 'guide', role: 'guide' });
  ui.form.author.value = localStorageGet('unfade-guide-name') || '';
  for (const type of [MSG.PEER_JOIN, MSG.PEER_LEAVE, MSG.ANCHOR_BLOOM, MSG.NOTE_ADD, MSG.MEMORY_RESET, 'state', 'status']) {
    room.on(type, () => render());
  }
  room.on(MSG.MEMORY_ADDED, (msg) => {
    items.set(msg.data.spec.id, msg.data);
    render();
  });
  room.on(MSG.PRESENCE, () => renderNow());
  render();
  setInterval(renderNow, 500);
}

function headsetPeer() {
  return focusPeer(room.peers);
}

function render() {
  ui.status.textContent = `room ${room.room} · ${room.kind === 'ws' ? 'live' : 'this device only'}`;
  ui.peers.replaceChildren(
    ...[...room.peers.values()].map((p) => li(`${p.name || 'someone'} · ${p.role}`)),
    li(`you · guide`),
  );
  ui.memories.replaceChildren(
    ...[...items.values()].map((item) => {
      const el = document.createElement('li');
      const ids = item.spec.anchors.length ? item.spec.anchors.map((a) => a.id) : ['center'];
      const back = ids.every((id) => (room.state.blooms[item.spec.id] || []).includes(id));
      el.className = back ? 'is-back' : '';
      el.innerHTML = `<img alt="" src="${fileUrl(item, 'thumb')}" /><span>${escapeHtml(item.spec.title)}</span>`;
      const open = document.createElement('button');
      open.className = 'ghost';
      open.textContent = 'Open on the headset';
      open.addEventListener('click', () => room.send(MSG.MEMORY_OPEN, { memoryId: item.spec.id }));
      el.append(open);
      return el;
    }),
  );
  renderNow(true);
}

function renderNow(force = false) {
  const peer = headsetPeer();
  const p = peer?.presence;
  const id = p?.space === 'memory' ? p.memoryId : p?.held?.memoryId || null;
  current = (id && items.get(id)) || null;
  if (!peer) ui.where.textContent = 'Waiting for the headset';
  else if (p.space === 'memory') ui.where.textContent = `${peer.name || 'The headset'} is inside`;
  else if (p.held) ui.where.textContent = `${peer.name || 'The headset'} is developing`;
  else ui.where.textContent = `${peer.name || 'The headset'} is in the darkroom`;
  ui.title.textContent = current?.spec.title || '';
  ui.photoBox.hidden = !current;
  ui.form.hidden = !current;
  if (!current) {
    ui.anchors.replaceChildren();
    ui.anchors.dataset.key = '';
    return;
  }
  const src = fileUrl(current, 'photo');
  if (ui.photo.getAttribute('src') !== src) ui.photo.src = src;
  ui.photoBox.style.aspectRatio = `${current.spec.photo.width} / ${current.spec.photo.height}`;
  const bloomed = room.state.blooms[current.spec.id] || [];
  const anchors = current.spec.anchors.length ? current.spec.anchors : [{ id: 'center', x: 0.5, y: 0.5, label: 'this moment', question: 'What do you remember here?' }];
  const key = JSON.stringify([current.spec.id, bloomed, (room.state.notes[current.spec.id] || []).length]);
  if (!force && key === ui.anchors.dataset.key) return;
  ui.anchors.dataset.key = key;
  ui.dots.replaceChildren(
    ...anchors.map((a, i) => {
      const d = document.createElement('span');
      d.className = `dot ${bloomed.includes(a.id) ? 'is-back' : ''}`;
      d.style.left = `${a.x * 100}%`;
      d.style.top = `${a.y * 100}%`;
      d.textContent = String(i + 1);
      return d;
    }),
  );
  const notes = room.state.notes[current.spec.id] || [];
  ui.anchors.replaceChildren(
    ...anchors.map((a, i) => {
      const el = document.createElement('li');
      const back = bloomed.includes(a.id);
      el.className = back ? 'is-back' : '';
      const said = notes.filter((n) => n.anchorId === a.id).map((n) => `<p class="said">${escapeHtml(n.text)} <span class="edge">${escapeHtml(n.author)}</span></p>`).join('');
      el.innerHTML = `<p class="edge">${i + 1} · ${escapeHtml(a.label)} · ${back ? 'back' : 'still faded'}</p><p class="q">${escapeHtml(a.question)}</p>${said}`;
      if (!back) {
        const nudge = document.createElement('button');
        nudge.className = 'ghost';
        nudge.textContent = 'Make it glow';
        nudge.addEventListener('click', () => room.send(MSG.ANCHOR_NUDGE, { memoryId: current.spec.id, anchorId: a.id }));
        el.append(nudge);
      }
      return el;
    }),
  );
  const select = ui.form.anchor;
  const previous = select.value;
  select.replaceChildren(...anchors.map((a, i) => new Option(`${i + 1} · ${a.label}`, a.id)));
  if (anchors.some((a) => a.id === previous)) select.value = previous;
}

ui.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = ui.form.text.value.trim();
  if (!text || !current) return;
  const author = ui.form.author.value.trim() || 'guide';
  localStorageSet('unfade-guide-name', author);
  room.send(MSG.NOTE_ADD, { memoryId: current.spec.id, anchorId: ui.form.anchor.value || null, text, author });
  ui.form.text.value = '';
});

let resetArmed = 0;
ui.reset.addEventListener('click', () => {
  if (Date.now() - resetArmed < 3000) {
    room.send(MSG.MEMORY_RESET, { memoryId: null });
    ui.reset.textContent = 'Reset for the next visitor';
    resetArmed = 0;
    return;
  }
  resetArmed = Date.now();
  ui.reset.textContent = 'Click again to fade everything';
  setTimeout(() => {
    if (resetArmed && Date.now() - resetArmed >= 3000) ui.reset.textContent = 'Reset for the next visitor';
  }, 3100);
});

function li(text) {
  const el = document.createElement('li');
  el.textContent = text;
  return el;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function localStorageGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function localStorageSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {
    // private mode; the name is just not remembered
  }
}

start().catch((err) => {
  ui.where.textContent = `Something went wrong: ${err.message}`;
});
