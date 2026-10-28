# Sync client: build report

Branch `sync-client` (based on `origin/worktree-hub-design-spec`). Built against the sync
contract (`docs/superpowers/specs/2026-10-28-sync-api.md` in the server worktree), which was
updated to **v1.1** while this was being built; the client follows the v1.1 file (sections B,
C, D, E, F), and is tested against an in-memory fake of it AND, since fix round 1, against the
real server code run locally (`npm run e2e:sync`, see below). It has never talked to the
deployed Worker.

Fix round 1 (after `sync-client-review.md`: 0 Critical, 5 Important, 11 Minor) is summarised in
its own section at the end; the sections above it describe the code as it is now.

## What was built

| Piece | File |
| --- | --- |
| Token derivation (copy of the server's `sync/shared/token.ts`, plus NFC) | `src/sync/token.ts` |
| Dexie v2: `updatedAt` on items/goals, `pending`, `syncMeta`; migration. v3: `quarantine` | `src/data/db.ts` |
| Row validators shared by backup, sync and every local write | `src/data/validate.ts` |
| Sync gate (Replace off, Merge/imports wait for first pull) and the shared sync lock | `src/data/syncGate.ts` |
| Stamping + pending on every local write | `src/data/changeTracking.ts` |
| Sync engine (`syncOnce`) and settings helpers | `src/sync/engine.ts` |
| Scheduler and UI state | `src/sync/controller.ts`, `src/sync/index.ts` (`syncController`, `useSyncState`) |
| Sync page, sidebar link, shell wiring | `src/ui/SyncPage.tsx`, `src/ui/Sidebar.tsx`, `src/ui/AppShell.tsx`, `src/App.tsx` |
| Test-only fake server | `src/sync/fakeServer.ts` |
| "Updated in another tab, reload" notice | `src/ui/DbClosedNotice.tsx` |
| Opt-in check against the real server (wrangler dev --local) | `e2e-sync/`, `playwright.sync.config.ts` |

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
  each row explicitly from its own dates (below).
- **Stamps for rows that were not just edited (fix round, I1/I2).** Rows that existed before
  sync get the latest of their own `touchedAt` / `updatedAt` / `createdAt` (else 1), never "now".
  Rows ADDED by a restore (Merge or Replace) or an in-app importer keep the file row's own
  `updatedAt`, else its `createdAt`, else 1 (`keepOwnStamps()` marks the transaction). So a
  late-upgrading or late-importing device can never beat edits other devices made meanwhile.
  Ordinary edits through the repo still get `max(now, previous + 1)`.
- **Every local write is validated (I5).** The middleware runs `validItem` / `validGoal` on each
  tracked write and throws on an invalid row, so nothing another device would refuse is ever
  stored or sent. Server applies and the migration are not checked there (server rows are
  validated or quarantined by the engine; old rows are kept exactly as they were).
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
- **Rows from the server are validated**; one that fails goes to the `quarantine` table (raw
  row, reason, and the response cursor it came with, since rows carry no seq on the wire) instead
  of being dropped. Every run re-validates quarantined rows first and applies those that now pass
  (e.g. after an app update) by the usual rules; a readable newer version clears the entry. The
  Sync page shows "N items from another device couldn't be read yet".
- **Replace is off while sync is on; Merge and imports wait for the first full pull (I2/I3).**
  "Sync on" = a token stored, or one refused and waiting for the passphrase. `firstPullDone` is
  set when a run drains (`hasMore` false) and cleared whenever the cursor is reset. Enforced in
  the data layer (`restoreBackup`, `importBacklog`, `importGoogleTasks` throw) and in the UI
  (buttons disabled with a one-line reason). Replace with sync OFF still resets the cursor so
  removed rows come back if sync is later turned on.
- **Restores take the sync lock.** `restoreBackup` runs under the same Web Lock name as a sync run
  (`esmeworld-sync:<db name>`), so no run is in flight while a restore writes.
- **A new sync address starts over (I4)**, as does a 409: cursor 0, `lastSyncedAt` and
  `firstPullDone` cleared, every local row pending again (stamps unchanged). Addresses are
  compared trimmed and without trailing slashes; re-saving the same address keeps the cursor.
- **One sync at a time across tabs** via the Web Locks API where available (in-tab
  single-flight always).
- **401 clears the stored token** and sets `needsPassphrase`, so nothing (not even a reload)
  retries automatically, but only if the stored token is still the one that run used (a token
  version is bumped on every save), so a passphrase saved during a run is never deleted (M3).
- **One refused change never blocks sync (M1).** A 400 `bad_change` (after the one restamp
  retry) or `row_too_large` splits the batch in halves until each refused change is alone; that
  change is kept locally, marked `stuck` on its pending entry, not sent again until it is edited,
  and counted on the Sync page. Rows are also measured the server's way
  (`{t,i,u,d: JSON text of data}`, at most 1,000,000 bytes) and held back before sending.
- **At most 200 request rounds per run (M7)**, then a calm "stopped before it finished" error.

## How each contract rule is enforced

| Rule | Where | Test |
| --- | --- | --- |
| Token = hex(PBKDF2-SHA256(UTF-8(NFC(passphrase)), "esmeworld-sync-v1", 200000, 32 B)) | `token.ts` | `token.test.ts`: server's 3 fixed vectors; composed vs decomposed accents give the same token |
| `Authorization: Bearer <token>` | `engine.ts` `run` | "sends the bearer token and a stable random deviceId" |
| Every local edit: `updatedAt = max(now, previous + 1)` | `changeTracking.ts` | "sets updatedAt = max(now, previous + 1), even when the clock goes backwards" |
| Every write path stamps and marks pending | middleware | "repo writes all stamp…", "importBacklog and importGoogleTasks stamp ADDED rows from their own createdAt…", "restoreBackup stamps ADDED rows with the file's updatedAt…" |
| Remote applies do not | `applyUntracked` | "writes made while applying server changes are not stamped and not pending" |
| v1 -> v2 keeps every row, stamps it from its own dates, marks it pending | `db.ts` upgrade | "keeps every existing row, stamps it from its own dates (never now)…" (fake-indexeddb), e2e `sync-migration.spec.ts` (real Chrome), `twoDevices.test.ts`, and e2e:sync device C |
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
| 409 `cursor_ahead`: cursor 0, re-send every local row | `resetForCursorAhead` -> `startOver` | "409 cursor_ahead resets the cursor to 0 and re-sends every local row unchanged" |
| 400 `bad_change`: re-stamp pending > 23 h ahead to now, retry once | `restampFarFuture` | "400 bad_change re-stamps…", "400 bad_change twice for a lone change: it is held back as stuck…" |
| 413 / others shown calmly | `run` | "other server errors are shown calmly…" |
| Offline keeps everything | `run` (fetch throwing -> `offline`) | "offline: a failed fetch keeps everything pending and loses nothing" |
| Scheduler: start, online, visible, debounce `SYNC_DEBOUNCE_MS = 2000`, interval `SYNC_INTERVAL_MS = 60000` while visible, single flight, nothing without token/address | `controller.ts` | `controller.test.ts` (8 tests, hand-driven timers) |
| Passphrase never stored | `SyncPage.tsx` | "saves only the derived token…" scans every object store of every IndexedDB database plus local/session storage for the passphrase |

## Test counts (all run in this worktree, after fix round 1)

- `npx vitest run`: **623 passed** (44 files). That is 464 from before sync, 66 that arrived with
  the merge of `origin/worktree-hub-design-spec`, 61 from the first sync round, and 32 added in
  fix round 1.
- `npx tsc --noEmit`: clean.
- `npm run build`: succeeds.
- `npx playwright test`: **12 passed, 5 skipped** (5 skipped = the existing phone-width `fixme`s).
  Run as `E2E_DEV_PORT=5183 E2E_PREVIEW_PORT=4183 npx playwright test`, because another
  checkout's dev server holds 127.0.0.1:5173.
- `npm run e2e:sync` (opt-in, real server code): **1 passed**, run 3 times in a row clean after
  fixing one test-side race (see below).
- `sync/` server suite after the merge (`cd ../sync && npx vitest run`): 202 passed (not changed here).

Test-first notes: token, change-tracking, controller and Sync page tests were run against stubs
and failed on their assertions before the code was written. The first engine tests failed
because `syncOnce` did not exist yet (an empty module), not on individual assertions; the key
engine rules were then mutation-checked instead (removing the waiting-change rule, the
version-checked pending clear, or the stale-copy rule each makes a named test fail), and the
v1.1 F.3 change was written test-first.

Existing tests that compared a stored row with the object written now compare it without the
stamp (`src/test/unstamped.ts`); the backup round-trip tests do the same.

## Checked against the real server code (opt-in `npm run e2e:sync`)

`e2e-sync/server.mjs` makes an empty temp directory, writes a `.dev.vars` there holding only the
SHA-256 hash of a throwaway token derived from an obviously fake passphrase, applies the D1
migrations to a local D1 in that directory, and starts `wrangler dev --local --config
<abs>/sync/wrangler.jsonc --persist-to <tmp> --env-file <tmp>/.dev.vars` from that directory
(never the repo-root `wrangler.jsonc`; never `deploy`). CORS: the server allows
`http://127.0.0.1:4173`, so the app's production build is served there. Three browser contexts
act as three devices:

1. A joins sync, Merges a fictional 5-task, 1-goal backup and syncs.
2. B adds two Inbox items, joins; both devices hold the same 7 tasks and 1 goal, no duplicates.
3. B ticks an imported task; it reaches A.
4. C starts with a v1 database holding an OLD copy of that task, upgrades and joins: the newer
   edit wins on C, and A and B stay unchanged (no revert).
5. Two tabs of A press Sync now together: both sync, never at the same time (Web Locks in real
   Chrome; requests watched with a route).

The one failure seen while writing it was in the test (it navigated away before the second
Inbox add had been saved); it now waits for both rows first.

Still not verified: the deployed Worker and its real origin, PBKDF2 timing on a phone (runs
once on Save), and the iPhone PWA.
- The fake is stricter than the contract in one way (it rejects a change whose `data.id` /
  `data.updatedAt` differ from the change's), to catch client mistakes.

## Concerns

1. **Stored token.** The derived token sits in IndexedDB so sync can run by itself; anyone with
   the device's browser data can sync as Esme. Documented on the page and in the README.
2. **Placeholder copy to review.** "Waiting for the first sync to finish.", "Replace is off while
   sync is on. Merge still works.", the lockout line ("After several wrong passphrases…"), the
   stuck and quarantine counts, and "Esmeworld was updated. Reload to keep going." are plain
   placeholder wording; Esme may reword them. The Replace copy on the Backup page is unchanged
   and still true when sync is off.
3. **A quarantined row can still be edited locally** (the review suggested blocking that; the
   ruling did not ask for it). An edit gets `now`, so it wins over the quarantined version, which
   is ordinary last-write-wins.
4. **Clock trust.** Last-write-wins uses device clocks. A device whose clock runs fast wins
   conflicts it should lose (up to 23 h ahead is accepted by the client rule).
5. **Art direction placeholders.** The Sync link sits in the sidebar footer after Backup,
   separated by a plain space (no new CSS), and the page reuses the Backup page's classes
   (`form-field`, `form-label`, `form-actions`, `btn-secondary`). Placement, spacing and the
   page's composition were not chosen by Esme and need her review. "Last synced" uses the
   browser's locale time format.
6. **Status line text** ("Syncing.", "Not synced yet.", "Sync is off on this device.", the error
   sentences in `engine.ts`) is plain copy written to be calm; Esme may want to reword it.

## Fix round 1 (review `sync-client-review.md`)

Step 0: merged `origin/worktree-hub-design-spec` (clean; one test needed `unstamped()`).

| Finding | Fix | Tests |
| --- | --- | --- |
| I1 upgrade stamped "now" | latest of the row's own dates, else 1 | migration test; `twoDevices.test.ts` "a device that upgrades from v1 later…"; e2e:sync device C |
| I2 Merge/importers stamped "now" | file row's own `updatedAt`, else `createdAt`, else 1; Merge and imports refused (and disabled, with a line) until the first full pull | change-tracking stamp tests; "Merge of the same file on a device that has not synced yet…"; `syncGate.test.ts`; `syncGateUi.test.tsx` |
| I3 Replace with sync on | refused while sync is on (data layer and UI, with a line); restores take the sync lock | `syncGate.test.ts` (incl. the lock ordering with a fake LockManager); `syncGateUi.test.tsx`; e2e:sync two-tab check |
| I4 address change kept the cursor | new address (or 409) starts over | "changing the sync address starts over…" |
| I5 invalid rows dropped; local writes unchecked | quarantine table (v3) with retry each run and a count on the Sync page; middleware validates every tracked write | `quarantine.test.ts` (4, incl. applied after an "update"); local validation tests incl. the 4000-character goal-notes cap via `itemToGoal` |
| M1 one poison change blocked all sync | bisect, mark stuck, carry on; server-way row measure | 4 engine tests |
| M2 | covered by I3 | |
| M3 Save during a run could lose the new token | token version check before deleting | "a 401 for an OLD token never deletes a token saved…" |
| M4 lockout guidance | one plain line on the Sync page | Sync page test |
| M7 10,000 rounds | 200, then a calm error | "stops after a sane number of rounds…" |
| M8 old tab closed by a newer version | "Esmeworld was updated. Reload to keep going." with Reload (update-prompt markup) | `DbClosedNotice.test.tsx` (real versionchange) |
| M10 missing tests | overlapping ids, Merge on an unsynced device, address change, quarantine and recovery, apply failing part-way, Web Locks across two real tabs (e2e:sync), real-server convergence | as listed |

Existing UI write paths checked against the validator: goal notes via `itemToGoal` are capped
at 4000 (test), Inbox capture and the repo create valid rows, imports go through the validated
middleware, and every existing test still passes with validation on (none writes an invalid
row). Goal why/cadence are only written by the transfer script, whose output is checked by the
same validator when it is restored.

Parked, not fixed (per the ruling): **M5** duplicates from in-app importers on two devices
(random ids; the first-sync gate narrows the window), **M6** per-row last-write-wins (README now
says "the whole task"), **M9** contract gap (a reset server refilled past a device's cursor is
undetectable without a server epoch), **M11** merge notes (information only).

Changed from the first round: `restoreBackup` and the importers now throw
`WAITING_FIRST_SYNC` / `REPLACE_OFF_WHILE_SYNCING` while sync is on; the v2 upgrade function
was edited (not yet shipped to any device); a stuck change replaces the earlier
"held but still pending" behaviour.
