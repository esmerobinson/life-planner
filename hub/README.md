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

Open `/inbox`, then paste the contents of `Backlog.md` or choose the file. The
import is safe to repeat: items already imported are not duplicated.

## Not done yet

Deliberately left for later plans (2 to 5):

- Sync, backup and encryption
- Notifications and overdue reminders
- Journal (the Home journal card is a stub with disabled buttons)
- Vision board
- Google Calendar

## Placeholders you must replace

Colours, type, motion and sizes come only from `VISUAL-LANGUAGE.md` at the repo
root. Anything undecided is drawn in obvious magenta (`--placeholder` in
`src/styles/tokens.css`) so it cannot be mistaken for a final look:

- Celebration when a task is ticked
- Overdue sticker
- Active sidebar item outline
- Provisional sizes: the 190px Home right column, bar and radius values taken
  from the approved mockup (option 3)
