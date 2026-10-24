import '../shared/tokens.css';
import './landing.css';
import { applyBrand } from '../shared/brand.js';
import { fileUrl, listMemories } from '../shared/memories.js';
import { sanitizeRoom } from '../shared/room.js';

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

function headsetUrls(lan) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const room = sanitizeRoom(roomInput.value);
  const tail = `/world.html${room !== 'demo' ? `?room=${room}` : ''}`;
  if (!local) return [`${location.origin}${tail}`];
  const port = location.port ? `:${location.port}` : '';
  return (lan || []).map((ip) => `${location.protocol}//${ip}${port}${tail}`);
}

async function start() {
  const [h, items] = await Promise.all([health(), listMemories().catch(() => [])]);
  const frames = [...document.querySelectorAll('.frame-img')];
  items.slice(0, frames.length).forEach((item, i) => {
    frames[i].style.backgroundImage = `url("${fileUrl(item, 'thumb')}")`;
  });

  const line = $('.server-line');
  if (!h) {
    line.textContent = 'Server not running: this device works on its own, with the three sample memories';
  } else {
    const claude = h.claude ? `Claude on (${h.model}, ${h.analysesLeft} left)` : 'Claude off, questions come from the fallback';
    line.textContent = `Server live · ${claude}`;
  }

  const showUrls = () => {
    const urls = headsetUrls(h?.lan);
    const el = $('.headset-url');
    if (!urls.length) {
      el.textContent = 'this page, from the laptop’s network address';
      return;
    }
    // keep the scheme: typed without it, a browser may try http://, which the TLS port refuses
    el.replaceChildren(...urls.map((u) => Object.assign(document.createElement('span'), { textContent: u })));
    if (location.protocol !== 'https:') {
      $('.how-small').textContent = 'This page is on plain HTTP, and the headset needs HTTPS. Run npm run cert, then start again.';
    }
  };
  roomInput.addEventListener('input', showUrls);
  showUrls();
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
