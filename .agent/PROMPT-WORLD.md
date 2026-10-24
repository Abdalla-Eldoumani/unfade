# Unfade: the World (headset) part

You are working with the person who owns the World part of Unfade, a WebXR piece built at MRUHacks 2026 (Calgary, Friday 9 PM to Sunday 9 AM; judged live at the table on Sunday morning). Your job is to make the moment inside the headset feel finished and reliable on a real Meta Quest 2. The team does not have the headset in hand yet, so the work below starts with everything you can prove without it. Read this whole prompt, then `docs/DESIGN.md`, then `docs/CONTRACT.md`, then the files in `src/world/`, before changing anything.

## What Unfade is

A faded instant print hangs on a drying line in a darkroom lit by a red safelight. The visitor takes it off the line, shakes it until it develops, holds it up to their eyes, and is standing inside the photo, still faded. Each light in the scene asks a question only they could answer ("Who made this cup for you?"). Looking at a light for about a second brings the colour back around it; bringing all of them back returns the whole memory with its sound and its title in the person's own words. The theme of the hackathon is revitalizing something that no longer feels the way it used to, and this is that, literally.

A memory is built from one ordinary photo: the studio estimates depth in the browser, and the world pushes every pixel out along the ray the camera saw it on, so standing still the visitor sees the photo exactly and moving their head gives real parallax.

## What you own

`world.html` and everything in `src/world/`: stage.js (renderer, camera, XR session, head pose from the XRFrame), hub.js (the darkroom and the line), print.js (the developing print), memory-scene.js (one memory around the viewer), depth-mesh.js (photo plus depth to triangles), shaders.js (print, memory, haze, particles, ring), anchors.js (the lights), particles.js, xr-input.js (controllers and hands), desktop-input.js (mouse, touch, phone motion), presence.js (other people as lights), hud.js and world.css (the overlay on laptops and phones), text.js (text and glows as textured planes), main.js (wires it all together and talks to the room). Also `scripts/xr-check.mjs`, the check that plays the darkroom on an emulated Quest 2.

You read but do not edit: `src/shared/`, `src/sound/soundscape.js` (call its API as documented), `public/memories/`.

## Where it stands (tested before you got it)

Tested in headless Chromium with a software GPU and in Meta's IWER emulation of a Quest 2:
- Darkroom with the three sample memories clipped to the line, faded to 0.3. In VR the line moves to 0.28 m below the head when the session starts, clamped between 0.95 and 1.5 m.
- Trigger (or click, or tap) takes a print. Shaking counts direction reversals of the controller above 0.55 m/s (Space or a side-to-side drag on a laptop, a swipe or real shaking on a phone). Each shake adds 0.11, the print also develops 0.03 per second by itself, and at 0.98 it chimes.
- Holding the developed print within 0.3 m of the eyes, or pulling the trigger again, steps in: paper flash 0.7 s, fade in 1.2 s, memory placed so the visitor's eyes are where the camera was.
- Inside: a 220-segment depth mesh with unshared vertices, where only triangles stretched across a depth cliff dissolve; a haze sphere behind it that matches the photo's look and shares its bloom uniforms, so gaps read as soft focus; particles; up to three anchor lights. Gaze within 7 degrees for 1.1 s (or point and pull the trigger) blooms a spot; colour spreads 0.45 photo-heights over 2.2 s; all spots back turns the whole photo vivid over 2.6 s and writes the title card. For the first 2.5 s looking cannot bloom anything, so the faded version is seen first (pointing and pulling the trigger works at once).
- B or Y (or Esc) goes back to the darkroom; the grip button puts a print back. Notes, nudges, resets and new memories arrive from the room.
- `?mirror` follows whoever is in a headset session and shows what they see; other visitors appear as soft lights with their names.
- `npm run xr-check` passes: on an emulated Quest 2 it takes each of the three sample prints, shakes it, steps in, brings every light back and presses B, saving screenshots of each stage.

Not tested anywhere yet: a real Quest 2 (frame rate, comfort, controller feel, text size, hand tracking), and two real devices inside one memory.

## The work, in order

Two stages: first everything a laptop, the emulator and `npm run xr-check` can prove, with the knobs the headset will need made ready to turn; then, the moment the headset arrives, the list only the headset can answer. When it arrives, stop and do that list first. P0 means the demo fails without it.

### Now, without the headset

