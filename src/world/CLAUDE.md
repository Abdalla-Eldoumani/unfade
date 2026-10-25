# World notes

## Gotchas
- `date` in Git Bash prints laptop local time (Mountain); `TZ=America/Edmonton date` does not work there and prints UTC.
- `npm run xr-check` with both servers up takes about a minute for all three samples (30 steps). The screenshots are the only view of the run.
- xr-check parks the right controller at (0, 1.55, -0.12) to step in, then lowers it to the hip pointing at the floor, so its dot no longer covers the inside and revived shots.
- Editing any file under src/ while xr-check or another browser check runs makes Vite reload the page mid-run: the check fails with `window.unfade` undefined. Edit between runs.
- The mirror must only follow presence that is in its own space: the headset changes space before the mirror's fade does, and reading memory coordinates in the darkroom sent the camera to 0.6 m (floor) or 3.1 m. Checked with a soak: an emulated Quest playing the loop and a ?mirror tab in one ws room, every mirror frame compared with the headset's head. Before: steps up to 1.28 m in one frame. After: 7 minutes, 3 loops, 2,567 frames, largest step 0.028 m, no jumps.
- Everyone in a memory stands where its camera stood, so two visitors usually share one spot and each one's light was inside the other's head. Within NEAR_M (presence.js) a light now slides out along its owner's gaze. Checked with a laptop and a phone-sized touch tab in one ws room: lights within 0 m of the true head when 0.6 m apart, 0.5 m ahead along the gaze when sharing the spot, both visible.
- Depth edges when the head moves: the haze behind the photo used to show a sharp copy of the photo through the gaps, a ghost second cup or rocket from 0.2 m of lean. Now (shaders.js GAP_BLUR, memory-scene.js GAP_FILL, both switchable) the haze there blurs as the eye moves 0.03 to 0.2 m from where the camera stood and shows a background plate: the photo at 160 px with the background across each depth edge grown in over the near side, as far as a 0.2 m head movement can open a gap at that memory's depths (about 42 plate px for close-ups, 8 for landscapes). From the camera spot the look is unchanged. The plate takes 31 to 48 ms on this laptop whatever the depth map's size (studio maps are 686x518 to 924x518, the samples 518x350) and is built on the first frame inside, under the full paper fade.
- Soft depth edges smeared into streaks because the model spreads a step over 2 to 4 cells. Now each cell also cuts on the log-depth range across its neighbours (WINDOW_CUT in depth-mesh.js, close-ups and rooms only) and the shader cuts hard at 0.5 instead of dithering. The window at 0.3 on a landscape cut the thin launch towers away whole, hence per scale. Checked with lean shots (0.2 m right) on the cat and launch-night, and xr-check 34 of 34.
- Generated worlds (world-splat.js, Spark 2.3.1): Marble's world stands upright, not along the photo, and it reads the photo's field of view its own way (the espresso close-up became a cup on a cafe table, about 0.5x our lens). Its panorama is centred on the photo's heading, so `findPhotoView` matches a 40 px colour copy of the photo against it for tilt, turn and width: the cat (0, 2), the cafe (0, -41), launch-night (0, 19), a living room (0, -2). Luminance alone locked onto wood grain at -78.
- A close-up's subject is a front-only shell a hand's width away: walking back shows its dark, torn back. WALK_M is 0.2 m for close-ups and 1 m otherwise; WASD stops 0.35 m short of the collider GLB (same transform as the splat); a headset fades to paper past the reach. Culling splats near the camera or capping maxPixelRadius did not help.
- Software rendering cannot draw splats: 500k crashed the tab and 100k ran the scene clock about 3x real time, so the title's full moment fell between frames. xr-check now uses the GPU (XR_SOFTWARE=1 for the old way); 100k splats in the emulated Quest are 394,352 triangles both eyes.
- Fades count capped frame steps (main.js updateFade), not clock time: a long frame (the plate, a shader compiling) used to jump the fade-in by its own length.
- Scratch checks that proved tasks 2 and 4 to 8 (window readout, step-in filmstrip at timescale 0.08, mirror soak, two visitors, lean shots) lived in the session scratchpad, not the repo; the method for each is in the line above it here.
- The title card must sit nearer than the photo's surface: for close-up memories the surface below centre is under 1.25 m away and buries a title placed at 1.25 m.
- three r186 has no multiview here: in XR every object draws once per eye, so calls and triangles are about twice a laptop's.
- In XR three keeps `camera.fov` in step with the headset's projection, but not `camera.aspect` (it stays the window's).
- `performance.now()` can still be under 1000 on the first frames after load; never treat 0 as "long ago".
- To film a motion in the emulator, slow the scene clock: `unfade.stage.timer.setTimescale(0.08)`; screenshots are slower than the motion otherwise.
- In the emulator (mono and stereo) the darkroom's ceiling and floor discs draw over a print held big and close, as if its depth were wrong; cause not found. The rising print draws on top (Print.setOnTop) so the step-in never shows it.

