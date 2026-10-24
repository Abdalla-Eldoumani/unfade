# Team setup

Abdalla creates the GitHub repository from the zip, once. Everyone else clones it. Everything is in the repository, including `CLAUDE.md`, `.claude/settings.json` (the shared Claude Code settings and guard hooks) and this folder, so nobody needs the zip but him.

Every command is Git Bash.

## 1. Create the repository (Abdalla, once)

1. On github.com: New repository, name it `unfade`, set it to Public, and leave "Add a README", .gitignore and licence all off, so it starts empty. Create it.
2. In the new repository: Settings, Collaborators (under Access), Add people, and add each teammate's GitHub username. They accept from the email or from github.com/notifications; until they do, their pushes are refused.
3. In Git Bash:

```bash
unzip unfade.zip && cd unfade
git init -b main
bash .agent/first-commits.sh          # 84 commits, one file each
git remote add origin https://github.com/<owner>/unfade.git
git push -u origin main
```

`first-commits.sh` ends by printing the commit count and then anything it did not commit: that list should be empty. If git stops with "Please tell me who you are", set your name and email once with `git config --global user.name "..."` and `git config --global user.email "..."`, then run the script again. On Windows, git may print "LF will be replaced by CRLF" for many files; that is harmless. The first push asks you to sign in to GitHub; pick the browser option. Never paste a GitHub token into a chat.

MRUHacks needs the repository link before the project can be published, and only published projects are judged.

## 2. Everyone else

Accept the collaborator invitation first, then:

```bash
git clone https://github.com/<owner>/unfade.git
cd unfade
git switch -c world                   # or studio, thread, content
```

## 3. Each person, once

```bash
npm install
npm run setup
npm run cert
npm run check
```

The first `npm run dev` makes Windows ask whether Node.js may use the network: tick both Private and Public, then Allow access (README.md, step 4 of the demo setup, explains why and how to undo a cancelled prompt). Push your branch the first time with `git push -u origin <branch>`, and after that with `git push`.

Open Claude Code in the `unfade` folder (`claude` in Git Bash, or the VS Code extension) and paste your part's prompt as the first message: `.agent/PROMPT-WORLD.md`, `.agent/PROMPT-STUDIO.md`, `.agent/PROMPT-THREAD.md` or `.agent/PROMPT-CONTENT.md`. Claude Code asks once whether to trust the folder; after that the shared settings apply to everyone and block batch commits, force pushes, destructive git commands and dev servers started in the foreground. Personal settings go in `.claude/settings.local.json`, which git ignores.

## 4. Working from your phone while your laptop keeps going

Claude Code's Remote Control turns your phone into a window on a session that keeps running on your laptop: same files, same tools, and the work never leaves the laptop. It needs a Pro or Max plan signed in through claude.ai, not an API key.

Before you leave the laptop:
- Plug it in. Settings, System, Power and battery (Power and sleep on Windows 10): set sleep when plugged in to Never. If you will close the lid, set closing the lid to Do nothing (Control Panel, Power Options, Choose what closing the lid does). Pause Windows updates for the weekend.
- In Git Bash, in the `unfade` folder: `claude --remote-control "Unfade world"`. In a session that is already open, type `/remote-control`; in the VS Code extension, type `/rc` in the prompt box. The first time, accept "Enable Remote Control".
- In that session, run `/config` and turn on "Push when actions required" (and "Push when Claude decides" if you want a ping when work finishes).
- Leave the terminal or VS Code open. Closing it takes the session offline.

On the phone: the Claude app, the Code tab, then the session with the green dot. Messages, permission prompts and the diff of your changes all show there, and you can attach a photo or a file.

What to expect:
- From the phone you can switch between Manual, Accept edits and Plan, but not into Bypass. Permission prompts wait on the phone until you answer them.
- If the laptop sleeps or loses the network, the session reconnects by itself when it is back. `/plugin` and `/resume` only work at the laptop.
- The pages run on the laptop's `localhost`, so the phone cannot open them from campus. Look at the screenshots Claude takes (`npm run xr-check` saves them in `xr-shots/`), or have a teammate pull your branch and run it.
- Two sessions on one folder edit the same files. Keep one session per branch.

## Keys

Only the laptop that runs the server for Claude needs `ANTHROPIC_API_KEY`, set in that terminal (`export ANTHROPIC_API_KEY="..."`) or once with `setx` on Windows. Never in a file, never in a chat with Claude Code.
