import '../shared/tokens.css';
import './landing.css';
import { applyBrand } from '../shared/brand.js';
import { SOUND_LAYERS } from '../shared/contract.js';
import { fileUrl, listMemories } from '../shared/memories.js';
import { sanitizeRoom } from '../shared/room.js';
import { createAudio, ONE_SHOTS } from '../sound/soundscape.js';

applyBrand();
const $ = (s) => document.querySelector(s);
const roomInput = $('#room');
const params = new URLSearchParams(location.search);
roomInput.value = sanitizeRoom(params.get('room') || readRoom() || 'demo');

// Every link carries the room code, so a team can run two darkrooms at once.
function applyRoom() {
  const room = sanitizeRoom(roomInput.value);
  saveRoom(room);
  for (const frame of document.querySelectorAll('.frame')) {
    const url = new URL(frame.dataset.href, location.href);
    if (room !== 'demo') url.searchParams.set('room', room);
    frame.querySelector('a').href = url.pathname.slice(1) + url.search;
  }
  return room;
}
roomInput.addEventListener('input', applyRoom);
$('.room-form').addEventListener('submit', (e) => e.preventDefault());
applyRoom();

// The whole frame is the target, not just the words.
for (const frame of document.querySelectorAll('.frame')) {
  frame.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    frame.querySelector('a').click();
  });
}

async function health() {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(2500), cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function lanBase(lan) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!local) return [location.origin];
  const port = location.port ? `:${location.port}` : '';
  return (lan || []).map((ip) => `${location.protocol}//${ip}${port}`);
}

function roomTail(path) {
  const room = sanitizeRoom(roomInput.value);
  return `${path}${room !== 'demo' ? `?room=${room}` : ''}`;
}

function headsetUrls(lan) {
  return lanBase(lan).map((base) => `${base}${roomTail('/world.html')}`);
}

async function start() {
  const [h, items] = await Promise.all([health(), listMemories().catch(() => [])]);
  // the fourth frame keeps its still of the projector view
  const frames = [...document.querySelectorAll('.frame-img')].slice(0, 3);
  items.slice(0, frames.length).forEach((item, i) => {
    frames[i].style.backgroundImage = `url("${fileUrl(item, 'thumb')}")`;
  });

  const line = $('.server-line');
  if (!h) {
    line.textContent = 'Server not running: this device works on its own, with the three sample memories';
  } else {
    // visitors read this page; whether Claude is on shows in the studio's header
    line.textContent = 'Server live';
  }

  const showUrls = () => {
    const urls = headsetUrls(h?.lan);
    const el = $('.headset-url');
    if (!urls.length) {
      el.textContent = 'this page, from the laptop’s network address';
      return;
    }
    // keep the scheme: typed without it, a browser may try http://, which the TLS port refuses
    el.replaceChildren(...urls.map(addressLine));
    const bases = lanBase(h?.lan);
    const mirrorEl = $('.mirror-url');
    const guideEl = $('.guide-url');
    if (bases.length) {
      const roomQ = sanitizeRoom(roomInput.value) !== 'demo' ? `?room=${sanitizeRoom(roomInput.value)}&mirror` : '?mirror';
      mirrorEl.replaceChildren(addressLine(`${bases[0]}/world.html${roomQ}`));
      guideEl.replaceChildren(addressLine(`${bases[0]}${roomTail('/guide.html')}`));
    }
    if (location.protocol !== 'https:') {
      $('.how-small').textContent = 'This page is on plain HTTP, and the headset needs HTTPS. Run npm run cert, then start again.';
    }
  };
  roomInput.addEventListener('input', showUrls);
  showUrls();

  // Poll server health so the person at the table knows when it drops or comes back.
  let wasUp = Boolean(h);
  setInterval(async () => {
    const now = await health();
    const isUp = Boolean(now);
    if (isUp === wasUp) return;
    wasUp = isUp;
    if (!isUp) {
      line.textContent = 'Server not reachable';
    } else {
      line.textContent = 'Server back';
    }
  }, 10000);
}

// An address that wraps only after the scheme and before the path, so a
// person copying it onto a headset never meets a line break inside the IP.
function addressLine(url) {
  const span = document.createElement('span');
  const m = /^(https?:\/\/)([^/]+)(.*)$/.exec(url);
  if (m) span.append(m[1], document.createElement('wbr'), m[2], document.createElement('wbr'), m[3]);
  else span.textContent = url;
  return span;
}

