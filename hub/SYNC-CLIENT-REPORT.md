# Sync client: build report

Branch `sync-client` (based on `origin/worktree-hub-design-spec`). Built against the sync
contract (`docs/superpowers/specs/2026-10-28-sync-api.md` in the server worktree), which was
updated to **v1.1** while this was being built; the client follows the v1.1 file (sections B,
C, D, E, F), and is tested against an in-memory fake of it. It has not been run against the
real Worker.

## What was built

| Piece | File |
| --- | --- |
| Token derivation (copy of the server's `sync/shared/token.ts`, plus NFC) | `src/sync/token.ts` |
| Dexie v2: `updatedAt` on items/goals, `pending`, `syncMeta`; migration | `src/data/db.ts` |
| Stamping + pending on every local write | `src/data/changeTracking.ts` |
| Sync engine (`syncOnce`) and settings helpers | `src/sync/engine.ts` |
| Scheduler and UI state | `src/sync/controller.ts`, `src/sync/index.ts` (`syncController`, `useSyncState`) |
| Sync page, sidebar link, shell wiring | `src/ui/SyncPage.tsx`, `src/ui/Sidebar.tsx`, `src/ui/AppShell.tsx`, `src/App.tsx` |
| Test-only fake server | `src/sync/fakeServer.ts` |

## Design decisions

- **A DBCore middleware instead of table hooks.** The brief suggested Dexie `creating`/
  `updating` hooks. A hook cannot write to `pending` when the caller's transaction did not
  name that table, and every existing repo function, importer and restore opens
  transactions on `items`/`goals` only. The middleware (the same technique Dexie Cloud uses)
  widens every read-write transaction that touches a synced table to include `pending`, then
  on every `add`/`put` (which is what `add`, `put`, `bulk*`, `update` and `modify` all become)
  reads the stored row, writes a COPY with `updatedAt = max(Date.now(), previous + 1)` and
  puts the pending entry, all in the caller's transaction. No write path can skip it, and
  the stamp, the row and the pending mark commit or roll back together. The caller's objects
  are never mutated (so `createItem`, `createGoal` and `itemToGoal` now read the stored row
  back to return it with its `updatedAt`).
- **Remote applies bypass tracking** through `applyUntracked(db, fn)`, which runs one
  read-write transaction over every table and marks its IndexedDB transaction in a WeakSet the
  middleware checks. The migration marks its upgrade transaction the same way and stamps
  explicitly with one shared time.
- **Pending entries store the version** (`updatedAt`) of the local change. A sent change's
  pending entry is cleared only if it still holds the version that was sent; anything newer
  stays pending. This is how "a local change made after the request was built" is detected.
- **Applying a returned row over a waiting local change (v1.1 F.3).** The brief said "apply
  unless the device has a local change made after this request was built"; the v1.1 file says
  "unless a NEWER local pending change exists". The client follows the file: a waiting change
  newer than the returned row stays (and is sent next); an older one has already lost, so the
  returned row replaces it and its pending entry is dropped (it is never sent). A TIE (same
  `updatedAt`) stays pending, because only the server can break it (by deviceId); it is sent
  and the server answers with the winner as a returned winner.
- **Rows from the server are validated** with the backup validators (`validItem`/`validGoal`,
  now exported) before they are stored; an invalid row is skipped rather than risk breaking
  the UI.
- **Replace restore resets the cursor to 0.** Sync never deletes, so rows removed by Replace
  still exist on the server and other devices. Without the reset this device would silently
  stay without them; with it they come back on the next sync (the restored rows are stamped
  now, so they win where both exist). This changes what "Replace" means once sync is on; see
  Concerns.
- **One sync at a time across tabs** via the Web Locks API where available (in-tab
  single-flight always).
- **401 clears the stored token** and sets `needsPassphrase`, so nothing (not even a reload)
  retries automatically.
- **A row too large for any request** (over 1 MB of JSON on its own) is held back and stays
  pending, with a calm message, instead of making every sync fail with 400 forever.

## How each contract rule is enforced

| Rule | Where | Test |
| --- | --- | --- |
| Token = hex(PBKDF2-SHA256(UTF-8(NFC(passphrase)), "esmeworld-sync-v1", 200000, 32 B)) | `token.ts` | `token.test.ts`: server's 3 fixed vectors; composed vs decomposed accents give the same token |
| `Authorization: Bearer <token>` | `engine.ts` `run` | "sends the bearer token and a stable random deviceId" |
| Every local edit: `updatedAt = max(now, previous + 1)` | `changeTracking.ts` | "sets updatedAt = max(now, previous + 1), even when the clock goes backwards" |
| Every write path stamps and marks pending | middleware | "repo writes all stamp…", "importBacklog and importGoogleTasks…", "restoreBackup (merge and replace)…" |
| Remote applies do not | `applyUntracked` | "writes made while applying server changes are not stamped and not pending" |
| v1 -> v2 keeps every row, stamps it, marks it pending | `db.ts` upgrade | "v1 -> v2 migration…" (fake-indexeddb) and e2e `sync-migration.spec.ts` (real Chrome) |
| `data` includes `id` and `updatedAt` | `buildBatch` | fake server's strict check rejects anything else; "first sync uploads…" |
| At most 500 changes and 1 MB of JSON per request | `buildBatch` (`MAX_CHANGES_PER_REQUEST`, `MAX_REQUEST_BYTES`, exact UTF-8 byte count of the body) | "batches of at most 500" (1201 rows -> 500/500/201), "keeps every request under 1 MB" |
| Apply each returned row unless a NEWER (or tied) local change is pending (F.3) | `applyReply` | "a local edit made during a request is not overwritten by the response and is sent next time", "an unsent local change OLDER than a row in the response gives way to it" (it is never sent; this test failed under the earlier rule before the change) |
| Applied rows + cursor + cleared pending in ONE transaction | `applyReply` (one `applyUntracked` transaction) | covered by the convergence tests |
| Keep requesting while `hasMore` | `run` loop | "keeps asking while hasMore and pulls everything" (page size 7, 50 rows, 8 requests) |
| Returned winners (losing device learns the winner) | fake server + `applyReply` | "a device that loses a tie learns the winner from a returned winner" asserts the request cursor is already past the winning row, so it can only arrive as a returned winner; fake server: "reused its own timestamp for different data" |
| Any row may arrive twice; replay harmless | `applyReply` (older copy never replaces a newer row) | "replaying the same request and the same response is harmless", "an old copy of a row delivered again…" |
| Two devices converge, later updatedAt wins on both | engine | "two devices converge…" (two Dexie databases, one fake server) |
| `deviceId` random per install, never copied | `getDeviceId` (`crypto.randomUUID`, in `syncMeta`, which backups never include) | "stable random deviceId" |
| 401: stop, ask for passphrase, never retry automatically | `run` + controller | engine "401 stops…"; controller "after 401 it asks for the passphrase and stops syncing by itself" |
| 429: wait `Retry-After` | `retryAfterMs` + controller `blockedUntil` | engine "429 reports…"; controller "after 429 it waits…" (even "Sync now" waits) |
| 409 `cursor_ahead`: cursor 0, re-send every local row | `resetForCursorAhead` | "409 cursor_ahead resets the cursor to 0 and re-sends every local row unchanged" |
| 400 `bad_change`: re-stamp pending > 23 h ahead to now, retry once | `restampFarFuture` | "400 bad_change re-stamps…", "400 bad_change twice shows the error…" |
| 413 / others shown calmly | `run` | "other server errors are shown calmly…" |
| Offline keeps everything | `run` (fetch throwing -> `offline`) | "offline: a failed fetch keeps everything pending and loses nothing" |
| Scheduler: start, online, visible, debounce `SYNC_DEBOUNCE_MS = 2000`, interval `SYNC_INTERVAL_MS = 60000` while visible, single flight, nothing without token/address | `controller.ts` | `controller.test.ts` (8 tests, hand-driven timers) |
| Passphrase never stored | `SyncPage.tsx` | "saves only the derived token…" scans every object store of every IndexedDB database plus local/session storage for the passphrase |

## Test counts (all run in this worktree)

- `npx vitest run`: **525 passed** (464 before + 61 new: token 5, change tracking 9, backup 4,
  fake server 7, engine 21, controller 8, Sync page and sidebar 7).
- `npx tsc --noEmit`: clean.
- `npm run build`: succeeds.
- `npx playwright test`: **12 passed, 5 skipped** (the 10 existing + 2 new; the 5 skipped are the
  existing phone-width `fixme`s). Run as `E2E_DEV_PORT=5183 E2E_PREVIEW_PORT=4183 npx playwright test`
  because another checkout's dev server was holding 127.0.0.1:5173 (Playwright would have reused
  it and tested the wrong code). The config now reads those two optional variables; defaults are
  unchanged. No process outside this run was touched.

