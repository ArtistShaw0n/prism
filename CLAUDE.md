# Prism — operating manual for Claude

This folder is Shawon's task system. He talks to Claude Code here in a mix of
**Bangla, Banglish and English**; Claude normalises that into clean English
tasks and pushes them into a vault that a macOS desktop app renders live.

**Your job in this repo is to be the input method.** When Shawon says something
that is a task, a status change, or a request for a summary — run the CLI. Do
not hand-edit `data/tasks.json`.

---

## 1. The one rule

```bash
node bin/todo.mjs <command> [args]
```

Every mutation goes through this CLI. It writes atomically, timestamps
correctly, and the desktop app picks the change up in under ~150 ms via a file
watcher. Editing the JSON by hand risks a torn write while the app is reading.

Check what exists before acting:

```bash
node bin/todo.mjs list
```

---

## 2. Translating what Shawon says

He writes casually. You write the task **in clean, standard English** — short,
imperative, specific. Always keep his original phrasing in `--raw` so the app
can show it underneath.

> Shawon: `kalke sokale client er jonno invoice ta pathate hobe, eta joruri`

```bash
node bin/todo.mjs add "Send the invoice to the client" \
  --p 1 --due tomorrow --project "Client Work" \
  --raw "kalke sokale client er jonno invoice ta pathate hobe, eta joruri"
```

### Time words

| He says | Means |
|---|---|
| `aj`, `aaj`, `today` | `--due today` |
| `kal`, `kalke`, `agamikal` | `--due tomorrow` |
| `porshu` | `--due +2d` |
| `ei week`, `this week` | `--due fri` |
| `agami week`, `next week` | `--due +1w` |
| `shomne mash`, `next month` | `--due +1m` |
| `sombar`…`robibar` | `--due mon`…`sun` |

`shokal` / `bikel` / `rat` (morning / afternoon / night) are time-of-day only —
the vault stores calendar dates, so put that detail in `--notes` if it matters.

### Priority words

| He says | Flag |
|---|---|
| `joruri`, `urgent`, `ekhoni`, `ASAP`, `age eta` | `--p 0` |
| `important`, `guruttopurno`, `must` | `--p 1` |
| (nothing said) | `--p 2` — the default |
| `pore holeo hobe`, `whenever`, `low priority` | `--p 3` |

### Status words

| He says | Command |
|---|---|
| `shuru korechi`, `starting`, `working on it` | `start <id>` |
| `sesh`, `hoye gese`, `done`, `complete korechi` | `done <id>` |
| `atke ache`, `stuck`, `blocked` | `block <id> "reason"` |
| `bad dao`, `lagbe na`, `cancel` | `cancel <id>` |
| `muche dao`, `delete koro` | `rm <id> --force` |
| `abar cholu koro`, `reopen` | `reopen <id>` |

### Judgement calls

- **Several tasks in one sentence → several `add` calls.** "invoice pathate hobe
  ar PR review korte hobe" is two tasks, not one.
- **Infer the project** when it's obvious from context or matches an existing
  one (`node bin/todo.mjs projects` to check). Don't invent new projects for
  one-off items.
- **Vague input** — add it anyway with your best clean phrasing, then say what
  you assumed. Don't block on a clarifying question for something this cheap.
- **Ambiguous reference** ("oi task ta done") — the CLI resolves a unique title
  substring, so `done "invoice"` works. If it's genuinely ambiguous the CLI
  errors and lists the candidates; show those to him and ask.
- He may refer to a task by its short id (`2454bx`), a prefix, or a few words of
  the title. All three work.

---

## 3. The daily brief

Shawon asked for "everyday ekta shundor update". The app always shows live
counts on its own; your job is the prose above them.

```bash
node bin/todo.mjs digest --write "…markdown…"
```

Write it **in his register** — Banglish/Bangla mixed with English technical
terms, exactly how he talks. Keep it short: 3–6 lines. Lead with what matters
today, name the single most important task, flag anything rotting.

Supported markdown: paragraphs, `- bullets`, `**bold**`, `` `code` ``. Nothing
else renders.

Good:

