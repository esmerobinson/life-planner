# Esmeworld

A local React + TypeScript app for planning your days, goals and areas.

## Run it

    npm install
    npm run dev      # start the dev server (Vite prints the local URL)
    npm test         # run the test suite
    npm run build    # type-check and build
    npm run e2e      # real-browser tests on your installed Chrome

The e2e tests reuse the dev server if it is already running on 127.0.0.1:5173
(or start one). If another checkout already serves 5173/4173, pick free ports so
this checkout is the one tested: `E2E_DEV_PORT=5183 E2E_PREVIEW_PORT=4183 npx playwright test`. Each test uses a fresh browser profile, so your own data is
never touched. The phone-width checks are marked `fixme` until the phone design
round.

## Where your data lives

In the browser's IndexedDB, on this machine, per browser. Manual backup and
restore exist (see Backups below), and optional sync (see Sync below) keeps a
copy on the sync server and on your other devices. Automatic backup and
encryption are later plans. Clearing site data for the app deletes this
device's copy.

## Importing your backlog

Open **Backup** (next to Inbox), then the **Import from a file** section at the
bottom, and paste the contents of `Backlog.md` or choose the file. The
import is safe to repeat: items already imported are not duplicated. Lines the
import could not fully read are listed under **Notes** below the counts.

## Importing Google Tasks

On the Backup page, in **Import from a file**, under **Google Tasks (JSON file)**, choose your exported
JSON file or paste its contents, then press **Import Google Tasks**. Open
tasks arrive in the Inbox, tagged with their Google list name; completed tasks
are left out. A task's notes and due date are kept, and a subtask gets a
`Part of: <parent>` line. Repeating the import is safe: tasks already imported
are never touched. A task whose title matches one already in the app (for
example from your Backlog) is not added, and is counted as "same title as an
existing task". Anything that could not be read is listed under **Notes**.

## One-time transfer from Obsidian and Google Tasks

`scripts/obsidian-transfer.ts` builds an Esmeworld backup file from your
Obsidian notes (`Backlog.md`, `Goals.md`, `Goals for month.md`,
`Goals & Habits.md`) and the Google Tasks export, using the app's own
parsers and the same validator the Backup page uses. It only reads those
files. Run it once, from `hub/`:

    npx tsx scripts/obsidian-transfer.ts [--vault DIR] [--gtasks FILE] [--out DIR] \
        [--today YYYY-MM-DD] [--classify-out FILE] [--areas FILE] [--extra FILE]

It writes two private files (mode 0600) into `--out` (default `~/Downloads`):
`esmeworld-transfer-<date>.json` (load it on the Backup page with **Merge**,
once, into one place) and `esmeworld-transfer-<date>-summary.md` (a readable
summary with your titles, for you only). The terminal prints counts only.
A missing input is skipped with a note.

Safe to repeat: ids are made from each row's source key, so a second run
produces the same ids and loading it again with Merge adds nothing. The script
refuses to write inside the vault, inside this git repository, or over any
input file, and writes nothing if any check fails. Titles are tidied first:
wiki-links become their text, old suffixes such as `(from Google Tasks)`,
`(overdue!)`, `(due today)`, `(due in 3d)`, `(carried ...)` and
`(was due 19 Jul)` are removed (a date is kept as a notes line), and copies of
one task (same title ignoring case, punctuation and emoji) are folded into one
item, also across the Backlog and Google Tasks. The summary lists every folded
copy.

`--classify-out FILE` writes a private list of every item the rules left in the
Inbox (stable `key`, title, origin, section or list, first 200 characters of
notes). `--areas FILE` reads `{ "<key>": "<area id>" }` and files those inbox
items; unknown keys, `inbox` and invalid areas are ignored with a note, and the
summary lists them under "Sorted for you".

`--extra FILE` adds hand-reviewed vault items, one JSON object per line:
`{ "key", "title", "kind": "task"|"idea"|"goal", "areaId", "tag", "notes"?, "due"?, "check"? }`.
`tag` is `from-daily-notes`, `from-old-task-lists` or `from-project-notes` (the
Inbox "From" filter uses it). A `check` reason adds the `check` tag and a first
notes line "Check: <reason>", which the Inbox shows under the title. Goals are
practice goals (a deadline only if `due` is given) and cannot be in the inbox.
Bad lines are reported by number in the summary and skipped. Extra items are
not repeated in the classify file.

## The Inbox

The Inbox has a one-line **Add to inbox** box at the top (Enter adds, the box
keeps focus). Under **To sort**, each row has one button per area: one tap
files it. **More options** holds the to-do/idea switch, **Make it a goal**
(creates a practice goal and archives the item), goal, priority and due date.
When items come from more than one source, a **From** filter appears.
**Select all shown** respects it; **Move selected** and **Archive selected**
act on the selection. Archived inbox items are listed at the bottom with
Restore. Nothing is ever deleted.

