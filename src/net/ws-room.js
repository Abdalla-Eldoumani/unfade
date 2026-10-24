import { MSG, STORED_TYPES, applyToState, emptyRoomState, envelope } from '../shared/contract.js';

// The room over the server's WebSocket (/ws). Same interface as LocalRoom.
// Reconnects on its own; the server replays the room state on every join.
export class WsRoom {
  constructor({ room, name, role }) {
    this.kind = 'ws';
    this.room = room;
    this.self = { name, role };
    this.peerId = null;
    this.peers = new Map();
    this.state = emptyRoomState();
    this.handlers = new Map();
    this.queue = [];
    this.lastPresence = 0;
    this.closed = false;
    this.retry = 0;
    this.connected = false;
    this.readyWaiters = [];
    this.connect();
  }

  url() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const q = new URLSearchParams({ room: this.room, name: this.self.name, role: this.self.role });
    return `${proto}//${location.host}/ws?${q}`;
  }

  connect() {
    if (this.closed) return;
    let ws;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      this.receive(msg);
    };
    ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      if (was) this.emit('status', { connected: false, kind: 'ws' });
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose follows and handles the retry
    };
  }

  scheduleReconnect() {
    if (this.closed) return;
    const delay = Math.min(5000, 500 * 2 ** this.retry++);
    setTimeout(() => this.connect(), delay);
  }

  ready(timeoutMs = 2500) {
    if (this.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), timeoutMs);
      this.readyWaiters.push(() => {
        clearTimeout(t);
        resolve(true);
      });
    });
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    for (const fn of this.handlers.get(type) || []) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`room handler for ${type} failed`, err);
      }
    }
  }

  receive(msg) {
    if (msg.type === MSG.WELCOME) {
      const d = msg.data;
      this.peerId = d.peerId;
      this.state = d.state || emptyRoomState();
      this.peers = new Map((d.peers || []).map((p) => [p.peerId, p]));
      this.connected = true;
      this.retry = 0;
      for (const m of this.queue.splice(0)) this.ws.send(JSON.stringify(m));
      for (const w of this.readyWaiters.splice(0)) w();
      this.emit('status', { connected: true, kind: 'ws' });
      this.emit('state', this.state);
      return;
    }
    if (msg.type === MSG.PEER_JOIN) {
      this.peers.set(msg.data.peer.peerId, msg.data.peer);
    } else if (msg.type === MSG.PEER_LEAVE) {
      this.peers.delete(msg.data.peerId);
    } else if (msg.type === MSG.PRESENCE) {
      const peer = this.peers.get(msg.from) || { peerId: msg.from };
      peer.presence = msg.data;
      this.peers.set(msg.from, peer);
    } else if (STORED_TYPES.has(msg.type)) {
      applyToState(this.state, msg);
    }
    this.emit(msg.type, msg);
  }

  send(type, data) {
    const msg = envelope(type, data, this.peerId);
    if (STORED_TYPES.has(type)) applyToState(this.state, msg);
    this.emit(type, msg);
    this.raw(msg, true);
  }

  presence(data) {
    const now = performance.now();
    if (now - this.lastPresence < 66) return;
    this.lastPresence = now;
    this.raw(envelope(MSG.PRESENCE, data, this.peerId), false);
  }

  raw(msg, keepIfOffline) {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (keepIfOffline && this.queue.length < 50) this.queue.push(msg);
  }

  close() {
    this.closed = true;
    try {
      this.ws?.close();
    } catch {
      // already closed
    }
  }
}