```
আজকে **৫টা কাজ** due, **১টা overdue**. সবচেয়ে জরুরি — `Finish the landing page hero`, ওটা already in progress.

- **Client Work** এ ৩টা জমেছে, invoice টা আজকেই পাঠান
- `Review PR #42` ২ দিন ধরে ঝুলে আছে
```

Rewriting the same date overwrites that day's entry, so it's safe to refine.

A digest is a written snapshot, not a live view — it will happily go on naming
tasks that have since been completed or deleted. **After any bulk change
(several completions, deletions, a re-plan), rewrite the digest** or it shows
Shawon a summary of a list that no longer exists.

Get the numbers first so the prose is true:

```bash
node bin/todo.mjs stats --json
```

### The automatic floor

`node bin/todo.mjs digest --auto` composes a serviceable brief from the vault
alone — no Claude, no network. Optionally scheduled for 06:30 daily via
`bash scripts/install-daily-digest.sh`.

So the app always has *something*. Your job is to make it better: when Shawon
starts a session, check whether today's digest was machine-written and replace
it with a real one.

```bash
node bin/todo.mjs digest --json | grep '"author"'   # "auto" means write a proper one
```

---

## 4. CLI reference

```
add <title>       --p 0-3  --due X  --tag a,b  --project X  --notes X
                  --sub "a,b"  --repeat daily|weekdays|weekly|biweekly|monthly
                  --raw "<his original words>"   --est <minutes>

start|stop|done|reopen|cancel|unblock <id...>
block <id> "reason"
rm <id...> [--force]          # --force required while a task is still open

edit <id> [new title] --title X --p N --due X|clear --project X
                      --tag a,b --notes X --status X --repeat X|none
tag <id> +work -home
sub <id> add "…" | done <n> | toggle <n> | rm <n>

list [query] [--all] [--status X] [--project X] [--tag X] [--p N]
             [--due today] [--overdue] [--json] [--flat]
show <id>          stats [--json]        projects
digest --write "<markdown>"    digest [--date YYYY-MM-DD] [--json]
export [--md]      path        init
```

Dates accept: `today`, `tomorrow`, `kal`, `mon`…`sun`, `+3d`, `2w`,
`2026-08-20`, `20/08`.

---

## 5. Architecture (why it's built this way)

```
Claude Code ──▶ bin/todo.mjs ──▶ data/tasks.json ◀── Rust fs-watcher ──▶ React UI
                                      │
                                 (inside MEGA → free backup + sync)
```

- **`data/tasks.json` is the single source of truth.** Gitignored — the repo is
  public, his tasks are not.
- **Rust owns storage**, file-watching and native chrome. **TypeScript owns all
  task logic.** `bin/vault.mjs` is the CLI's own copy of that logic.
- The schema in `src/lib/types.ts` is a **contract shared by three
  implementations** (Rust storage, React app, Node CLI). Change one, change all
  three.
- Writes are write-then-rename, so a reader never sees half a document. The app
  also sends `expectedUpdatedAt` on save; a mismatch means the CLI wrote in the
  meantime and the app re-applies on top instead of clobbering.
- The app suppresses the file event for its *own* writes by matching
  `meta.updatedAt`, so saving doesn't cause a reload loop.

### Where things live

| Path | What |
|---|---|
| `bin/todo.mjs` | the CLI you drive |
| `bin/vault.mjs` | vault IO, date parsing, stats |
| `src/lib/` | types, vault bridge, mutations, React hook |
| `src/components/` | UI |
| `src/styles/global.css` | the whole Liquid Glass design system |
| `src-tauri/src/lib.rs` | storage, watcher, tray, vibrancy, hotkey |
| `scripts/make-icon.mjs` | regenerates the icon from code |

---

## 6. Shipping an update

The app auto-updates from GitHub Releases, verified against a minisign key.

```bash
pnpm version patch          # or minor / major — also bump src-tauri/tauri.conf.json
git commit -am "…" && git tag v0.1.1 && git push --follow-tags
```

The tag push triggers `.github/workflows/release.yml`, which builds a universal
binary, signs it, and publishes `latest.json`. Running apps notice within a day
and show an update toast.

**The version in `package.json`, `src-tauri/tauri.conf.json` and the git tag
must match**, or the updater will not offer the release.

The private signing key lives at `~/.tauri/prism.key` and in the repo secret
`TAURI_SIGNING_PRIVATE_KEY`. **If it is lost, auto-update breaks permanently for
every installed copy** — there is no recovery, only a manual reinstall.

---

## 7. Style

- Task titles: English, imperative, specific. "Send the invoice to the client",
  not "invoice".
- Talking to Shawon: match his Banglish register. Technical terms stay English.
- Don't ask permission to add a task he clearly just asked for. Add it, then
  confirm what you did in one line.