## Performance levers (turn in this order if the headset drops frames)
1. `PARTICLE_SHARE` in particles.js, 1 now, try 0.5. The darkroom dust and every memory's particles.
2. `FRAMEBUFFER_SCALE` in stage.js, 1 now, try 0.8. Fixed when the session starts (xr-check sets 0.35 on its own).
3. `SEGMENTS` in depth-mesh.js, 220 now, 160 next: a memory goes from about 135k to 74k triangles (both eyes).
4. `HAZE_DETAIL` in shaders.js, 2 now, 1 next (drops the ragged bloom edges in the haze). 0 is one flat colour and shows the depth-edge gaps as dark cracks: last resort.
All four were run turned down (0.5, 160, 1, then haze 0) with xr-check or the window: no errors.

## Draw calls and triangles (xr-check on the emulated Quest 2, both eyes, readout and controllers included)
| Scene | Calls | Triangles | Triangles at SEGMENTS 160 |
|---|---|---|---|
| Darkroom | 72 | 1,432 | 1,432 |
| morning-coffee | 36 | 135,248 | 74,368 |
| the-cat | 36 | 134,368 | 73,728 |
| launch-night | 36 | 135,248 | 74,368 |

Inside a memory, 36 calls is with the right controller in view; xr-check now lowers it after stepping in and prints 32. Revived adds the title and its shade: 4 more calls.

Laptop window, one view: darkroom 31 calls, 378 triangles; the-cat 14 calls, 66,848 triangles. The frame times from xr-check and the laptop say nothing about the Quest.

## Questions only the headset can answer
- Frame time in the darkroom and inside each sample (target: at most 14 ms on the readout).
- Line height (0.28 m below the eyes) and distance (0.85 m): reachable without leaning?
- Shake threshold 0.55 m/s: does a natural shake count every reversal, and does carrying the print count by mistake?
- Step-in at 0.3 m from the eyes: too early, too late?
- Gaze 7 degrees for 1.1 s: does it bloom by accident while looking around, or feel slow?
- Question text (0.042 m lines at 1.5 m) and the title card: readable without squinting?
- Does the controller held near the eyes after stepping in block the first look at the memory?
- Hands: does pinch take a print and step in; does shaking a tracked hand count?
- The ?debug readout sits about 31 degrees below centre (DOWN_XR in readout.js): readable through the lens with foveation at 1, or move it up?
- Darkroom draws 72 calls for 1,432 triangles: fine at 72 fps, or worth merging the static meshes?
- Step-in (RISE_S 0.8, FLASH_S 0.3, RISE_M 0.32, RISE_GROW 6 in main.js): does the print growing to fill the view read as falling in, or as something flying at the face? Too fast, too slow?
- Two visitors in one memory: is the other's light 0.5 m out along their gaze (NEAR_M) helpful or in the way? The lights draw over the photo: do they feel like they float in the room or stuck to the lens?
- Leaning inside a memory: with the background plate, do the gaps read as soft background or as smudges? The cut edges still step along the mesh grid (worst on close-ups): noticeable at headset resolution?
- Does the print stutter in the hand about half a second after it is taken? The memory's mesh is built then (14 to 22 ms on this laptop, maybe 3 to 5 times that on the Quest). If so, build it during the flash, the way the plate is.
- The background plate on the Quest CPU: how long is the stall under the paper fade (31 to 48 ms here)?
- The mirror on a projector with a real headset (72 fps head, presence at 15 a second): smooth enough at 1 - exp(-dt * 8) for position and 6 for turning, or does it lag?
- The return (COLOUR_AFTER_S 0.5, TITLE_AFTER_S 2.4 in memory-scene.js): does the swell, then colour, then title land as one moment? Is the title (0.095 m lines at 1.25 m, nearer for close-ups) readable, and does the dark shade behind it look like light falling off or like a smudge?
