# Design

## The idea in one line

A memory comes back the way an instant print develops: faded first, then colour returns where you pay attention.

Everything follows from the darkroom. The light is a red safelight, the surfaces are dark and warm, the photos are cream-bordered instant prints, the handwriting is a marker on the white strip of a print, and the small labels are the numbers printed along the edge of a strip of film. Nothing glows blue, nothing is glassy, and there are no gradients except light falling off.

What someone should remember afterwards: they looked at a cup in an old photo, it asked who made it for them, and the colour came back around it while they answered.

## Tokens

The CSS variables live in `src/shared/tokens.css`; the 3D scene uses the same values.

| Token | Value | Use |
|---|---|---|
| `--ink-0` | `#0c0907` | Page and scene background, the darkroom at its darkest |
| `--ink-1` | `#15100d` | Input fields, cards |
| `--ink-2` | `#211915` | Hover on dark buttons |
| `--line` | `#3a2d26` | Hairlines and borders |
| `--paper` | `#f1e9dc` | Text on dark, print borders, the flash when you step in |
| `--paper-2` | `#d9cfc0` | Secondary text on dark |
| `--paper-3` | `#9c8f80` | Labels and quiet text |
| `--safelight` | `#c8412b` | The one strong action (Develop), the lamp |
| `--safelight-glow` | `#ff6a3d` | Focus rings, the china-marker circle |
| `--ember` | `#f0a35e` | Anchor lights, links, the guide's live state |
| `--faded-cyan`, `--faded-rose` | `#a7c4c0`, `#d7afaf` | Age casts in faded images |

Type:
- Young Serif 400 for the name and big headings.
- Caveat 500 and 600 for anything a person wrote or could have written: titles, questions, notes, hints.
- IBM Plex Mono 400 and 500 for everything else: labels in small capitals with wide letter spacing, inputs, buttons.

Sizes run 12, 14, 18, 24, 32, 48, 72 px; spacing runs 4, 8, 12, 16, 24, 32, 48, 64 px. Corners are 2 px everywhere. Shadows are only ever the deep drop shadow under a print.

## The experience, beat by beat

1. The darkroom. A line at about chest height (set from the visitor's head height when they enter VR) with every memory clipped to it, faded to a third. Red light, slow dust, a quiet room tone and the odd drip.
2. Pick one up. Trigger on a controller, a click, or a tap. The print comes off its peg with a small unclipping sound.
3. Shake it. Every shake adds about a tenth and ticks; the print also develops slowly by itself. At 98 percent it chimes and the hint changes to "Hold it up to your eyes".
4. Step in. Bringing the print within 30 cm of the eyes (or pulling the trigger again) flashes to paper white over 0.7 s and fades in over 1.2 s. The memory is placed so the visitor's eyes are where the camera was.
5. The faded memory. For 2.5 s looking brings nothing back, so the faded version is seen first (a deliberate trigger pull still can). "Look at a light to bring it back" writes in under the photo.
6. Look at a light. Holding the gaze within 7 degrees for 1.1 s fills a ring and the colour spreads out from that spot over 2.2 s with an uneven, ink-like edge. Its sound swells if it has one.
7. All of them back. The whole photo returns to full colour over 2.6 s, the title and the person's when and where write in, the ambience opens up.
8. Back to the darkroom. B or Y, Esc, or the button. A fade to black, and the print now hangs at full colour.

The first 15 seconds decide a judge: the print has to be in their hand and shaking within that time.

## Motion

- The camera never moves on its own in the headset. Every change of place is a fade.
- Fades: paper white going in, ink black coming out. Smoothstep, never linear.
- UI transitions are 140 ms ease-out; anything that develops takes 900 ms on `cubic-bezier(0.22, 0.61, 0.36, 1)`.
- Anchor lights breathe slowly and never blink. Particles drift; they never rush past the face.
- With `prefers-reduced-motion`, page transitions drop to 1 ms. The scene itself has no sudden motion to remove.

## Sound

All sound is made in code with the Web Audio API: noise shaped into rooms, wind, rain, water, fire, birds, crickets, a city and night air, plus short one-shots for unclipping, shaking, developing, stepping in, a spot coming back, the whole memory returning, and leaving. There are no audio files and no music, so nothing needs a licence and nothing tells the visitor what to feel.

A memory's ambience starts quiet and muffled with the photo and opens up as the colour returns. Sound only starts after a click, a tap, or pressing Enter VR, as browsers require.

## Words

- Questions ask; they never tell. "Who made this cup for you?", never "Your grandmother made this cup." At most nine words, second person, no exclamation marks.
- Nothing on screen claims a fact about the person's life that they did not type themselves.
- Hints are short and plain: "Shake it", "Hold it up to your eyes", "Look at a light to bring it back".
- Whatever the person writes stays in their words and appears in handwriting.
- No mention of AI on the visitor's screens. The studio says plainly that a small copy of the photo goes to Claude and everything else stays on the laptop.

## What fails on sight

Purple or blue gradients, glassy panels, emoji, rounded cards with a coloured left border as their only idea, default Inter, a centred hero with three feature cards, confetti for its own sake, any sound that is music, any line of copy that tells the visitor what they felt.
