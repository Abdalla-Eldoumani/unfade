import { MSG, STORED_TYPES, applyToState, emptyRoomState, envelope } from './contract.js';

// A room that lives in the browser: tabs on the same machine talk through a
// BroadcastChannel. Good for building without the server; the WebSocket room
// has the same interface.
export class LocalRoom {
  constructor({ room, name, role }) {
    this.kind = 'local';
    this.room = room;
    this.peerId = Math.random().toString(36).slice(2, 10);
    this.self = { peerId: this.peerId, name, role };
    this.peers = new Map();
    this.state = emptyRoomState();
    this.handlers = new Map();
    this.lastPresence = 0;
    this.channel = new BroadcastChannel(`unfade-room-${room}`);
    this.channel.onmessage = (e) => this.receive(e.data);
    this.post(envelope(MSG.PEER_JOIN, { peer: this.self }, this.peerId));
    this.post(envelope(MSG.STATE_REQUEST, {}, this.peerId));
    addEventListener('pagehide', () => this.post(envelope(MSG.PEER_LEAVE, {}, this.peerId)));
    queueMicrotask(() => this.emit('status', { connected: true, kind: 'local' }));
  }

  ready() {
    return Promise.resolve(true);
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

  send(type, data) {
    const msg = envelope(type, data, this.peerId);
    if (STORED_TYPES.has(type)) applyToState(this.state, msg);
    this.post(msg);
    this.emit(type, msg);
  }

  presence(data) {
    const now = performance.now();
    if (now - this.lastPresence < 66) return;
    this.lastPresence = now;
    this.post(envelope(MSG.PRESENCE, { ...data, name: this.self.name, role: this.self.role }, this.peerId));
  }

  post(msg) {
    try {
      this.channel.postMessage(msg);
    } catch {
      // channel closed
    }
  }

  receive(msg) {
    if (!msg || msg.from === this.peerId) return;
    if (msg.type === MSG.PEER_JOIN) {
      this.peers.set(msg.from, { ...msg.data.peer, presence: null });
      this.post(envelope(MSG.PEER_JOIN + ':ack', { peer: this.self }, this.peerId));
      this.emit(MSG.PEER_JOIN, msg);
      return;
    }
    if (msg.type === MSG.PEER_JOIN + ':ack') {
      if (!this.peers.has(msg.from)) {
        this.peers.set(msg.from, { ...msg.data.peer, presence: null });
        this.emit(MSG.PEER_JOIN, msg);
      }
      return;
    }
    if (msg.type === MSG.PEER_LEAVE) {
      this.peers.delete(msg.from);
      this.emit(MSG.PEER_LEAVE, msg);
      return;
    }
    if (msg.type === MSG.STATE_REQUEST) {
      this.post(envelope(MSG.STATE, { state: this.state }, this.peerId));
      return;
    }
    if (msg.type === MSG.STATE) {
      // Keep whichever state has more in it; good enough for local testing.
      const incoming = msg.data.state || emptyRoomState();
      if (JSON.stringify(incoming).length > JSON.stringify(this.state).length) {
        this.state = incoming;
        this.emit('state', this.state);
      }
      return;
    }
    if (msg.type === MSG.PRESENCE) {
      const peer = this.peers.get(msg.from) || { peerId: msg.from, name: msg.data.name, role: msg.data.role };
      peer.presence = msg.data;
      this.peers.set(msg.from, peer);
    } else if (STORED_TYPES.has(msg.type)) {
      applyToState(this.state, msg);
    }
    this.emit(msg.type, msg);
  }

  close() {
    this.post(envelope(MSG.PEER_LEAVE, {}, this.peerId));
    this.channel.close();
  }
}
