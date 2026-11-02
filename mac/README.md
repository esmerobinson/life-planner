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
   the "Esmeworld Local Signing" certificate if it is in your login keychain
   (see "Stable signing" below), otherwise ad hoc (`codesign --sign -`), which
   runs fine on this Mac but makes macOS ask for your keychain password after
   every update. The build prints a warning when it falls back to ad hoc.
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

## Stable signing

The encryption keys Esmeworld saves (used by sync) are protected by an item in
your login keychain called "Esmeworld WebCrypto Master Key". macOS only lets the app that made that
item read it, and it recognises the app by its signature. With ad hoc signing
every build has a different signature, so after each update macOS shows a box
saying Esmeworld wants to use "Esmeworld WebCrypto Master Key" and asks for the
login keychain password.

The fix is to sign every build with the same certificate. You make it once, on
this Mac, and it never leaves the Mac. It costs nothing and needs no Apple
account.

### 1. Open Keychain Access

Press Cmd+Space, type `Keychain Access`, and press Return. (If Spotlight offers
the Passwords app instead, keep typing the full name; Keychain Access is still
there.)

### 2. Create the certificate

1. In the menu bar at the top of the screen, click **Keychain Access**, then
   **Certificate Assistant**, then **Create a Certificate…**.
2. In the window that opens, fill in:
   - **Name:** `Esmeworld Local Signing` (exactly this, with the capitals and
     spaces; the build looks for this name)
   - **Identity Type:** Self-Signed Root
   - **Certificate Type:** Code Signing
   - Tick **Let me override defaults**.
3. Click **Create**. A warning says you are about to create a self-signed
   certificate. Click **Continue**.
4. The next screen has **Validity Period (days)**, set to 365. Change it to
   `3650` (ten years) so it doesn't run out next year. Click **Continue**.
5. Keep clicking **Continue** on every following screen without changing
   anything, until you reach one titled **Specify a Location For The
   Certificate**.
6. Check that **Keychain** says **login**. If it says something else, click it
   and choose **login**. Click **Create**.
7. Click **Done**.

### 3. Trust it for code signing

1. In Keychain Access, click **login** in the left sidebar, then the
   **My Certificates** tab (or **Certificates**) at the top.
2. Double-click **Esmeworld Local Signing**.
3. Click the small triangle next to **Trust** to open that section.
4. Next to **Code Signing**, choose **Always Trust**.
5. Close the window. macOS asks for your password: type your Mac login password
   and click **Update Settings**.

To check it worked, run this in Terminal:

    security find-identity -v -p codesigning

One of the lines should end with `"Esmeworld Local Signing"`.

### 4. The next build

Run `mac/build.sh --install` as usual. The build now prints
`signed with Esmeworld Local Signing …` instead of the ad hoc warning.

The first time it signs, a box may say **codesign wants to sign using key
"Esmeworld Local Signing" in your keychain**. Type your login keychain password
(normally your Mac login password) and click **Always Allow**, so later builds
don't ask.

### 5. The keychain box, one last time

The first time you open Esmeworld after that build, macOS asks once more,
because the app's signature changed from ad hoc to the new certificate. The box
says Esmeworld wants to use "Esmeworld WebCrypto Master Key":

1. In the password field, type your **login keychain password**. That is
   normally the password you type to log in to your Mac.
2. Click **Always Allow** (not just Allow, which would ask again next time).

After this, updates signed with the same certificate should open without the
box.

If you clicked **Deny** by mistake: quit Esmeworld and open it again, and the
box comes back.

### If your Mac password doesn't work in the box

The login keychain password starts out the same as your Mac password, but they
can drift apart, usually after the Mac password was reset (for example with
your Apple Account or by an administrator) instead of changed in System
Settings.

- First, try your **previous** Mac password in the box. That usually works.
- If it does, make them match again: in Keychain Access, choose
  **Edit > Change Password for Keychain "login"**, type the old password, then
  your current Mac password twice.
- If you don't know the old password at all, stop and ask for help before
  doing anything else. Keychain Access has a "Reset My Default Keychain" option,
  but it throws away every password saved in the login keychain, including
  "Esmeworld WebCrypto Master Key", and Esmeworld's sync keys with it. Download
  a backup from the Backup page first if you ever go that way.

### Using a different certificate

To sign with any other code-signing identity in your keychain, set its name
when you build:

    ESMEWORLD_SIGN_IDENTITY="Some Other Name" mac/build.sh --install

Changing certificates counts as a new signature, so the keychain box appears
once more (step 5).

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

The self-test never opens your real data. It runs against its own separate,
persistent web data store (`WKWebsiteDataStore(forIdentifier:)` with a fixed
id, kept in `~/Library/WebKit/world.esme.esmeworld/WebsiteDataStore/5e1f7e57-…`;
your data is in `…/WebsiteData`). So it works while Esmeworld is open, and can't
block on, or change, anything the real app is using. It does not restore or
save window positions either.

It counts launches in a database in that store. The first run deletes the
self-test store (only that one) and must print `launchCount=1`; the second must
print `launchCount=2`, which proves IndexedDB survives quitting and relaunching.
Needs macOS 14 or later (the app itself still runs on macOS 13).

Run it by hand:

    ESMEWORLD_SELFTEST=1 mac/build/Esmeworld.app/Contents/MacOS/Esmeworld

Every output line starts with `SELFTEST `; the exit status is 0 on PASS, 1 on
failure. Full logs of the build's runs are in `mac/build/selftest-1.log` and
`selftest-2.log`.
