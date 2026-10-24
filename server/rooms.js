import { WebSocketServer } from 'ws';
import { MSG, STORED_TYPES, applyToState, emptyRoomState, envelope, ROLES } from '../src/shared/contract.js';

// Rooms relay messages between the headset, the mirror, the guide and the
// studio. The server keeps each room's blooms and notes so a page that
// reloads gets them back.
const CLIENT_TYPES = new Set([
  MSG.PRESENCE,
  MSG.MEMORY_OPEN,
  MSG.MEMORY_RESET,
  MSG.ANCHOR_BLOOM,
  MSG.ANCHOR_NUDGE,
  MSG.NOTE_ADD,
]);
const MAX_PER_SECOND = 40;

export class Rooms {
  constructor() {
    this.rooms = new Map();
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    this.wss.on('connection', (ws, req) => this.join(ws, req));
    this.heartbeat = setInterval(() => this.ping(), 15000);
  }

  handleUpgrade(req, socket, head) {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
  }

  room(code) {
    if (!this.rooms.has(code)) this.rooms.set(code, { code, peers: new Map(), state: emptyRoomState() });
    return this.rooms.get(code);
  }

  join(ws, req) {
    const q = new URL(req.url, 'http://x').searchParams;
    const code = String(q.get('room') || 'demo').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'demo';
    const room = this.room(code);
    const peer = {
      peerId: Math.random().toString(36).slice(2, 10),
      name: String(q.get('name') || 'guest').slice(0, 24),
      role: ROLES.includes(q.get('role')) ? q.get('role') : 'desktop',
      presence: null,
    };
    ws.peer = peer;
    ws.alive = true;
    ws.budget = { at: Date.now(), count: 0 };
    ws.on('pong', () => (ws.alive = true));
    room.peers.set(peer.peerId, ws);

    send(ws, envelope(MSG.WELCOME, {
      peerId: peer.peerId,
      room: code,
      state: room.state,
      peers: [...room.peers.values()].filter((w) => w !== ws).map((w) => w.peer),
    }));
    this.broadcast(room, envelope(MSG.PEER_JOIN, { peer }), ws);

    ws.on('message', (raw) => this.receive(room, ws, raw));
    ws.on('close', () => {
      room.peers.delete(peer.peerId);
      this.broadcast(room, envelope(MSG.PEER_LEAVE, { peerId: peer.peerId }), null);
    });
  }

  receive(room, ws, raw) {
    const now = Date.now();
    if (now - ws.budget.at > 1000) ws.budget = { at: now, count: 0 };
    if (++ws.budget.count > MAX_PER_SECOND) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || !CLIENT_TYPES.has(msg.type)) return;
    const clean = envelope(msg.type, msg.data && typeof msg.data === 'object' ? msg.data : {}, ws.peer.peerId);
    if (clean.type === MSG.PRESENCE) {
      clean.data.name = ws.peer.name;
      clean.data.role = ws.peer.role;
      ws.peer.presence = clean.data;
    }
    if (STORED_TYPES.has(clean.type)) applyToState(room.state, clean);
    this.broadcast(room, clean, ws);
  }

  broadcast(room, msg, except) {
    const text = JSON.stringify(msg);
    for (const ws of room.peers.values()) if (ws !== except) sendText(ws, text);
  }

  broadcastAll(msg) {
    for (const room of this.rooms.values()) this.broadcast(room, msg, null);
  }

  ping() {
    for (const room of this.rooms.values()) {
      for (const ws of room.peers.values()) {
        if (!ws.alive) {
          ws.terminate();
          continue;
        }
        ws.alive = false;
        ws.ping();
      }
    }
  }

  summary() {
    return [...this.rooms.values()].map((r) => ({
      room: r.code,
      peers: [...r.peers.values()].map((w) => ({ name: w.peer.name, role: w.peer.role })),
    }));
  }

  close() {
    clearInterval(this.heartbeat);
    this.wss.close();
  }
}

function send(ws, msg) {
  sendText(ws, JSON.stringify(msg));
}

function sendText(ws, text) {
  if (ws.readyState === ws.OPEN) ws.send(text);
}
