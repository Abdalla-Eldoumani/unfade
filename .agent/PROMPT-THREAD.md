# Unfade: the Thread part (server, rooms, sound, guide, start page)

You are working with the person who owns the Thread part of Unfade, a WebXR piece built at MRUHacks 2026 (Calgary, Friday 9 PM to Sunday 9 AM; judged live at the table on Sunday morning). The Thread is everything that ties the pieces into one demo that does not break: the one Node server, the rooms that let the headset, the projector and a phone share a memory, every sound, the guide panel beside the headset, the start page, and the network the demo runs on. Read this whole prompt, then `docs/DESIGN.md`, then `docs/CONTRACT.md`, then the files you own, before changing anything.

## What Unfade is

A faded instant print hangs on a drying line in a darkroom lit by a red safelight. The visitor takes it off the line, shakes it until it develops, holds it up to their eyes, and is standing inside the photo, still faded. Each light in the scene asks a question only they could answer ("Who made this cup for you?"). Looking at a light for about a second brings the colour back around it; bringing all of them back returns the whole memory with the sound of the place. Someone beside the headset can follow along on the guide panel, add what they remember ("She slept on the radiator every winter"), and watch it write itself into the memory. The theme of the hackathon is revitalizing something that no longer feels the way it used to.

## What you own

- `server/index.js` (static pages, `/api`, `/saved`, the WebSocket upgrade, spending caps), `server/rooms.js` (relay and stored room state), `server/store.js` (saving memories with size and type checks).
- `src/net/ws-room.js` (the WebSocket room, with reconnects).
- `src/sound/soundscape.js`: every sound, synthesized with Web Audio. No audio files and no music.
- `guide.html` and `src/guide/` (the companion panel), `index.html` and `src/landing/` (the start page).
- `scripts/` (setup, certificate, checks) and `README.md`. The Claude part of `npm run check` lives in `server/claude.check.js`, which the Studio owner keeps; check.mjs only calls it. `scripts/xr-check.mjs` belongs to the World owner, since it drives the darkroom.

