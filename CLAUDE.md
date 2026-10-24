## Working principles
- Think before coding: state the plan in one or two lines before edits.
- Simplicity first: the smallest change that solves the problem wins.
- Surgical changes: touch only what the task names; no drive-by refactors.
- Goal-driven execution: verify against the task's stated outcome, not effort spent.

## Execution discipline
- Long-running processes never run in the foreground: background them and poll with bounded checks.
- Two or three related commands per Bash call at most; one hung link freezes a chain.
- Every wait has a deadline: past it, kill the process on its port, record, and proceed or report.
- Same command failing twice: stop, capture the error, change approach; never retry harder.
- On a stale-read rejection, read the file again and re-apply; never force the write.
- Absolute paths on Windows (C:/...); confirm the working directory before file operations.
- Done means demonstrated: build ran, tests ran, the artifact was exercised with evidence.
- A partial pass is a fail: report verdicts as binary, with captured output as the evidence.

## Before writing code
- Read the code the change touches and trace the real flow first; the ladder shortens the solution, never the reading.
- Then stop at the first rung that holds: not needed at all; already in this codebase; stdlib; native platform; installed dependency; one line; only then the minimum that works.
- Never add a dependency for what a few lines cover; never add an abstraction, config, or file nobody asked for.
- Never cut: validation at trust boundaries, data-loss handling, security, accessibility, anything explicitly requested.
- Bug fix: grep every caller of the function you touch and fix the shared function once.
- A deliberate corner with a known limit carries a `shortcut:` comment naming the limit and the trigger to revisit it.
- Code first; then at most three lines on what was skipped and when to add it.

## Unfade
A WebXR memory piece for MRUHacks 2026: a faded instant print hangs in a darkroom; shake it until it develops, hold it to your eyes, and you are standing inside the photo, faded. Looking at the spots that matter brings the colour back, one at a time. Runs on a Meta Quest 2 (Meta Quest Browser) and in any browser as a window.

Stack, pinned: three 0.186.1, onnxruntime-web 1.30.0, ws 8.22.0, Vite 8.3.5, Node 22.12+ (or 20.19+). No framework. The only outside service is the Claude API, called from the server and optional. Dev tools only: playwright-core 1.64.1 and iwer 2.7.0 (Meta's Quest emulator) for `npm run xr-check`.

## Commands (Git Bash)
- `npm install` then `npm run setup` once (copies the ONNX runtime, downloads the 27 MB depth model).
- `npm run cert` (again after changing networks).
- Two terminals for building: `npm run server` (API and rooms on 8787) and `npm run dev` (pages on https://localhost:5173).
- Demo: `npm run build` then `npm start` (https on 8443, serves everything).
- `npm run check` (contract, room rules, Claude request shape against a fake API).
- `npm run xr-check` with the dev server up: the whole loop on an emulated Quest 2 in headless Chrome or Edge, every sample, pass or fail per step, screenshots in xr-shots/. Flow only; frame rate and feel need the headset.
- Free a port: `netstat -ano | findstr :5173`, then `taskkill //PID <id> //F` (doubled slashes, or Git Bash turns /PID into a path).
- Windows firewall prompt for Node.js: the person ticks both Private and Public; the hotspot counts as public, and an unticked box becomes a block rule.

## Who owns what
- World: world.html, src/world/, scripts/xr-check.mjs.
- Studio: studio.html, src/studio/, server/claude.js, server/claude.check.js.
- Thread: server/index.js, server/rooms.js, server/store.js, src/net/, src/sound/, guide.html, src/guide/, index.html, src/landing/, scripts/ (except xr-check.mjs), README.md.
- Content (no code): docs/submission/.
- Shared and frozen: src/shared/, package.json, package-lock.json, vite.config.js, .gitignore, .gitattributes, public/memories/, public/fonts/, docs/CONTRACT.md, docs/DESIGN.md, this file, .claude/settings.json, .agent/. Changes go through the integrator at a merge.

## Do not touch
- The contract shapes in src/shared/contract.js without the whole team agreeing.
- node_modules/, dist/, data/ (saved memories, never committed), public/ort/, public/models/.

## Rules that are easy to break
- Every Bash command is Git Bash; never PowerShell.
- One file per commit, with a lowercase imperative message that describes the code change. The Co-Authored-By line Claude Code adds is fine on this project.
- Push only your own branch; main moves at the team merges. Force pushes are blocked.
- Questions in memories ask and never tell; nothing generated may claim a fact about the person's life.
- Personal photos go through the studio on the demo laptop into data/ and are never committed.

When context runs low, compact keeping: the current task, files touched, test results, open questions.

If something you learn would have saved you time (a command, a gotcha, a decision), add one line to your part's notes file, creating it if needed, and never to this file: World src/world/CLAUDE.md, Studio src/studio/CLAUDE.md (also for server/claude.js), Thread server/CLAUDE.md, Content docs/submission/CLAUDE.md. Separate files keep the merges free of conflicts; a line everyone needs goes to the integrator.
