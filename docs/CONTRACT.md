# Contract

The shapes every part of Unfade agrees on. The code lives in `src/shared/contract.js`; this page explains it. A change to anything here is agreed by the whole team first and lands at a merge, because three people build against it at once.

## The memory (spec 1)

A memory is a folder with four files: `memory.json`, `photo.jpg`, `thumb.jpg`, `depth.png`. Bundled samples live in `public/memories/<id>/` and are listed in `public/memories/index.json`. Memories made in the studio are saved by the server in `data/memories/<id>/` and served from `/saved/<id>/`.

```json
{
  "spec": 1,
  "id": "morning-coffee",
  "title": "Morning coffee",
  "when": "October 2019",
  "where": "Our kitchen",
  "createdAt": "2026-10-24T03:12:00.000Z",
  "photo": { "src": "photo.jpg", "width": 2048, "height": 1365 },
  "thumb": { "src": "thumb.jpg", "width": 512, "height": 341 },
  "depth": { "src": "depth.png", "width": 518, "height": 350, "encoding": "rg16-disparity" },
  "camera": { "lens": "main", "focal35mm": 26 },
  "scene": { "scale": "closeup", "light": "warm_indoor", "particles": "dust", "soundLayers": ["room_tone"] },
  "palette": ["#6b3a22", "#d9c4a8"],
  "anchors": [
    { "id": "a1", "x": 0.52, "y": 0.41, "label": "the cup", "question": "Who made this cup for you?", "sound": "none", "note": "" }
  ],
  "source": { "analysis": "claude", "model": "claude-sonnet-5-5" }
}
```

