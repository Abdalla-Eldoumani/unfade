# Unfade

Shake a faded photo. Step back inside it.

A faded instant print hangs on a line in a darkroom. Pick it up and shake it until it develops, then hold it up to your eyes and you are standing inside the photo, still faded. Each light in the scene asks you something only you would know ("Who made this cup for you?"). Look at it long enough and the colour comes back around it. Bring all of them back and the whole memory returns, with the sound of the place.

It runs in a Meta Quest 2 through Meta Quest Browser, and in any desktop or phone browser as a window you look around in. A companion page lets someone beside the headset add what they remember, and a mirror page shows a projector what the visitor sees.

The 3D scene comes from one ordinary photo: a depth model runs in the browser and every pixel is pushed out along the ray the camera saw it on, so standing still you see the photo exactly and moving your head gives real parallax. Claude, if a key is set, looks at the photo and suggests the spots and the questions. Everything else runs on one laptop.

## What you need

- Node 22.12 or newer (20.19 also works) and Git. On Windows, run every command below in Git Bash.
- Chrome or Edge on the laptop. Without a headset, `npm run xr-check` plays the loop on an emulated Quest 2, and Meta's Immersive Web Emulator extension for Chrome lets you do it by hand.
- A Meta Quest 2 (or 3) for the real thing, set up and signed in.

## Set up (once)

```bash
npm install
npm run setup      # copies the ONNX runtime and downloads the depth model (27 MB, checked by hash)
npm run cert       # self-signed HTTPS certificate for this laptop's addresses
```

`npm run setup` is the only step that needs the internet besides Claude. Run `npm run cert` again whenever the laptop joins a different network, since the certificate names the laptop's current addresses.

## Build and try it

Two terminals:

```bash
npm run server     # API and rooms on http://localhost:8787
npm run dev        # pages on https://localhost:5173
```

Open https://localhost:5173. The browser warns about the certificate the first time; continue anyway. Every page works without the server too: it falls back to the three sample memories and a room that lives in the browser tabs of one machine (add `?net=local` to force that).

Without a headset, use Meta's Immersive Web Emulator: open the darkroom, click the emulator's toolbar button to turn it on for the site, and after the reload an overlay on the page moves the emulated headset and controllers. DevTools, WebXR tab, sets the device and other defaults. The "Step into the darkroom" button then appears.

