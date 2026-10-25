# Unfade

Shake a faded photo. Step back inside it.

## Why we made it

Most photos end up in a camera roll nobody opens, and the moment behind them fades with them. We wanted a way to stand inside one photo again and bring it back by remembering it, with the people who were there, without the app making anything up about it.

## What it is

A faded instant print hangs on a line in a darkroom. You take it down and shake it until it develops, hold it up to your eyes, and you are standing inside the photo, still faded. A few lights in the scene each ask you something only you would know, and looking at one brings the colour back around it, until the whole memory returns with the sound of the place.

It runs in a Meta Quest through Meta Quest Browser, and in any laptop or phone browser as a window you look around in. A phone beside the headset follows along, and a projector shows what the visitor sees.

## How it works

- **One ordinary photo, no 3D capture.** A depth model (Depth Anything V2 Small) runs in the browser, and every pixel is pushed out along the ray the camera saw it on. Standing still you see the photo exactly; moving your head gives real parallax. Where depth edges open gaps, a background plate grown from the photo fills them.
- **A place around the photo that fits it.** A memory stands inside its own 360 panorama when it has one. Otherwise Claude picks one of fifteen CC0 panoramas only when it is clearly the same kind of place (indoors or out, time of day, season, weather), and when none fits, the photo's own colours surround it instead of a wrong place. The surroundings are matched to the photo's brightness, blurred where they meet the photo, and come into focus as the memory comes back. With a World Labs key, the studio can also build a full 3D world from the photo (a Gaussian splat drawn with Spark), turned so the photo's own view lines up inside it.
- **Questions that ask and never tell.** Claude (Opus 5.5) looks at the photo and suggests up to three spots and a question for each. It may only ask: no names, no dates, no guesses about what happened. That is on purpose. Pataranutaporn and colleagues (CHI 2025, DOI 10.1145/3706598.3713697) found that AI-edited images raised false recollections, and AI-generated videos made from them roughly doubled them compared with unedited images. So Unfade never edits or generates the photo, and nothing it writes claims a fact about your life.
- **No app on the headset.** It is a web page using WebXR, served over HTTPS from one laptop on a hotspot. The headset, a projector mirror and a phone guide share one room over WebSockets, so someone beside you can add what they remember and watch it write itself into the memory.
- **The revival is a shader.** The photo starts drained toward the paper colour, and colour spreads out from each spot with an uneven edge, like ink in water.
- **Every sound is synthesized** in the browser. No audio files, no music.

## The studio

Drop in a photo or a short video (a video gives the frame a third of the way in), title it in your own words, and press Develop. The print comes up through the cream while the depth model reads it and Claude suggests the spots. You can drag the spots, change any question, add what you remember, see the place it will stand in, and hang it on the line. It appears in the headset's darkroom straight away. Personal photos stay on the demo laptop and are never committed.

## What was hard

- **Depth edges.** A single photo only shows the front of things, so leaning opens gaps behind every edge. We cut the mesh at depth cliffs, fill the gaps with a background plate, and keep the cuts invisible from where the camera stood.
- **A headset with no console.** Meta Quest Browser shows no errors without developer mode, so `?debug` draws frame time, draw calls and the last error inside the headset.
- **Lining a generated world up with the photo.** Marble gives no camera pose, so the photo's turn, tilt and width are found by matching a small copy of it against the world's panorama.
- **Walking into nothing.** A generated close-up is a shell a hand's width away, so walking stops at its collider on a laptop, and in a headset the view fades to paper past the reach the world holds up.
- **The network at the venue.** Campus Wi-Fi blocks one device from reaching another, so everything runs over a hotspot, with a self-signed certificate and a firewall rule on both profiles.
- **Testing without the headset.** `npm run xr-check` plays the whole loop on an emulated Quest 2 in headless Chrome (take the print, shake, step in, bring back every light, leave) and fails loudly when a step breaks.

## What we learned

- Abdalla: You can build for a headset without having one in hand. An emulated Quest that plays the whole loop caught most of our bugs before the real headset arrived. A single photo and a depth model give real parallax, as long as the gaps at the edges are hidden well.
- Primel: Keeping a headset, a phone and a projector in one shared room over WebSockets, and that sound made in the browser can carry a place without a single audio file.
- Seyar: How Gaussian splat worlds work, and how to line a generated world up with the photo it came from when the service gives no camera position.
- Dawood: What it takes to make a VR demo clear to someone putting on a headset for the first time.

## Built with

three.js, WebXR, Meta Quest Browser, onnxruntime-web, Depth Anything V2 Small, the Claude API (Opus 5.5), World Labs Marble, Spark, Node.js, ws, Vite, the Web Audio API, Poly Haven, and Meta's Immersive Web Emulator (IWER) with Playwright. We used AI coding assistants for parts of the build; the prompts and notes we worked from are in the repository.

## Team

- Abdalla Eldoumani: the world (darkroom, memory, shaders, surroundings) and the studio
- Primel Jayawardana: the thread (server, rooms, guide, start page, sound) and the sample memories
- Seyar Ghulom Hazrat: generated worlds with World Labs, and the Claude key handling
- Dawood Shees: testing on the headset and the demo at the table
