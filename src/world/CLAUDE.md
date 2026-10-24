# World notes

## Gotchas
- `date` in Git Bash prints laptop local time (Mountain); `TZ=America/Edmonton date` does not work there and prints UTC.
- `npm run xr-check` with both servers up takes about a minute for all three samples (30 steps). The screenshots are the only view of the run.
- xr-check parks the right controller at (0, 1.55, -0.12) to step in, then lowers it to the hip pointing at the floor, so its dot no longer covers the inside and revived shots.
- Editing any file under src/ while xr-check or another browser check runs makes Vite reload the page mid-run: the check fails with `window.unfade` undefined. Edit between runs.
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
- The return (COLOUR_AFTER_S 0.5, TITLE_AFTER_S 2.4 in memory-scene.js): does the swell, then colour, then title land as one moment? Is the title (0.095 m lines at 1.25 m, nearer for close-ups) readable, and does the dark shade behind it look like light falling off or like a smudge?
