# Esmeworld for Mac

A small native Mac app that runs the Esmeworld web app (`hub/`) in its own
window, with its own Dock icon. It is a thin AppKit + WKWebView shell: the built
web app (`hub/dist`) is copied inside the app and served to the web view from
the address `esmeworld://app/`. No network and no server are involved.

Version 0.1.0. Needs macOS 13 or later.

## Build

    mac/build.sh              # builds the web app, the Mac app, then self-tests it
    mac/build.sh --skip-web   # reuse the current hub/dist instead of rebuilding it

The result is `mac/build/Esmeworld.app` (ignored by git). The script:

1. runs `npm run build` in `hub/` (unless `--skip-web`)
2. makes a fresh bundle skeleton in `mac/build/`
3. makes `AppIcon.icns` from `hub/public/icons/icon-512.png` with `sips` and
   `iconutil`. The largest slot (512@2x, 1024px) is an upscale of the 512px
   source, so it is slightly soft on the largest Finder icon sizes. A 1024px
   source would fix that.
4. compiles `mac/Esmeworld/main.swift` with `swiftc -O`
5. writes `Info.plist` (bundle id `world.esme.esmeworld`) and copies `hub/dist`
   into `Contents/Resources/web/`
6. signs it ad hoc (`codesign --sign -`), which is enough to run it on this Mac
7. runs the self-test twice (see below)

## Install

    mac/build.sh --install
    open ~/Applications/Esmeworld.app

This copies the app to `~/Applications` (your own Applications folder, never
`/Applications`). Rebuilding with `--install` replaces the app but not your data.
Because the app is built on this Mac, macOS normally opens it without a
warning. If it does refuse, right-click the app in Finder and choose Open.

## Your data: read this

Your tasks live in the app's own web storage (IndexedDB) under
`~/Library/WebKit/world.esme.esmeworld/`. WebKit files that storage by the
page's address, which is `esmeworld://app`.

- **The address `esmeworld://app` must never change.** If a future version used
  a different scheme or host (or a different bundle id), the app would open
  empty. Your data would not be deleted, but it would sit under the old address
  where the new app cannot see it.
- The Mac app's data is separate from the browser copies (Safari, Chrome, the
  installed PWA on `127.0.0.1`) until sync exists. Each has its own tasks.
- To move tasks between them, use the **Backup** page: Download backup in one,
  then in the other choose the file and restore with **Merge** (adds only what is
  missing, never changes what is there). This is also the escape hatch if the
  app ever opens empty.
- Download backups regularly and keep them outside the app.

## What works

- The whole web app, including deep links such as `/area/writing` (any path
  with no file extension is answered with the app page).
- File pickers (Backup restore, Inbox import) use the standard Open panel.
- Download backup uses the standard Save panel. If you save over an existing
  file, the old one goes to the Trash rather than being deleted.
- `alert`, `confirm` and `prompt` from the page appear as standard dialogs.
- Links to websites open in your default browser, never inside the app.
- Menus: Esmeworld (About, Hide, Quit), Edit (Undo, Redo, Cut, Copy, Paste,
  Select All), View (Reload, Actual Size, Zoom In, Zoom Out), Window (Minimize,
  Zoom, Close). The window remembers its size and position. Closing the window
  quits the app.
- Web Inspector, for debugging only: start the app with `ESMEWORLD_DEBUG=1`, or
  run `defaults write world.esme.esmeworld EsmeworldDebug -bool YES` and reopen
  it. Then right-click > Inspect Element, or Safari > Develop.

The web app's offline service worker is bundled but has no job here (the files
are already inside the app); its "new version" prompt will not appear in the Mac
app. A new version arrives by rebuilding and reinstalling.

## Not included yet

- Automatic updates
- Native notifications
- A menu-bar item
- Sync between the Mac app, browsers and phone
- Signing with a Developer ID, and notarisation (needed to share the app with
  other Macs without warnings)

## Self-test

`mac/build.sh` launches the built app twice with `ESMEWORLD_SELFTEST=1` (no
window is shown). Each run loads the app in a real WKWebView, checks the title
is `Esmeworld`, the sidebar has 13 links and `/area/writing` shows `Writing`,
checks the file server (deep-link fallback, file types, 404 for missing files,
refusal of `..` paths, `Cache-Control: no-cache`), presses the real Download
backup button and checks a valid JSON file was saved (into a temporary folder
that is then deleted), and prints any `console.error` from the page.

It also counts launches in a separate throwaway database,
`esmeworld-selftest`. The first run clears that one database and must print
`launchCount=1`; the second must print `launchCount=2`, which proves IndexedDB
survives quitting and relaunching. The self-test never clears or edits the app's
own data, but it does open the app against your real data store, the same as
launching it would.

Run it by hand:

    ESMEWORLD_SELFTEST=1 mac/build/Esmeworld.app/Contents/MacOS/Esmeworld

Every output line starts with `SELFTEST `; the exit status is 0 on PASS, 1 on
failure. Full logs of the build's runs are in `mac/build/selftest-1.log` and
`selftest-2.log`.
