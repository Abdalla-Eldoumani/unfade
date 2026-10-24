import { LocalRoom } from './room-local.js';
import { WsRoom } from '../net/ws-room.js';

// One way to join a room, whatever carries the messages.
//   ?net=local  same-machine tabs only (BroadcastChannel), no server needed
//   default     the server's WebSocket; falls back to local if it never connects
//
// Both return the same interface:
//   room.kind ('ws' or 'local'), room.room (the cleaned room code)
//   room.peerId, room.peers (Map), room.state ({ blooms, notes })
//   room.on(type, fn) -> unsubscribe   (types from MSG, plus 'status' and 'state')
//   room.send(type, data)              broadcast to the others (and apply locally)
//   room.presence(data)                throttled pose updates
//   room.close()
export async function joinRoom({ room = 'demo', name = 'guest', role = 'desktop', net } = {}) {
  const params = new URLSearchParams(location.search);
  const mode = net || params.get('net') || 'ws';
  const opts = { room: sanitizeRoom(params.get('room') || room), name, role };
  if (mode === 'local') return new LocalRoom(opts);
  const ws = new WsRoom(opts);
  const ok = await ws.ready(2500);
  if (ok) return ws;
  ws.close();
  console.info('room server not reachable, using a local room');
  return new LocalRoom(opts);
}

export function sanitizeRoom(code) {
  return String(code || 'demo').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'demo';
}
