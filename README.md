# To-Do

A small, fast task manager for macOS with a Liquid Glass interface — driven
from Claude Code.

You describe what you need to do in plain language. Claude normalises it into a
clean task and writes it to a local vault. The app picks the change up through a
file watcher and updates in under ~150 ms.

- **~8 MB app, ~50 MB RAM.** Tauri 2 + WKWebView, not Electron.
- **Real macOS vibrancy.** An `NSVisualEffectView` sits behind the window; every
  surface is a translucent layer on top of genuine system material.
- **Local-first.** One JSON file. No account, no server, works offline.
- **Signed auto-update** from GitHub Releases.

---

## Install

Grab `To-Do_universal.dmg` from [Releases](https://github.com/ArtistShaw0n/to-do/releases)
and drag it to Applications.

To-Do isn't notarised with an Apple Developer ID, so macOS quarantines the first
launch. Right-click the app → **Open**, or:

```bash
xattr -cr /Applications/To-Do.app
```

Updates after that install silently in-app.

---

## Using it

Talk to Claude Code in the project folder:

> `kalke sokale client er jonno invoice ta pathate hobe, eta joruri`

Claude turns that into a clean task, files it under `Client Work`, sets P1 and a
due date of tomorrow, and it appears in the app immediately.

Or drive the CLI yourself:

```bash
node bin/todo.mjs add "Send the invoice" --p 1 --due tomorrow --project "Client Work"
node bin/todo.mjs list
node bin/todo.mjs done 2454bx
```

### The window

Deliberately plain: one list, a Completed section, and an input. Click a circle
to complete a task; it moves to Completed. Type in the box and press `⏎` to add
— a trailing date word is picked up, so "Call the bank tomorrow" gets a due date.

Projects, tags, priorities, notes and daily digests are all still stored, and
Claude still sets them from the CLI — the window just doesn't draw them. They can
be surfaced later without touching the data.

| | |
|---|---|
| `⌘⇧K` | show/hide from anywhere |
| `⏎` | add the typed task |
| `Esc` | clear the input |

Closing the window parks To-Do in the menu bar, where the icon shows your open
count. Quitting is `⌘Q` or the tray menu.

---

## Where your data lives

```
data/tasks.json
```

One JSON file, gitignored — the repo is public, your tasks are not. Because the
folder sits inside MEGA it's backed up and synced for free.

Resolution order, if you want it elsewhere:

1. `$TODO_DATA_DIR`
2. `dataDir` in `~/Library/Application Support/com.shawon.todo/config.json`
3. `data/` next to this README

```bash
node bin/todo.mjs path      # where am I reading from?
node bin/todo.mjs export --md > today.md
```

---

## Development

```bash
pnpm install
pnpm app:dev      # native window with hot reload
pnpm dev          # browser-only UI preview (localStorage fallback)
pnpm app:build    # signed release build
```

Requires Node 22+, pnpm, Rust stable, and Xcode Command Line Tools.

```
Claude Code ──▶ bin/todo.mjs ──▶ data/tasks.json ◀── Rust watcher ──▶ React UI
```

Rust owns storage, file-watching and native chrome. TypeScript owns every rule
about what a task means. The schema in `src/lib/types.ts` is the contract
between them and the CLI.

Writes are write-then-rename, so a reader never observes a partial document, and
the app sends an `expectedUpdatedAt` guard so a concurrent CLI write is merged
rather than clobbered.

`scripts/make-icon.mjs` regenerates the icon from code — no image files to edit.

See [CLAUDE.md](CLAUDE.md) for the full operating manual.

---

## Releasing

```bash
# bump package.json + src-tauri/tauri.conf.json to the same version
git tag v0.1.1 && git push --follow-tags
```

CI builds a universal binary, signs it, and publishes `latest.json`.

The signing key at `~/.tauri/todo.key` is the one irreplaceable artefact here.
Lose it and auto-update breaks permanently for every installed copy.