function readRoom() {
  try {
    return localStorage.getItem('unfade-room');
  } catch {
    return null;
  }
}

function saveRoom(room) {
  try {
    localStorage.setItem('unfade-room', room);
  } catch {
    // private mode: the code is just not remembered
  }
}

start();

if (params.has('sounds')) buildSoundsPanel();

function buildSoundsPanel() {
  const audio = createAudio();
  const active = new Map();

  const panel = document.createElement('section');
  panel.className = 'sounds-panel';

  const heading = document.createElement('h2');
  heading.textContent = 'Sound check';
  panel.append(heading);

  const unlock = document.createElement('button');
  unlock.textContent = 'Unlock audio';
  unlock.addEventListener('click', () => {
    audio.unlock();
    unlock.textContent = 'Audio unlocked';
    unlock.disabled = true;
  });
  panel.append(unlock);

  // Ambience layers
  const layerLabel = document.createElement('p');
  layerLabel.className = 'edge';
  layerLabel.textContent = 'Ambience layers';
  panel.append(layerLabel);

  const layerGrid = document.createElement('div');
  layerGrid.className = 'sounds-grid';
  for (const name of SOUND_LAYERS) {
    const btn = document.createElement('button');
    btn.className = 'ghost';
    btn.textContent = name.replace('_', ' ');
    btn.addEventListener('click', () => {
      if (active.has(name)) {
        active.get(name).stop();
        active.delete(name);
        btn.classList.remove('is-playing');
      } else {
        const handle = audio.ambience([name]);
        active.set(name, handle);
        btn.classList.add('is-playing');
      }
    });
    layerGrid.append(btn);
  }
  panel.append(layerGrid);

  // One-shots
  const shotLabel = document.createElement('p');
  shotLabel.className = 'edge';
  shotLabel.textContent = 'One-shots';
  panel.append(shotLabel);

  const shotGrid = document.createElement('div');
  shotGrid.className = 'sounds-grid';
  for (const name of ONE_SHOTS) {
    const btn = document.createElement('button');
    btn.className = 'ghost';
    btn.textContent = name;
    btn.addEventListener('click', () => audio.oneShot(name));
    shotGrid.append(btn);
  }
  panel.append(shotGrid);

  // Vivid slider for testing the muffled-to-open filter
  const vividLabel = document.createElement('p');
  vividLabel.className = 'edge';
  vividLabel.textContent = 'Scene vivid test';
  panel.append(vividLabel);

  let sceneHandle = null;
  const sceneRow = document.createElement('div');
  sceneRow.className = 'sounds-grid';
  const sceneBtn = document.createElement('button');
  sceneBtn.className = 'ghost';
  sceneBtn.textContent = 'Start scene (room tone)';
  sceneBtn.addEventListener('click', () => {
    if (sceneHandle) {
      sceneHandle.stop();
      sceneHandle = null;
      sceneBtn.textContent = 'Start scene (room tone)';
      sceneBtn.classList.remove('is-playing');
    } else {
      sceneHandle = audio.scene(['room_tone']);
      sceneBtn.textContent = 'Stop scene';
      sceneBtn.classList.add('is-playing');
    }
  });
  sceneRow.append(sceneBtn);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.05';
  slider.value = '0';
  slider.addEventListener('input', () => {
    if (sceneHandle) sceneHandle.setVivid(Number(slider.value));
  });
  sceneRow.append(slider);
  panel.append(sceneRow);

  // Stop all
  const stopAll = document.createElement('button');
  stopAll.textContent = 'Stop all';
  stopAll.addEventListener('click', () => {
    for (const [name, handle] of active) {
      handle.stop();
      active.delete(name);
    }
    if (sceneHandle) {
      sceneHandle.stop();
      sceneHandle = null;
      sceneBtn.textContent = 'Start scene (room tone)';
      sceneBtn.classList.remove('is-playing');
    }
    for (const btn of panel.querySelectorAll('.is-playing')) btn.classList.remove('is-playing');
  });
  panel.append(stopAll);

  document.querySelector('.landing').append(panel);
}
