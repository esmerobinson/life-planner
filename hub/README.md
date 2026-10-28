# Esmeworld

A local React + TypeScript app for planning your days, goals and areas.

## Run it

    npm install
    npm run dev      # start the dev server (Vite prints the local URL)
    npm test         # run the test suite
    npm run build    # type-check and build
    npm run e2e      # real-browser tests on your installed Chrome

The e2e tests reuse the dev server if it is already running on 127.0.0.1:5173
(or start one). Each test uses a fresh browser profile, so your own data is
never touched. The phone-width checks are marked `fixme` until the phone design
round.

## Where your data lives

In the browser's IndexedDB, on this machine, per browser. Manual backup and
restore exist (see Backups below); sync, automatic backup and encryption are
later plans. Clearing site data for the app deletes everything.

## Importing your backlog

Click **Inbox** at the top of any page (it shows a count once items are
waiting), then paste the contents of `Backlog.md` or choose the file. The
import is safe to repeat: items already imported are not duplicated. Lines the
import could not fully read are listed under **Notes** below the counts.

## Importing Google Tasks

On the Inbox page, under **Google Tasks (JSON file)**, choose your exported
JSON file or paste its contents, then press **Import Google Tasks**. Open
tasks arrive in the Inbox, tagged with their Google list name; completed tasks
are left out. A task's notes and due date are kept, and a subtask gets a
`Part of: <parent>` line. Repeating the import is safe: tasks already imported
are never touched. A task whose title matches one already in the app (for
example from your Backlog) is not added, and is counted as "same title as an
existing task". Anything that could not be read is listed under **Notes**.

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

- Sync, automatic backup and encryption (manual backup/restore exists)
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
- Data stays per browser (and per installed app) until sync arrives. The
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