You read but do not edit: `src/shared/` (contract, room interface, local room, tokens), `server/claude.js` and `server/claude.check.js` (the Studio owner's; you call their exports), `src/world/`, `src/studio/`. The room interface in `docs/CONTRACT.md` is frozen: ws-room.js may change how it connects, never what it exposes.

## Where it stands (tested before you got it)

Tested in headless Chromium against both the dev setup and the production build (`npm run build`, then `npm start` on https://localhost:8443):
- The server serves every page with cross-origin isolation headers, answers `/api/health` (including the laptop's network addresses), lists bundled and saved memories, saves new ones and broadcasts `memory:added` to every room, deletes saved ones, and refuses paths outside `dist/`.
- Rooms relay presence and the stored messages, replay blooms and notes to a page that reloads, drop clients that stop answering pings, and limit each client to 40 messages a second.
- The guide follows whoever is in the headset (falling back to a laptop or phone), shows the open memory with its spots, sends notes that appear in the memory, makes a spot glow, opens a memory on the headset, and resets the room with a two-tap confirm.
- The start page shows a strip of film with the four destinations, the exact address to type into the headset, a room code that every link carries, and whether Claude is on.
- `npm run cert` names the laptop's current addresses; `npm run check` validates the samples, the room rules and the Claude request shape.

Not tested yet: a real hotspot with the Quest on it, the Windows firewall prompt, the headset sleeping and waking mid-demo, the guide on a real phone, and any sound on the Quest's speakers.

## The work, in order

P0 means the demo fails without it. Do them first and in this order.

1. P0. The demo network, end to end. Laptop hotspot on (Windows: Settings, Network and internet, Mobile hotspot; the laptop is usually 192.168.137.1 on it), the Quest and a phone on it, `npm run cert`, `npm run build`, `npm start`. Get the headset onto `https://<laptop>:8443/world.html`, the mirror on the laptop, the guide on the phone, all in one room. Handle the firewall: when Windows asks about Node.js, tick both Private and Public (the hotspot counts as a public network, and an unticked box becomes a block rule that beats every allow rule); README has the fix for a prompt that was cancelled. Then put the headset to sleep for a minute and wake it. Done when all three stay connected for 30 minutes, the headset rejoins within 5 seconds of waking, and the README's demo steps match exactly what you did.
2. P0. The guide on a real phone, as a judge's companion would use it: it shows what the headset sees within a second, a note appears in the memory, "Make it glow" pulses the right spot, "Open on the headset" works, and "Reset for the next visitor" returns everything to faded in one confirmed tap. Done when a second person runs the guide without help.
3. P0. Sound on the headset. Meta Quest Browser has no console without developer mode, so build the check into your own page: a `?sounds` panel on the start page with one button per layer and per one-shot, using `createAudio` from soundscape.js. Open `https://<laptop>:5173/?sounds` in Meta Quest Browser (an ordinary 2D tab plays through the same speakers as VR); the first press unlocks sound. `ambience()` and `scene()` return a handle that plays until you call its `stop()`, so stop one before starting the next or they pile up. Nothing clips, nothing is harsh, and every layer sounds like what it is called. The darkroom's room tone level belongs to the World owner (the gain in startHubSound in src/world/main.js, now 0.45): if it should change, send them the number. Done when each layer and one-shot has been heard on the headset and adjusted where needed. The engine's API (`createAudio`, `unlock`, `ambience`, `scene`, `oneShot`, the layer and one-shot names) stays exactly as it is.
4. P0. One demo laptop, one command each: write down in the README the exact start sequence you used for item 1, including setting `ANTHROPIC_API_KEY` in that terminal, and test it from a cold boot of the laptop. Done when someone else on the team starts the demo from the README alone.
5. P1. Resilience: kill and restart the server mid-demo. A page that was connected reconnects by itself (ws-room.js retries with backoff); a page opened while the server was down stays on its local room until it is reloaded, because joinRoom in the frozen src/shared/room.js tries the server only once. Confirm both, and that saved memories are still there (room state lives in memory, so starting fresh is acceptable; say so on the guide if it happens). Make the guide and the start page say plainly when the server is gone and when it is back, and tell the person to reload a page that shows "this device only".
6. P1. Sound that follows the moment: the memory's ambience starts muffled and opens up as colour returns; the bloom and revive one-shots should feel like the colour arriving. Tune inside the engine. If you want sounds placed at the anchors in 3D, write the API change for the World owner instead of doing it.
7. P1. The start page as the table's front door: make the headset address readable from two metres, and add the mirror and guide addresses for this laptop. No new dependencies (that rules out a QR library).
8. P2. A short "what just happened" line on the guide after a visitor finishes: which spots came back and the notes that were added, ready to read aloud to the judge.

Out of scope: rendering in the headset, the studio's flow and Claude's prompt, the memory format, and new dependencies.

## Facts worth knowing

- Node 22.12 or newer (20.19 also works); ws 8.22.0 is the only server dependency. The server is plain `node:http`/`node:https`.
- Dev: the server listens only on 127.0.0.1:8787 and Vite (https on 5173, reachable on the network) proxies `/api`, `/saved` and `/ws` to it. Demo: one process on 8443 with the certificate from `.cert/`, or 8080 without one (the headset will refuse plain HTTP).
- Campus networks usually isolate devices from each other; that is why the demo uses a hotspot.
- Every response carries COOP and COEP headers so the studio's depth model can use several threads; any new route must keep them.
- Saved memories live in `data/memories/<id>/` and are never committed. The analysis cap is `UNFADE_MAX_ANALYSES` (default 150), 6 per minute, 2 at once.
- A Quest may suspend the page when the headset sleeps; the room client reconnects with backoff up to 5 seconds and the server replays the room state on every join.

## How to check your work

- `curl -s http://localhost:8787/api/health` (dev) or `curl -sk https://localhost:8443/api/health` (demo).
- `npm run check`, `npm run build`, then `npm start` and the three pages on three devices.
- In two browser tabs on one laptop with `?net=local`, the guide and the world talk without the server, which is a quick way to test the guide's interface.

Tell your owner, after each task: what you changed, what you tested on which device, and anything you could not test.

## How the team works (the same in all four prompts)

Three or four people build Unfade at MRUHacks 2026, each in their own folders, against one frozen contract. Nobody waits on anybody: every page already runs on its own with the three sample memories, and without the server it falls back to a room shared between browser tabs on one machine (`?net=local`).

- The parts: World (the darkroom and the memories, in the headset), Studio (photo to memory), Thread (server, rooms, sound, the guide panel, the start page), and Content if there is a fourth person (real photos made into memories, the submission, the sign, the rehearsals; no code). Ownership is by folder and `CLAUDE.md` lists it. Edit only your own files.
- Shared and frozen: `src/shared/` (contract.js, brand.js, memories.js, room.js, room-local.js, tokens.css), `package.json`, `package-lock.json`, `vite.config.js`, `.gitignore`, `.gitattributes`, `public/memories/`, `public/fonts/`, `docs/CONTRACT.md`, `docs/DESIGN.md`, `CLAUDE.md`, `.claude/settings.json`, `.agent/`. If your work needs one of these to change, stop, write the change and the reason in one short paragraph for the owner to take to the team chat, and carry on with a workaround inside your own folder. Never add a dependency.
- When you learn something that would have saved time (a command, a gotcha, a decision), add one line to your part's notes file, creating it if needed: World `src/world/CLAUDE.md`, Studio `src/studio/CLAUDE.md`, Thread `server/CLAUDE.md`, Content `docs/submission/CLAUDE.md`. Never the root `CLAUDE.md`: separate files keep the merges free of conflicts.
- Read `docs/CONTRACT.md` (memory file, room messages, HTTP API, the interfaces between parts) and `docs/DESIGN.md` (tokens, the beat-by-beat experience, sound, words) before the first edit.
- Branches: work on your own branch (`world`, `studio`, `thread` or `content`) of the team's GitHub repository; its first push is `git push -u origin <branch>`. Push only your own branch. After each team merge, bring main in with `git fetch origin`, then `git merge origin/main`. The merges are Saturday 2:00 PM, 5:00 PM and 11:30 PM (the last one for features); after that, fixes only. The project is submitted by Sunday 8:30 AM and the repository must be public.
- MRUHacks asks that each person understands their own code. At the end of every working session, explain to your owner in plain words what changed and why, so they can answer a judge's question about it.
- Your owner may be steering you from a phone through Remote Control while you run on their laptop. Keep each report short enough to read on a phone: lead with pass or fail and the check behind it, then what changed, then at most one decision with your recommendation. They cannot see the laptop's screen, so look at your own screenshots and say what they show.

Commands (every command is Git Bash on Windows, never PowerShell):
- `npm install`, then `npm run setup` once (copies the ONNX runtime, downloads the depth model), then `npm run cert` (again after changing networks).
- Two background processes for building: `npm run server` (API and rooms on 8787) and `npm run dev` (pages on https://localhost:5173, reachable from the headset at https://<laptop address>:5173). Start both with run_in_background and poll their output; never run them in the foreground.
- The first time Node listens on the network (`npm run dev` or `npm start`), Windows asks whether Node.js may use it. The person ticks both Private and Public, then Allow access: the laptop's own hotspot counts as a public network, and a box left unticked becomes a block rule that beats every allow rule. README.md has the fix if the prompt was cancelled.
- To free a port: `netstat -ano | findstr :5173` shows the process id in the last column, then `taskkill //PID <id> //F` ends it (the doubled slashes stop Git Bash from turning `/PID` into a path).
- `npm run check` (samples against the contract, room rules, Claude request shape) and `npm run build` must pass before any merge.
- Pages: `/` start, `/world.html` the darkroom (`?debug` exposes `window.unfade`, `?mirror` follows the headset, `?memory=<id>` opens one directly, `?room=<code>`), `/studio.html`, `/guide.html`.
- Without a headset: with `npm run server` and `npm run dev` running in the background, `npm run xr-check` plays the whole loop on an emulated Quest 2 (Meta's IWER runtime in a headless Chrome or Edge) with every sample memory, prints pass or fail per step and saves screenshots in `xr-shots/`; read them to see the result. It proves the flow, not the frame rate or the feel. By hand, Meta's Immersive Web Emulator extension for Chrome (version 2) emulates a Quest: click its toolbar button on the page to turn it on, then drive the headset and controllers from the overlay it adds.

Execution discipline:
- Long-running processes never run in the foreground: background them and poll with bounded checks.
- Two or three related commands per Bash call at most; one hung link freezes a chain.
- Every wait has a deadline: past it, kill the process on its port, record, and proceed or report.
- Same command failing twice: stop, capture the error, change approach; never retry harder.
- On a stale-read rejection, read the file again and re-apply; never force the write.
- Absolute paths on Windows (C:/...); confirm the working directory before file operations.
- Done means demonstrated: build ran, tests ran, the artifact was exercised with evidence.
- A partial pass is a fail: report verdicts as binary, with captured output as the evidence.

Before writing code:
- Read the code the change touches and trace the real flow first; the ladder shortens the solution, never the reading.
- Then stop at the first rung that holds: not needed at all; already in this codebase; stdlib; native platform; installed dependency; one line; only then the minimum that works.
- Never add a dependency for what a few lines cover; never add an abstraction, config, or file nobody asked for.
- Never cut: validation at trust boundaries, data-loss handling, security, accessibility, anything explicitly requested.
- Bug fix: grep every caller of the function you touch and fix the shared function once.
- A deliberate corner with a known limit carries a `shortcut:` comment naming the limit and the trigger to revisit it.
- Code first; then at most three lines on what was skipped and when to add it.

Commits and anything public:
- One file per commit: `git add <file>` then `git commit -m "<message>"`. Never `git add .`, `git add -A` or `git commit -a`, and never commit from an editor's source control panel, which batches silently.
- The first line of a message is lowercase, imperative, about 50 characters, and describes the code change: "tune the shake threshold for quest controllers". No task numbers. The Co-Authored-By line Claude Code adds below it is fine on this project.
- Pushes are never forced; the hooks block that.
- Comments explain why, never what, and stay shorter than the code they sit on.
- Any text a visitor reads follows docs/DESIGN.md: plain words, questions that ask and never tell, no emoji, no em dashes, no exclamation marks, nothing that claims a fact about the person's life.
- Secrets live only in environment variables. Never write a key into a file, and never ask anyone to paste one into this chat.
- Personal photos are saved by the studio into `data/` on the demo laptop and are never committed.
