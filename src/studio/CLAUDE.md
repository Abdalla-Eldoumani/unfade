# Studio notes

## Gotchas
- The studio branch comes from main, so World's xr-check fixes (the take retry, the wait for the fade back) are not on it yet; a rare "takes the print off the line" failure here is that known flake, not the studio.
- Editing a file under src/ while a browser check runs makes Vite reload the page mid-run. Edit between runs.
- `/api/analyze` answers 200 even when Claude fails; the reason arrives as `warning` and the studio shows it in the review step. claude.js makes that reason one plain sentence ending "so place the spots yourself by tapping the photo."
- Failure without pulling a cable: start the server with `ANTHROPIC_API_KEY=wrong-key-for-a-failure-test` (the real API answers 401, free) and, for no network, also `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:9` (Node 24 sends fetch through the dead proxy: ECONNREFUSED). Both ended with a memory on the line.

## Checking without a person
- One photo onto the line, headless: open `/world.html?debug` (it joins room demo over the server) and `/studio.html`, give the photo to `.print-drop input` (laptop) or `.take-photo input` (phone: 390x844, touch, isMobile), fill the title starting with "test", Develop, tap the photo if no spots came back, Hang it, wait for `unfade.hub.prints` to hold the id, then `DELETE /api/memories/<id>`. With the depth model on this laptop's CPU, develop takes about 15 s and the line about 18 s.
- Claude, live (task 1), once ANTHROPIC_API_KEY is set where `npm run server` runs: send each test photo through `analyzePhoto` from `/src/studio/analyze.js` in the page (the same 1092 px copy Claude sees), draw the returned x and y on the photo, and read the labels and questions beside the dots. Ten kinds: person, two people, pet, food, room, street, landscape, night, party, selfie (CC0 or public domain from Wikimedia Commons, kept outside the repo). Empty hints show Claude's own reading; repeats with the same photo and words come from the server's cache and cost nothing.
