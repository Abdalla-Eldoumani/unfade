# Demo plan

Judging is Sunday 10:00 AM to noon at the table, live, no slides, several judges, each comparing us with the last table they saw. A judge's screen shows only our title and table number, so the title and the sign carry the memory of us. Two people stay at the table the whole time.

## The table

- The laptop facing the judges with the mirror open (`https://localhost:8443/world.html?mirror`), full screen. This is the second screen: whoever is not in the headset watches the colour come back here.
- The Quest 2, charged, already on `world.html` inside the darkroom, face cover wiped. A charger and a spare cable. Glasses spacer if you have one.
- A phone on the hotspot with the guide (`/guide.html`), held by the person beside the headset.
- A printed sign: the name, the line "Shake a faded photo. Step back inside it.", and the table number.
- Optional but strong: a real instant print of one of the photos on the table, faded on purpose (left in a window or printed light).

## The 90 seconds

The first 15 seconds decide it: the print has to be in the judge's hand and shaking before anyone explains anything.

| Time | Judge does | We say or do |
|---|---|---|
| 0:00 | Puts on the headset | "There's a photo hanging in front of you. Take it off the line and shake it." |
| 0:15 | Shakes, hears it tick, sees it develop | Nothing. Let it develop. |
| 0:25 | Hears the chime | "Hold it up to your eyes." |
| 0:30 | Is inside the faded photo | "It's faded, like the real memory. Look at one of the lights." |
| 0:45 | First spot comes back, reads the question | Guide person adds a note on the phone; it writes itself into the memory. |
| 1:10 | All spots back, the title appears | "That's a photo of [whose] [what]. Everything you saw came from that one phone photo." |
| 1:20 | Takes the headset off | Turn the laptop: studio, drop a photo, Develop, the spots appear, hang it, and it lands on the line in the headset. |

Then answer questions. The second judge (if any) watches the mirror the whole time.

## What to say when they ask how

- One photo, no 3D capture: a depth model (Depth Anything V2 Small) runs in the browser on the laptop, and every pixel is pushed out along the ray the camera saw it on, so standing still you see the photo exactly and leaning gives real depth.
- No app on the headset: it is a web page in Meta Quest Browser using WebXR, served over HTTPS from this laptop. The same page runs on a laptop or phone as a window.
- The revival is a shader: the photo starts drained and blurred toward the paper colour, and colour spreads out from each spot with an uneven edge, like ink in water.
- The questions come from Claude, with rules: it may only ask, never tell, and it may not guess names, dates or what happened. That is on purpose. Pataranutaporn and colleagues (CHI 2025, DOI 10.1145/3706598.3713697) found that AI-edited images raised false recollections, and AI-generated videos made from them roughly doubled them compared with unedited images. So Unfade never edits or generates the photo, and nothing it writes claims a fact about your life.
- Everyone in a room shares the memory: the headset, the projector and a phone stay in sync over WebSockets on one small Node server, so a twin or a parent can be in the memory too.
- Every sound is synthesized in the browser. No audio files, no music.

## Between judges

- Guide, "Reset for the next visitor" (tap twice). Every print fades again.
- Back to the darkroom in the headset (B or Y), wipe the face cover.
- Every hour: headset battery above 40 percent or on the charger.

## If something breaks

- The headset will not load: check it is on the hotspot, type the address with `https://` in front, reload, accept the certificate again. If it still times out, the Windows firewall is the usual cause: README.md, step 4 of the demo setup. Meanwhile, run the whole loop on the laptop in the mirror window's place (`world.html`, drag to look, Space to shake, Enter to step in).
- The headset loads but the room shows "this device only": the server is down or unreachable; it still works alone. Restart `npm start` and reload.
- Claude is down or the cap is reached: the studio says so and lets you place the spots yourself. Keep one personal memory pre-made for the studio part of the demo anyway.
- Sound is silent: press a button once more; browsers only start sound after a press.

## The fourth person

A fourth teammate (or whoever is free on Saturday night) owns the content and the story, not code: real photos with consent made into memories on the demo laptop, the submission on the MRUHacks platform, the sign, the rehearsals and a 60-second backup video. `.agent/PROMPT-CONTENT.md` is their prompt.