Test-first notes: token, change-tracking, controller and Sync page tests were run against stubs
and failed on their assertions before the code was written. The first engine tests failed
because `syncOnce` did not exist yet (an empty module), not on individual assertions; the key
engine rules were then mutation-checked instead (removing the waiting-change rule, the
version-checked pending clear, or the stale-copy rule each makes a named test fail), and the
v1.1 F.3 change was written test-first.

Existing tests that compared a stored row with the object written now compare it without the
stamp (`src/test/unstamped.ts`); the backup round-trip tests do the same.

## Not verified against the real server

- Everything here ran against `fakeServer.ts`, written from the contract text. The server
  worktree's code now has returned winners too, but the two have never talked to each other.
  First real check: two browsers (or one browser and `curl`) against a local `wrangler dev`.
- CORS from the deployed origin, real PBKDF2 timing on a phone (200000 iterations runs once on
  Save), and Web Locks behaviour across real tabs.
- The fake is stricter than the contract in one way (it rejects a change whose `data.id` /
  `data.updatedAt` differ from the change's), to catch client mistakes.

## Concerns

1. **Stored token.** The derived token sits in IndexedDB so sync can run by itself; anyone with
   the device's browser data can sync as Esme. Documented on the page and in the README.
2. **Replace restore and sync.** With sync on, Replace no longer means "only what is in the
   file": rows on the server come back on the next sync (by design here, see above). The Backup
   page copy ("Replace removes everything here…") is now only true until the next sync. Copy
   change is Esme's call.
3. **Invalid rows from the server are skipped silently** (the cursor moves past them). If a
   newer app version adds, say, a new area id, an older device would not show those rows until
   it is updated and re-pulls (cursor reset). A version field or a "skipped" notice may be wanted.
4. **Clock trust.** Last-write-wins uses device clocks. A device whose clock runs fast wins
   conflicts it should lose (up to 23 h ahead is accepted by the client rule).
5. **Art direction placeholders.** The Sync link sits in the sidebar footer after Backup,
   separated by a plain space (no new CSS), and the page reuses the Backup page's classes
   (`form-field`, `form-label`, `form-actions`, `btn-secondary`). Placement, spacing and the
   page's composition were not chosen by Esme and need her review. "Last synced" uses the
   browser's locale time format.
6. **Status line text** ("Syncing.", "Not synced yet.", "Sync is off on this device.", the error
   sentences in `engine.ts`) is plain copy written to be calm; Esme may want to reword it.
