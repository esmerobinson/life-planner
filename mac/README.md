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
6. signs it: with `$ESMEWORLD_SIGN_IDENTITY` if that is set, otherwise with
   the "Esmeworld Local Signing" certificate if it is in your login keychain,
   otherwise ad hoc (`codesign --sign -`). Ad hoc is fine: see "Signing" below.
7. runs the self-test twice (see below)

## Install

    mac/build.sh --install
    open ~/Applications/Esmeworld.app

This copies the app to `~/Applications` (your own Applications folder, never
`/Applications`). Rebuilding with `--install` replaces the app but not your data.
It is safe to install while Esmeworld is open: the new copy is made next to the
old one and then swapped in all at once. The open window keeps running the old
version until you quit and reopen Esmeworld.
Because the app is built on this Mac, macOS normally opens it without a
warning. If it does refuse, right-click the app in Finder and choose Open.

## No keychain password box

Esmeworld never uses your login keychain. Earlier versions did: WebKit kept the
key that protects the journal key in a keychain item called "Esmeworld
WebCrypto Master Key", and because every build has a new ad hoc signature,
macOS asked for your login keychain password after each update.

Now the app gives WebKit its own key instead. It is made once, the first time
you open this version, and kept in

    ~/Library/Application Support/Esmeworld/webcrypto-master.key

(readable only by you; the folder too). Updates keep using the same file, so
there is no box after an update, whatever the signature. The old keychain item
is left where it is, unused. You can leave it.

**Once, after the first update to this version:** your journal key was stored
with the old keychain key, so the Journal can't read it and asks you to
**Unlock your journal once more with your passphrase.** Type your sync
passphrase (or scan a pairing code) and it opens. Nothing is lost: your entries
are untouched and sync keeps working throughout (the sync token is stored as
an ordinary string, not as a WebCrypto key, so it never depended on the
keychain).

Don't delete `webcrypto-master.key`. If it is ever lost, the same thing
happens once more: unlock the journal again with your passphrase. It is not in
backups, and doesn't need to be.

## Signing

Ad hoc signing (the default) is fine. To sign every build with a certificate
of your own instead, set its name when you build:

    ESMEWORLD_SIGN_IDENTITY="Some Name" mac/build.sh --install

or make a code-signing certificate named exactly `Esmeworld Local Signing` in
your login keychain, which the build picks up by itself. Neither is needed for
anything today.

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
- The key that protects the stored journal key is in
  `~/Library/Application Support/Esmeworld/webcrypto-master.key` (see "No
  keychain password box"). Keep it; losing it only means unlocking the journal
  once more with your passphrase.

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

- Reminders (Reminders page, in the sidebar footer): the web app works out the
  next 7 days of reminders and hands the whole list to the app
  (`esmeworldReminders` message handler), which replaces every pending
  Esmeworld notification with it. They are scheduled local notifications, so
  they pop up with the app closed. macOS asks once whether Esmeworld may send
  notifications, when the Reminders page is first opened (never at launch).
  Clicking one opens Esmeworld on that page. A reminder for something already
  done that day drops out the next time the app recomputes (launch, any change
  or sync, midnight): if it was done on the phone while the Mac app was not
  running, the Mac may still remind once.

The web app's offline service worker is bundled but has no job here (the files
are already inside the app); its "new version" prompt will not appear in the Mac
app. A new version arrives by rebuilding and reinstalling.

## Not included yet

- Automatic updates
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

The self-test never opens your real data. It runs against its own separate,
persistent web data store (`WKWebsiteDataStore(forIdentifier:)` with a fixed
id, kept in `~/Library/WebKit/world.esme.esmeworld/WebsiteDataStore/5e1f7e57-…`;
your data is in `…/WebsiteData`). So it works while Esmeworld is open, and can't
block on, or change, anything the real app is using. It does not restore or
save window positions either.

It counts launches in a database in that store. The first run deletes the
self-test store (only that one) and must print `launchCount=1`; the second must
print `launchCount=2`, which proves IndexedDB survives quitting and relaunching.

It also checks the WebCrypto master key (see "No keychain password box"), with
its own key file, `webcrypto-master-selftest.key` next to yours, which it never
reads or writes. The first run deletes that self-test file and must print
`masterKey=created`, the second `masterKey=loaded`. The first run stores a
non-extractable AES-GCM key and a value sealed with it in IndexedDB; each run
reads them back and opens the value, and the second run must open the key the
first one stored (`webcrypto.stored=existing storedOnLaunch=1 thisLaunch=2`,
`webcrypto.decrypt=ok`). `webcryptoDelegateCalled=` counts how often WebKit
asked the app for the master key; 0 is a failure, because then WebKit would
be using the keychain.

Reminders: it opens the Reminders page, checks the bridge answers (status, and
a permission request that the self-test answers without ever asking, so no
prompt appears), sends a pretend schedule and, only if notifications are
already allowed for Esmeworld, checks the system holds exactly the valid ones
(`getPendingNotificationRequests`); otherwise it prints
`reminders.schedule=skipped`. The self-test binary has the same bundle id as
the real app, so it shares its notification settings: its reminders use their
own identifier prefix (`esmeworld-selftest.`), never touch yours, and are
removed before it exits. It also checks a reminder's link opens its page.

Needs macOS 14 or later (the app itself still runs on macOS 13).

Run it by hand:

    ESMEWORLD_SELFTEST=1 mac/build/Esmeworld.app/Contents/MacOS/Esmeworld

Every output line starts with `SELFTEST `; the exit status is 0 on PASS, 1 on
failure. Full logs of the build's runs are in `mac/build/selftest-1.log` and
`selftest-2.log`.
