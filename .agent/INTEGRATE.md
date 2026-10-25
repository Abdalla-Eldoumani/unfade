# Merging the parts

Merges happen Saturday 2:00 PM, 5:00 PM and 11:30 PM (the last for features), then fixes only. Submit by Sunday 8:30 AM. Because each part lives in its own folders, the branches merge without conflicts as long as nobody edited a shared file; if git reports a conflict, that is the signal someone did, and the fix is to talk, not to pick lines.

## The checklist

1. Everyone commits and pushes their branch (`world`, `studio`, `thread`, and `content` if there is a fourth person).
2. On the integrator's laptop (skip the merge line of any branch that does not exist yet):
   ```bash
   git switch main
   git pull
   START=$(git rev-parse HEAD)
   git fetch origin
   git merge --no-ff origin/thread -m "merge the thread work"
   git merge --no-ff origin/studio -m "merge the studio work"
   git merge --no-ff origin/world -m "merge the world work"
   git merge --no-ff origin/content -m "merge the content work"
   ```
3. Confirm nobody touched a shared file without agreement:
   ```bash
   git diff --stat $START -- src/shared package.json package-lock.json vite.config.js .gitignore .gitattributes public/memories public/fonts docs/CONTRACT.md docs/DESIGN.md CLAUDE.md .claude/settings.json .agent
   ```
   Anything listed gets a quick word with its author before going further.
4. `npm install` (in case the lockfile moved), `npm run check`, `npm run build`. All three must pass.
5. With `npm run server` and `npm run dev` running in the background, `npm run xr-check` must pass.
6. `npm start`, then the smoke test below on real devices.
7. `git push`, and tell everyone to bring `main` into their branch: `git fetch origin`, then `git merge origin/main`.

## The smoke test

Every line is a pass or a fail; a partial pass is a fail. Lines that need the headset wait until it is in hand; say which ones were skipped.

- The start page loads and shows the headset address and the server as live.
- The studio makes a memory from a new photo and it appears on the line in the open darkroom within a few seconds.
- The headset enters the darkroom, takes a print, shakes it, steps in, and brings every spot back to the title card.
- A note from the guide on a phone appears in the memory; "Make it glow" pulses the right spot; "Reset for the next visitor" fades everything.
- The mirror follows the headset into and out of a memory.
- Sound plays in the headset after entering VR.

## Before submitting (by 8:30 AM Sunday)

- The repository is public, and its history has no personal photos, saved memories, certificates or keys:
  ```bash
  git log --all --name-only --format= | sort -u | grep -E '^(data/|\.cert/|\.env)' && echo "STOP: private files in history" || echo "ok"
  git log --all --oneline -G 'sk-ant-' -- . ':!.agent/INTEGRATE.md' | grep . && echo "STOP: a key in history" || echo "ok"
  ```
- The submission on the MRUHacks platform is published, with the repository link, and checked from a second account or a private window.

## A prompt for the integrator's Claude Code session

> Merge the team's branches into main for the checkpoint, following .agent/INTEGRATE.md exactly: merge thread, then studio, then world, then content if it exists, each with --no-ff; stop and report if there is any conflict or any change to a shared file instead of resolving it yourself; run npm install, npm run check and npm run build, each as its own command; start npm run server and npm run dev in the background and run npm run xr-check; then start npm start in the background and confirm https://localhost:8443/api/health answers; then list the smoke test lines that need a person and a headset, so I can run them. Do not push. Report every check as pass or fail with its output.