1. P0. Keep `npm run xr-check` passing (start `npm run server` and `npm run dev` in the background first). Run it before and after every change to `src/world/`, and read the screenshots it saves in `xr-shots/`. When your change moves a debug hook it relies on (`window.unfade`, `hub.prints`, `held`, `mode`, `memory.progress()`), update `scripts/xr-check.mjs` in the same piece of work. Done when it passes with all three samples after your last change.
2. P0. A readout behind `?debug`: frame time over the last second, draw calls and triangles from `renderer.info.render`, and the last error message, drawn with makeText near the bottom of the view. On the headset there is no other way to see errors without developer mode. Done when an intentional error shows in it, in the xr-check screenshots and in the window on the laptop.
3. P0. Make the performance levers ready before the headset arrives: particle count, the framebuffer scale set before the session starts, mesh segments (220 now; 160 is the first step down) and haze detail each become one named constant at the top of its file. Write the draw calls and triangles the readout shows for the darkroom and for each sample memory into `src/world/CLAUDE.md`. The laptop's frame rate says nothing about the Quest, but those two numbers carry over. Done when each lever is one constant and the numbers are recorded.
4. P1. The step-in moment. Make it feel like falling into the photo rather than a cut: for example the print rises and grows to fill the view during the paper flash. Keep the camera still; only the print and the fade may move (comfort). Done when it reads as one continuous motion in the emulator by hand; it gets confirmed on the headset.
5. P1. The return. When the last spot comes back, make sure the title card is readable, centred below the eye line, and that the moment lands: sound swell (call the existing API), colour, then the title. Done when the revived screenshots from xr-check show the title readable and centred; three people describing the ending without being asked waits for the headset.
6. P1. The mirror on a projector or laptop: smooth, no jitter, the caption shows who is inside, the memory's title and how many spots are back. Done when a `?mirror` tab follows another tab in the emulator, in and out of a memory, for five minutes without a jump.
7. P2. Two visitors in one memory: a laptop and a phone (or two tabs) in the same room, each seeing the other as a light in the right place. Use the existing presence messages.
8. P2. Depth edges when leaning: if halos or stretched edges show while leaning (WASD on the laptop), try smoothing the depth only near cliffs, or a second layer for the background. Keep whatever you try behind a constant so it can be switched off.

Keep a list in `src/world/CLAUDE.md` of every question only the headset can answer as you meet it, so the first hour with it goes to that list.

### The first hour with the headset

9. P0. Run it on the headset. Put the Quest on the same hotspot as your laptop, run `npm run cert` (it adds the laptop's current addresses), start `npm run server` and `npm run dev` in the background, and open `https://<laptop address>:5173/world.html` in Meta Quest Browser (Advanced, then Proceed past the certificate warning). Fix whatever breaks. Done when the whole loop (take, shake, step in, bring back all three spots, go back) works on the headset with each of the three sample memories.
10. P0. Hold 72 frames per second on the Quest 2 in the darkroom and inside each sample memory. If it drops, turn the levers from task 3 in this order: fewer particles, framebuffer scale below 1, fewer mesh segments, simpler haze. Record the numbers you measured in the commit message of the change that fixed it. Done when the readout shows at most 14 ms per frame in every scene.
11. P0. Tune for a first-time visitor on the real device: line height and distance, print size, shake sensitivity, the step-in distance, gaze angle and dwell, text sizes, bloom radius and speed, and how much of the view a memory fills. A memory is built at its photo's true field of view, so it can feel like a window; widening it a little in depth-mesh.js (scale tanH and tanV together, try 1.2) may feel more like being there, and nobody notices the stretch. The numbers above are the starting values. Most are named constants at the top of a file: the print's feel in main.js (DEVELOPED, SHAKE_STEP, SELF_DEVELOP, SHAKE_SPEED, STEP_IN_M, LINE_BELOW_EYES), gaze in anchors.js (DWELL_S, LOOK_DEG), blooms in memory-scene.js (BLOOM_S, BLOOM_RADIUS, REVIVE_S) and FADED_LEVEL in print.js. The rest are plain numbers where they are used: the line's 0.95 to 1.5 m limits in hub.js setLine, the 2.5 s grace and the 0.94 anchor offset in memory-scene.js, and the 0.7 s and 1.2 s fades and the 8 degree trigger angle in main.js. Turn each one you tune into a named constant, and run xr-check after tuning, since the shake, dwell and step-in numbers drive it too. Then hand the headset to someone who has never seen it and say only "shake it". Done when that person reaches the title card in under 90 seconds without help, twice, with two different people.
12. P1. Hands. Put the controllers down and try it with hand tracking: pinch takes a print and steps in, shaking the hand develops it. xr-input.js already falls back to the pointer pose when a hand has no grip space. Done when the loop works with hands only.

Out of scope: the server, the room code, the studio, the guide panel, the sound recipes, the start page, and any change to the contract. If you need the sound engine to do something new, write the request for the Thread owner.

## Facts worth knowing

- three.js 0.186.1. In a session, three only updates its XR camera while rendering; that is why stage.head() reads the viewer pose from the XRFrame and placement waits for a real pose. Keep it that way.
- No controller models: they would load from a CDN. The rays and dots in xr-input.js are drawn locally.
- The memory's coordinates: the group sits at the visitor's eye position facing their yaw; anchor positions come from the depth mesh at 94 percent of their distance so they float just in front of the surface.
- Quest Browser needs HTTPS; the self-signed certificate is accepted once per address.
- The emulator and IWER are good for flow, not for performance or feel. Only the headset answers those.

## How to check your work

- Laptop: `https://localhost:5173/world.html?debug&net=local`, then in the console `unfade.openDirect('the-cat')`, `unfade.memory.anchors`, `unfade.room.send('anchor:bloom', { memoryId: 'the-cat', anchorId: 'a1' })`, `unfade.room.send('memory:reset', { memoryId: null })`.
- `npm run xr-check` for the VR flow, after every change, with its screenshots; Chrome with the Immersive Web Emulator to try something by hand; the real headset for frame rate and feel.
- Before each merge: `npm run check`, `npm run build`, `npm run xr-check`, and once the headset is in hand, the full loop on it with one sample memory.

Tell your owner, after each task: what you changed, what you checked and how (xr-check, the emulator, or the headset), and anything that still needs the headset.

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