| Field | Meaning and limits |
|---|---|
| `id` | Lowercase letters, digits and dashes, at most 48 characters, starting with a letter or digit. Also the folder name. |
| `title`, `when`, `where` | The person's own words: at most 60, 40 and 40 characters. `when` and `where` may be empty. |
| `photo`, `thumb`, `depth` | File name (letters, digits, `.`, `_`, `-`) with its pixel size. The photo's long edge is at most 2048 px, the thumb's 512 px. |
| `depth.encoding` | Always `rg16-disparity`: 16-bit relative disparity, high byte in red, low byte in green, 1 is nearest. The depth map's size is the model's input size, not the photo's. |
| `camera.lens` | `main`, `ultrawide`, `selfie` or `telephoto`. Sets the field of view when the photo has no focal length in its EXIF. |
| `camera.focal35mm` | 35 mm equivalent focal length from EXIF, or `null`. Wins over `lens`. |
| `scene.scale` | `closeup`, `room`, `street` or `landscape`. Picks the near and far distances that disparity maps onto: 0.45 to 2.4 m, 1 to 6.5 m, 2 to 28 m, 3 to 70 m. |
| `scene.light` | `warm_indoor`, `cool_indoor`, `daylight`, `golden_hour`, `overcast`, `night`, `candlelight`. |
| `scene.particles` | `dust`, `snow`, `rain`, `fireflies`, `confetti`, `petals`, `mist`, `none`. |
| `scene.soundLayers` | Up to three of `room_tone`, `wind`, `rain`, `waves`, `stream`, `fire`, `birds`, `crickets`, `city`, `night_air`. Never music. |
| `palette` | Up to six hex colours from the photo, most common first. |
| `anchors` | Zero to three spots. `x` and `y` are 0 to 1 from the top left of the photo. `label` at most 32 characters, `question` at most 80, `note` at most 160 (the person's own words, shown once the spot is back). `sound` is a layer name or `none`. A memory with no anchors gets one in the centre. |
| `source.analysis` | `claude`, `fallback` or `manual`: who suggested the anchors. |

`normalizeMemory()` fills defaults and clamps every field and never throws; `validateMemory()` returns the list of problems that would stop a memory from showing. Every page runs both on everything it loads.

Questions ask and never tell. Nothing in a memory states a fact about the person's life that they did not write themselves.

## Rooms (protocol 1)

Everyone with the same room code shares one darkroom. The code comes from `?room=` (default `demo`). `joinRoom()` in `src/shared/room.js` connects to the server's `/ws` and falls back to a room inside the browser (a BroadcastChannel between tabs on one machine) when there is no server; `?net=local` forces the local room. Both have the same interface:

```js
const room = await joinRoom({ name: 'Omar', role: 'guide' });
room.kind; room.room;           // 'ws' (through the server) or 'local' (this device only); the cleaned room code
room.peerId; room.peers;        // Map of peerId -> { peerId, name, role, presence }
room.state;                     // { blooms: { memoryId: [anchorId] }, notes: { memoryId: [note] } }
room.on('anchor:bloom', (msg) => {});   // returns an unsubscribe function; also 'status' and 'state'
room.send('anchor:bloom', { memoryId, anchorId });   // applies locally, then sends
room.presence({ ... });         // throttled to about 15 a second
room.close();
```

This interface is frozen. `src/net/ws-room.js` (Thread) may change how it connects, never what it exposes. A page that starts while the server is down stays on its local room until it is reloaded.

Roles: `headset`, `desktop`, `phone`, `mirror`, `guide`, `studio`. Every message is `{ v: 1, type, from, at, data }`.

| Type | Data | Stored | Sent by |
|---|---|---|---|
| `welcome` | `{ peerId, room, state, peers }` | | server, to a new peer |
| `peer:join`, `peer:leave` | `{ peer }`, `{ peerId }` | | server |
| `presence` | see below | | headset, laptop, phone |
| `memory:open` | `{ memoryId }` | | guide; every world page except the mirror opens it |
| `memory:added` | `{ base, spec }` | | server, after the studio saves |
| `memory:reset` | `{ memoryId }` or `{ memoryId: null }` for all | yes, clears | guide, Shift+R |
| `anchor:bloom` | `{ memoryId, anchorId }` | yes | whoever brought the spot back |
| `anchor:nudge` | `{ memoryId, anchorId }` | | guide; the spot pulses |
| `note:add` | `{ memoryId, anchorId, text, author }` | yes, last 30 | guide |

Stored messages change the room state through `applyToState()`, which the server and the local room share, so a page that reloads gets the blooms and notes back.

Presence, in the coordinates of the space the sender is in (the darkroom or the open memory), so every viewer agrees where things are:

```js
{
  space: 'hub' | 'memory',
  memoryId: 'the-cat' | null,
  head: { p: [x, y, z], q: [x, y, z, w] },
  hands: { l: [x, y, z], r: [x, y, z] },        // either may be missing
  held: { memoryId, develop: 0.62 } | null,
  mode: 'xr' | 'desktop' | 'phone',
}
```

`focusPeer(peers)` picks who the mirror and the guide follow: someone in a headset session first, then any headset, then a laptop or phone.

## HTTP API

One Node server (`server/index.js`). In development it listens on `http://localhost:8787` and Vite proxies `/api`, `/saved` and `/ws` to it. For the demo it serves the built pages too, on `https://<laptop>:8443`.

| Request | Body | Answer |
|---|---|---|
| `GET /api/health` | | `{ ok, claude, model, analysesLeft, rooms, lan }` |
| `GET /api/memories` | | `{ memories: [{ base, spec }] }`, bundled first, then saved |
| `POST /api/memories` | `{ memory, photo, thumb, depth }`, files as data URLs, at most 15 MB in all | `201 { base, spec }`, and `memory:added` goes to every room |
| `DELETE /api/memories/:id` | | `{ removed }`; saved memories only |
| `POST /api/analyze` | `{ image, width, height, hints, stats }`, the image as a data URL with its long edge at most 2600 px | `{ analysis, source, model, warning?, cached? }` |
| `GET /saved/:id/:file` | | the file |

`/api/analyze` always answers 200 with something usable. With no key, over the cap, or when Claude fails, `source` is `fallback`, `analysis.anchors` is empty, and `warning` says why. `analysis` has `titleSuggestion`, `scale`, `light`, `particles`, `soundLayers`, `lens` and `anchors` (with `x` and `y` already turned into 0 to 1).

## Interfaces between parts

- Sound (`src/sound/soundscape.js`): `createAudio()` returns `{ unlock(), ready, ambience(layers, { gain }), scene(layers), oneShot(name) }`. `unlock()` must run inside a click or the Enter VR press. `scene()` returns `{ setVivid(0..1), swell(layer), stop(seconds) }`; one-shots are `tick`, `unclip`, `developed`, `step-in`, `bloom`, `revive`, `leave`, `drip`.
- Memories (`src/shared/memories.js`): `listMemories()` returns `[{ base, spec }]` from the server, or from the bundled list without one; `fileUrl(item, 'photo' | 'thumb' | 'depth')`; `loadDepth(url)` returns `{ width, height, data }` with data from 0 to 1.
- Claude (`server/claude.js`): `hasKey()`, `MODEL`, `fallbackAnalysis(stats)`, `analyzeWithClaude({ base64, mediaType, width, height, hints })` returning the `analysis` object above.
- Brand (`src/shared/brand.js`): `APP_NAME`, `TAGLINE`, `applyBrand(page)`. Renaming the project is a one-line change there.