How the notes map:

- **Backlog and Google Tasks**: exactly as the Inbox importers do (Backlog
  sections choose the area; Google tasks skipped as the same title as an item
  already being transferred are listed in the summary).
- **Goals note** (`## <Area name>` sections): each area becomes one goal. The
  title is the area name without its emoji or a trailing `(...)`. The area is
  matched like Backlog sections, plus Creative technologist -> Tech projects
  and Inner work -> Mind; a heading that matches nothing is proposed as Admin
  (goals cannot live in the Inbox). `Identity:` lines become the goal's "why"
  (joined with a blank line); `Weekly:`, `Ongoing:` and `Daily:` lines become
  its cadence, prefix kept; `Study these north stars:` becomes its notes; each
  `Marker:` line becomes a milestone (cut at 200 characters). A goal with at
  least one marker is finite, otherwise a practice goal. A finite goal's
  deadline is 31 December of the year in its first marker, else this year.
  The `## Notes` section is ignored.
- **Monthly note** (`# Goals for <Month> <Year>`): each bold label under
  "This month's goals" is an area name (a trailing `(...)` is ignored when
  choosing the area, so "Writing (Relationship Book)" is Writing, "Creative
  Technologist" is Tech projects; no match means Admin). It becomes one finite
  goal titled "<Month> goal: <label>", due on the last day of that month. Its
  notes are the description plus a `Done when: ...` line taken from the first
  nested line (the success criterion). No tasks are made from monthly goals.
- **Habits note**: each item under "Daily habits" becomes a task that repeats
  every day. Habits about movement (walk, run, exercise, workout, calisthenics,
  stretch, yoga, gym, move) go to Body; the rest to Mind. "Big goals" numbers
  and "This week" counts are listed in the summary and not created.

Goals also carry optional **why**, **cadence** and **notes** text (shown under
the goal's title) and an Obsidian source marker; all are included in backups.

## Areas

There are nine areas: Inbox, plus Writing, Art, Content, Mind, Body, Tech
projects, Production and Admin. The sidebar lists the eight areas (the Inbox is a link
at the top of every page).

On a first import, new items are filed by their Backlog section:

| Backlog section | Area |
| --- | --- |
| Writing | Writing |
| Art | Art |
| Content | Content |
| Inner work | Mind |
| Leisure | Mind |
| Health | Body |
| Vibecoding | Tech projects |
| Production & freelance | Production |
| Life admin | Admin |

Everything else goes to the Inbox. Items already in the app are never moved by
a re-import. In the Inbox you can tick several items and move them to an area
in one go.

## Not done yet

Deliberately left for later plans (2 to 5):

- Automatic backup and encryption (manual backup/restore and sync exist)
- Notifications and overdue reminders
- Journal (the Home journal card is a stub with disabled buttons)
- Vision board
- Google Calendar

## Backups

Your tasks live in this browser only, so back them up.

- Open the Backup link (next to Inbox) and press Download backup. You get
  `life-hub-backup-<date>.json`. Keep copies somewhere outside the browser.
- To restore, open Backup, choose the file, then pick Merge or Replace.
  - Merge adds only what is missing (by id). It never changes a task or goal
    that is already here.
  - Replace removes everything here and puts the file's contents in its place.
    It needs a ticked confirmation, and the page asks you to download a backup
    first. It happens all at once, so a failure leaves your data as it was.
- A file that is not an Esmeworld backup, or is damaged, is refused and nothing
  changes.
- Keep using `http://127.0.0.1:5173`. Browser storage belongs to the exact
  address, so a different address or port shows an empty hub (your data is still
  at the old address). The dev server is fixed to that port and will refuse to
  start rather than move to another (preview is fixed to `127.0.0.1:4173`).
- If you used `localhost:5173` before, that is a different address with its own
  saved data. Open it, download a backup there, then restore it here with Merge.
- The app asks the browser to keep its data; the Backup page says whether the
  browser agreed.

## Sync

Open **Sync** (beside Backup at the bottom of the sidebar), enter the sync
address (prefilled from `VITE_SYNC_URL` when that is set at build time) and the
passphrase, then **Save**. The app works offline as before; it syncs on start,
when the network comes back, when the tab is shown again, shortly after you
change something, and every minute while the tab is visible.

- The passphrase is never stored. On Save it is turned into a key (PBKDF2,
  see `src/sync/token.ts`) and only that key is kept, in this browser's
  IndexedDB, so sync can run by itself. Anyone with this device's browser data
  could sync as you; **Stop syncing on this device** removes the key and keeps
  your tasks and goals here.
- If the server refuses the key, sync stops and the Sync link reads
  "Sync (needs passphrase)". Enter the passphrase again to carry on. After
  several wrong tries the server waits 15 minutes before accepting another.
- Each change is stamped with the time it was made; when two devices change the
  same task, the later change wins on both (the whole task, not field by
  field). Nothing is ever deleted by sync.
- Tasks that existed before sync, and tasks added by Merge or an import, keep
  their own dates as their stamp, so a copy another device has edited since
  always wins over them.
- While sync is on, **Replace** is off (Merge still works), and Merge and the
  imports wait until this device's first sync has finished.
- Changing the sync address starts over: this device pulls everything from the
  new server and sends everything it has.
- A change the server refuses is kept on this device and counted on the Sync
  page; it is tried again after you edit it. Items from another device that this
  version of the app cannot read yet are kept aside and counted, and applied
  after an update.
- How it works, and how each rule of the server contract is kept:
  `SYNC-CLIENT-REPORT.md`.

### Checking sync against the real server (opt-in)

    (cd ../sync && npm install)   # once: wrangler
    npm run e2e:sync

This runs the real server code locally with `wrangler dev --local` (from an
empty temp folder, with an explicit `--config ../sync/wrangler.jsonc`, a local
D1 database and a throwaway test passphrase), serves the app's production build
on `127.0.0.1:4173`, and drives three separate browser profiles as three
devices. Nothing is deployed and no Cloudflare account is used. Ports 4173 and
8790 must be free.

## Install it as an app (works offline)

The production build is an installable app that opens without a network. To try
it, run `npm run build && npm run preview` and open `http://127.0.0.1:4173`
(the service worker is off in `npm run dev`).

`npx playwright test` builds and starts its own preview on 4173 every run and
never reuses one, so a leftover preview makes it fail with a port-in-use error.
If that happens, stop the old preview (check it is yours first):
`lsof -ti tcp:4173 | xargs kill`, then rerun.

- Chrome or Edge on Mac: click the install icon at the right of the address bar.
- Safari on Mac: File > Add to Dock.
- iPhone: Safari > Share > Add to Home Screen.

Honest limits:

- On `127.0.0.1` it installs on this Mac only. A phone cannot reach `127.0.0.1`
  on your Mac; it needs the app on a hosted HTTPS address (a later plan).
- Data stays per browser (and per installed app) unless sync is set up. The
  installed app and the browser tab at the same address share one store, but
  `127.0.0.1:4173` and `127.0.0.1:5173` are different addresses with separate
  data. Use Backup to move data between them.
- The offline copy holds only the app itself (page, scripts, styles, icons). Your
  tasks live in IndexedDB and the service worker never reads or caches them.
- An installed window only checks for a new version when it next loads the app.
- When a newer build exists the app shows "A new version is ready." with a
  Reload button; nothing updates under you until you press it.
- App icon: Esme's chosen artwork (house outline with her photo, Home-tile blue
  background, cream behind her), chosen 2026-10-28. No theme or background
  colour is set in the manifest.
- The browser's own install prompts cannot be automated, so installing is
  checked by hand; the tests check the manifest, the service worker and offline use.

## Placeholders you must replace

Colour values, type and motion come only from `VISUAL-LANGUAGE.md` at the repo
root. Anything undecided is drawn in obvious magenta (`--placeholder` in
`src/styles/tokens.css`) so it cannot be mistaken for a final look. Still to
replace or confirm:

- Celebration when a task is ticked
- Overdue sticker
- Active sidebar item outline
- Controls (`src/styles/controls.css`) follow the approved mockup A (soft pills).
  Not in the mockup and still to confirm: checkbox shape is a rounded square
  (Esme has not said whether she wants a round bubble), disabled buttons use
  pale stone `#d4d1c3` with sage `#a09f88` text, keyboard focus ring is the
  magenta placeholder, no hover styling, radio buttons and file pickers keep
  the browser look
- Move-to menu choices use the secondary pill style: pending Esme
- Provisional sizes: sidebar 220px, tile 32px, icon 24px, gaps and padding, the
  190px Home right column, bar height 10px and radius 6px, panel and tile radii
  18px / 9px (taken from or fitted to the approved mockup, option 3)
- Colour jobs not yet approved (the colours are from the palette, the roles are
  not): the tile colours and icon accents of Tech projects, Production and Admin,
  body text in forest green (`--text`), sidebar text in cream
  (`--sidebar-text`), the 2px thickness of the active outline, and Passport
  green as the progress-bar fill (`--bar-fill`)

The header comment of `src/styles/tokens.css` lists which values came from
`VISUAL-LANGUAGE.md`, which are provisional sizes, and which are unapproved
role assignments.