`npm run xr-check`, with the dev server running, plays the whole loop on an emulated Quest 2 (Meta's IWER runtime in a headless Chrome or Edge) with every sample memory: take the print, shake it, step inside, bring back every light, press B. It prints pass or fail for each step and saves screenshots in `xr-shots/`. It checks the flow, not the frame rate or how it feels; only the headset answers those.

`npm run check` validates the sample memories against the contract and checks the Claude request shape against a fake API. It needs no key and no browser.

## The demo setup

The headset has to reach the laptop directly, and campus networks such as eduroam usually block one device from reaching another. Use a hotspot instead.

### macOS

The simplest option is an iPhone Personal Hotspot with the Mac, Quest and phone all on it. Alternatively, use Mac Internet Sharing (System Settings, General, Sharing, Internet Sharing: share from Ethernet or another Wi-Fi to devices using Wi-Fi).

1. Connect the Mac, the Quest and a phone to the same hotspot.
2. On the Mac, in a terminal:
   ```bash
   npm run cert
   npm run build
   export ANTHROPIC_API_KEY="your key"
   npm start
   ```
3. The server prints the addresses it is reachable on, for example `https://172.20.10.2:8443/`. The landing page at `/` shows the same addresses in large text.
4. In the Quest, open Meta Quest Browser and go to `https://<address>:8443/world.html`. It warns that the connection is not private: choose Advanced, then Proceed. Press "Step into the darkroom".
5. On the Mac or a projector, open `https://localhost:8443/world.html?mirror`. On the phone, open `https://<address>:8443/guide.html`.

If the macOS firewall is enabled (System Settings, Network, Firewall), allow incoming connections for Node in Firewall Options.

### Windows

1. On the laptop: Settings, Network and internet, Mobile hotspot, turn it on. The laptop's address on its own hotspot is usually 192.168.137.1. A phone hotspot with both devices on it works too.
2. Connect the Quest to that hotspot.
3. On the laptop: `npm run cert`, then `npm run build`, then `npm start`. The server prints the addresses it is reachable on, for example `https://192.168.137.1:8443/`.
4. The first time Node listens on the network, Windows asks whether Node.js may use it. Tick both Private networks and Public networks, then Allow access. Windows counts the laptop's own hotspot as a public network, and a box left unticked becomes a block rule, which beats every allow rule. If that prompt was cancelled or answered with Private only, open CMD as administrator, run `where node`, delete Node's old rules with the line below (using the first path it printed), then start the server again and answer the prompt with both boxes ticked:
   `netsh advfirewall firewall delete rule name=all program="C:\Program Files\nodejs\node.exe"`
   After the event you can untick Public again in Windows Security, Firewall and network protection, Allow an app through firewall.
5. In the Quest, open Meta Quest Browser and go to `https://<laptop address>:8443/world.html`. It warns that the connection is not private: choose Advanced, then Proceed. Press "Step into the darkroom".
6. On the laptop or a projector, open `https://localhost:8443/world.html?mirror`. On a phone on the same hotspot, open `/guide.html`.

The landing page at `/` shows the exact address to type into the headset, the mirror and guide addresses, and whether Claude is on.

### Claude

Questions and spots come from Claude when the server has a key. Set it in the terminal that runs the server, never in a file and never in a chat with an AI tool:

```bash
export ANTHROPIC_API_KEY="your key"     # this terminal only
npm start
```

On Windows, `setx ANTHROPIC_API_KEY "your key"` stores it for new terminals. Without a key the studio still works: you place the spots yourself and each one asks "What do you remember here?". The server caps analyses at 150 per run and 6 per minute (`UNFADE_MAX_ANALYSES` changes the first), and remembers answers for photos it has already seen. `UNFADE_MODEL` picks the model, `claude-sonnet-5-5` by default.

## Using it

In the headset:
- Point at a print and pull the trigger to take it off the line.
- Shake it to develop it. A faint print develops slowly on its own as well.
- Bring it up to your eyes (or pull the trigger again) to step inside.
- Look at a light for about a second to bring that part back. Pointing at it and pulling the trigger works too.
- B or Y goes back to the darkroom. The grip button puts a print back.

On a laptop: drag to look, click a print, drag side to side or tap Space to shake, Enter to step in, WASD to lean a little inside a memory, Esc to go back.
On a phone: tap a print, swipe or shake the phone (after "Use motion"), tap to step in.

## Making a memory

Open `/studio.html` on the laptop (or on a phone on the hotspot). Drop in a photo or take one, write a title in your own words, then Develop. The studio estimates depth in the browser, asks Claude for up to three spots and questions, and lets you move, rewrite or remove any of them. "Hang it on the line" saves it on the laptop in `data/memories/`, and every headset in the room sees the new print arrive.

Personal photos stay on the demo laptop in `data/`, which is never committed. Only the three sample memories in `public/memories/` ship with the code.

## How it is put together

```
world.html, src/world/     the darkroom and the memories (three.js, WebXR)
studio.html, src/studio/   photo to memory: depth in the browser, Claude's suggestions, editing
guide.html, src/guide/     the companion page beside the headset
index.html, src/landing/   the start page
src/sound/                 every sound, made with Web Audio; no audio files, no music
src/net/, src/shared/      rooms, the memory format, design tokens
server/                    one Node server: pages, /api, rooms over WebSocket, saved memories
public/memories/           the sample memories
```

docs/CONTRACT.md describes the memory file, the room messages and the HTTP API. docs/DESIGN.md describes the look, the sound and the words.

## How we worked

We built Unfade with Claude Code, each of us in our own part. `.agent/` holds the team setup, the merge checklist, the demo plan and the prompt each part started from. `CLAUDE.md` is the project's rules for Claude Code, and `.claude/settings.json` holds the shared hooks that stop batch commits, force pushes, destructive git commands and dev servers started in the foreground.

## Credits

- Sample photos: "Coffee cup" by Rachel Michetti (CC0), "Chelsea the cat" by Stéfan van der Walt (CC0), both from the scikit-image sample data; the Falcon 9 and DSCOVR launch photo by SpaceX, released into the public domain.
- Depth Anything V2 Small (Apache-2.0), in the ONNX export by onnx-community on Hugging Face.
- three.js, onnxruntime-web, ws and Vite (MIT).
- Young Serif, Caveat and IBM Plex Mono under the SIL Open Font License 1.1 (licence texts in public/fonts/).
