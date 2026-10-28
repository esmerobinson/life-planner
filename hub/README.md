# Life Hub

A local React + TypeScript app for planning your days, goals and areas.

## Run it

    npm install
    npm run dev      # start the dev server (Vite prints the local URL)
    npm test         # run the test suite
    npm run build    # type-check and build

## Where your data lives

In the browser's IndexedDB, on this machine, per browser. There is no sync or
backup yet. Clearing site data for the app deletes everything.

## Importing your backlog

Click **Inbox** at the top of any page (it shows a count once items are
waiting), then paste the contents of `Backlog.md` or choose the file. The
import is safe to repeat: items already imported are not duplicated. Lines the
import could not fully read are listed under **Notes** below the counts.

## Not done yet

Deliberately left for later plans (2 to 5):

- Sync, backup and encryption
- Notifications and overdue reminders
- Journal (the Home journal card is a stub with disabled buttons)
- Vision board
- Google Calendar

## Placeholders you must replace

Colour values, type and motion come only from `VISUAL-LANGUAGE.md` at the repo
root. Anything undecided is drawn in obvious magenta (`--placeholder` in
`src/styles/tokens.css`) so it cannot be mistaken for a final look. Still to
replace or confirm:

- Celebration when a task is ticked
- Overdue sticker
- Active sidebar item outline
- Provisional sizes: sidebar 220px, tile 32px, icon 24px, gaps and padding, the
  190px Home right column, bar height 10px and radius 6px, panel and tile radii
  18px / 9px (taken from or fitted to the approved mockup, option 3)
- Colour jobs not yet approved (the colours are from the palette, the roles are
  not): body text in forest green (`--text`), sidebar text in cream
  (`--sidebar-text`), the 2px thickness of the active outline, and Passport
  green as the progress-bar fill (`--bar-fill`)

The header comment of `src/styles/tokens.css` lists which values came from
`VISUAL-LANGUAGE.md`, which are provisional sizes, and which are unapproved
role assignments.
