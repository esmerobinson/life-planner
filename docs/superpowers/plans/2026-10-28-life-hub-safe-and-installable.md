# Life Hub: Safe, Real Data, Installable (Plan 2 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `hub/` app safe to hold Esme's only copy of her tasks (backup, persistence, cross-tab freshness), get her real data in with sensible filing (section-to-area mapping, bulk filing, Google Tasks), prove it with real-browser tests, and make it installable as an offline app.

**Architecture:** Same React + Dexie app. Data safety lives in two new small modules (`data/backup.ts`, `data/storage.ts`). Import gains a section-to-area map. Real-browser behaviour is checked with Playwright driving the system Chrome. Installability is a manifest plus a service worker produced at build time.

**Tech Stack:** existing stack plus `@playwright/test` (using the installed Chrome channel, no browser download) and `vite-plugin-pwa`.

**Spec:** `docs/superpowers/specs/2026-10-27-life-hub-design.md`. Plan 1: `docs/superpowers/plans/2026-10-27-life-hub-foundation.md`. QA findings that motivate this plan come from a no-code tester run on 2026-10-28 plus a direct check of the code.

**Not in this plan:** Cloudflare hosting, sync between devices, access protection (plan 3: needs Esme's `wrangler login`), notifications (4), journal and reviews (5), phone layout design (needs a design round; see Constraints).

## Global Constraints

- Everything from plan 1's Global Constraints still binds: local `"YYYY-MM-DD"` dates never through UTC, `today` passed in, kill = archive, calm never-scolding copy, no emoji, styling only from `VISUAL-LANGUAGE.md` / `tokens.css` with magenta `--placeholder` for anything undecided, no invented colours/sizes/timing/easing (list any chosen value in the report).
- Nothing in this plan may delete or overwrite stored user data without an explicit, typed or checkbox confirmation AND a prior offer to download a backup.
- Real user task text from `~/Desktop/Esme's Brain` must never be committed or printed: fixtures are fictional; real-data checks report counts only.
- **Phone layout is NOT designed here.** Any narrow-screen change that is a composition decision is out of scope; the PWA task only makes the app installable and offline. Report what breaks at 390px instead of redesigning it.
- Use the system Chrome for Playwright (`channel: "chrome"`); do not download browsers.

## Review Focus

1. Restoring a backup never destroys newer data: merge mode only adds ids that are missing; replace mode needs a confirmation and is preceded by an offer to download the current data (Task 1).
2. A corrupted, truncated or foreign JSON file is rejected with a calm message and changes nothing (Task 1).
3. Vite silently picking another port gives an empty app (different origin). The dev and preview servers must fail rather than move port (Task 1).
4. A change in one browser tab must show in another open tab without reload, and neither tab may overwrite the other's newer data (Task 2).
5. Re-importing after the user filed, ticked or archived items must not undo that triage even though imported items now get an area from their section (Task 3).
6. A service worker must never serve stale code in a way that hides a newer build forever, and must not cache the user's data outside IndexedDB (Task 5).

---

### Task 1: Backup, restore, persistence, fixed port

**Files:** Create `hub/src/data/backup.ts`, `hub/src/data/storage.ts`, `hub/src/ui/BackupPage.tsx`; Modify `hub/vite.config.ts` (`server`/`preview`: `host: "127.0.0.1"`, `port: 5173`/`4173`, `strictPort: true`), `hub/src/App.tsx` (route `/backup`), `hub/src/ui/AppShell.tsx` (a "Backup" link next to Inbox), `hub/README.md`; Test `hub/src/data/backup.test.ts`, `hub/src/data/storage.test.ts`, `hub/src/ui/BackupPage.test.tsx`.

**Interfaces:**
- Consumes: `db`, `Item`, `Goal`, `todayISO`.
- Produces: `interface BackupFile { app: "life-hub"; schema: 1; exportedOn: ISODate; items: Item[]; goals: Goal[] }`; `exportBackup(today: ISODate): Promise<BackupFile>`; `restoreBackup(raw: unknown, mode: "merge" | "replace"): Promise<{ addedItems: number; addedGoals: number; skipped: number }>` (throws `Error` with a calm message for anything that is not a valid `BackupFile` of schema 1; validates every row's required fields; runs in one Dexie transaction so a failure changes nothing; `merge` adds only ids not present, never modifies existing rows; `replace` clears then adds, inside the same transaction); `requestPersistence(): Promise<"persisted" | "not-persisted" | "unsupported">` in `storage.ts` (calls `navigator.storage.persist()` when available; never throws); `<BackupPage today />`: a Download button (file name `life-hub-backup-<exportedOn>.json`), a file picker with a Merge / Replace choice, Replace requires a ticked confirmation and shows "Download a backup first" with the download button beside it; a plain line stating "Your tasks are saved in this browser only." and the persistence status; `requestPersistence` is called once on app start from `AppShell`.

- [ ] **Step 1: Write failing tests:** `"export then clear then restore(replace) gives identical items and goals"`; `"merge adds missing ids and never changes an existing row"` (an existing done item stays done though the backup has it open); `"replace needs the confirmation checkbox; without it nothing changes"` (UI); `"invalid JSON, wrong app name, schema 2, a row missing id, and a truncated file are rejected with a calm message and the db is unchanged"`; `"restore failing mid-way leaves the db unchanged"` (inject one invalid row after valid ones); `"requestPersistence returns unsupported when navigator.storage is absent and never throws"`; `"BackupPage shows the saved-in-this-browser-only line"`.
- [ ] **Step 2: Run** `cd hub && npx vitest run src/data/backup.test.ts src/data/storage.test.ts src/ui/BackupPage.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** the three modules, the route, the shell link, the vite server settings, and a README section "Backups" (how to back up, why the address must stay `127.0.0.1:5173`).
- [ ] **Step 4: Run** the focused tests, then the full suite, `npx tsc --noEmit`, `npm run build`. Also run `npm run dev` with port 5173 already occupied and confirm it exits with an error instead of moving port.
- [ ] **Step 5: Commit** `feat(hub): backup and restore, persistent storage request, fixed dev port`.

### Task 2: Cross-tab freshness

**Files:** Modify `hub/src/ui/useHubData.ts`; Test `hub/src/ui/useHubData.test.tsx`.

**Interfaces:** Consumes `Dexie` cross-tab mutation events (`Dexie.on("storagemutated")` / its `liveQuery` machinery). Produces: `useHubData` (unchanged signature) also re-reads when another tab changes the database; no polling.

- [ ] **Step 1: Write failing tests:** `"a write from a second Dexie connection triggers a re-read in the hook"` (open a second `new HubDB()` instance, write an item, assert the first hook's `items` includes it without calling refresh); `"the subscription is removed on unmount"`; `"two rapid external writes produce a final state containing both"`.
- [ ] **Step 2: Run** `npx vitest run src/ui/useHubData.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** the subscription inside the existing effect, funnelled through the existing request-id guarded `refresh`.
- [ ] **Step 4: Run** tests and the full suite.
- [ ] **Step 5: Commit** `feat(hub): refresh data when another tab changes it`.

### Task 3: Import maps sections to areas; bulk filing in Inbox

**Files:** Create `hub/src/import/sectionAreas.ts`; Modify `hub/src/import/backlog.ts`, `hub/src/data/repo.ts`, `hub/src/ui/InboxPage.tsx`; Test `hub/src/import/backlog.test.ts`, `hub/src/data/repo.test.ts`, `hub/src/ui/InboxPage.test.tsx`; Modify the fictional fixture to add sections.

**Interfaces:**
- Produces: `sectionToArea(heading: string): AreaId` in `sectionAreas.ts` (normalise: lowercase, strip emoji/punctuation/leading symbols, trim; table: `writing → writing`, `content → content`, `art → art`, `inner work → mind`, `health → body`; anything else, including `vibecoding`, `production & freelance`, `life admin`, `leisure`, `weekly rhythm`, `inbox`, returns `"inbox"`); `ParsedItem` gains `section: string`; `importBacklog` sets `areaId: sectionToArea(section)` for NEW items only (existing keys remain untouched, so a re-import never re-files anything); `repo.updateItems(ids: string[], patch: Pick<Partial<Item>, "areaId" | "goalId" | "priority" | "due">, today: ISODate): Promise<void>` (one transaction, silent no-op for unknown ids); InboxPage gains a checkbox per row, a "Select all shown" control, and "Move selected to [area]" (area options exclude inbox) calling `updateItems`.
- **Open question for Esme (do not decide in code):** Vibecoding, Production & freelance, Life admin and Leisure have no area yet; they stay in Inbox until she says whether to add areas. Record this in the report and README.

- [ ] **Step 1: Write failing tests:** `sectionToArea` table cases including emoji-prefixed headings (`"📖 Writing"`, `"🌱 Inner work"`), unknown headings, empty string; `"imported items under Writing land in the writing area and under Life admin in inbox"`; `"re-import after filing one item elsewhere does not move it back"`; `"re-import after ticking and archiving leaves both untouched"` (regression of plan 1); `"updateItems changes all given ids in one transaction and ignores unknown ids"`; `"Move selected files five items to Art and they leave the inbox"`; `"select all shown then move empties the inbox"`.
- [ ] **Step 2: Run** `npx vitest run src/import src/data/repo.test.ts src/ui/InboxPage.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run** the tests and the full suite. Real-data check, counts only and read-only: parse the real `Backlog.md` and report how many items map to each area and how many stay in inbox (no titles).
- [ ] **Step 5: Commit** `feat(hub): section-to-area mapping on import and bulk filing in Inbox`.

### Task 4: Real-browser end-to-end tests

**Files:** Create `hub/playwright.config.ts` (`channel: "chrome"`, `webServer: npm run dev`, base URL `http://127.0.0.1:5173`), `hub/e2e/core.spec.ts`, `hub/e2e/two-tabs.spec.ts`, `hub/e2e/phone.spec.ts`; Modify `hub/package.json` (`"e2e": "playwright test"`, dev dependency `@playwright/test`), `hub/README.md`.

**Interfaces:** consumes the running app; produces specs only.

- [ ] **Step 1: Write the specs** (they exercise the real built UI, so they are the failing-first tests of this task): `core`: first run shows calm empty states on Home, Today, Goals, Inbox; paste a fictional 5-line backlog and import (`Added 5`), import again (`already had 5`); file one item; tick it and see the celebration placeholder then a Done entry with Undo; move an overdue item to Tomorrow and see it leave Today; reload and see everything persisted; download a backup, clear IndexedDB, restore it, see the same state. `two-tabs`: open two pages in one browser context; add an item in page A and see it in page B without reload (Task 2); tick in B and see A update. `phone`: at 390x844, assert `document.documentElement.scrollWidth <= window.innerWidth` on Home, Today, Goals, Inbox; this is EXPECTED TO FAIL today because the sidebar is a fixed 220px: mark with `test.fixme` and a comment, and record the measured overflow per page in the report (this is the evidence for the later phone design round, not a bug to fix here).
- [ ] **Step 2: Run** `cd hub && npx playwright test` — Expected: `core` and `two-tabs` PASS (after Tasks 1-3), `phone` reported as fixme with measurements.
- [ ] **Step 3: Triage failures:** any real bug found is fixed with a failing unit test first, in this task's commit or a follow-up commit, and listed in the report.
- [ ] **Step 4: Run** the unit suite, `tsc`, build once more.
- [ ] **Step 5: Commit** `test(hub): real-browser end-to-end tests`.

### Task 5: Installable offline app

**Files:** Modify `hub/vite.config.ts` (add `vite-plugin-pwa`: `registerType: "prompt"`, precache of the built assets only, manifest `name: "Life Hub"`, `short_name: "Life Hub"`, `start_url: "/"`, `display: "standalone"`, `background_color` and `theme_color` NOT set to invented values: omit them), `hub/index.html` (`<link rel="manifest">` handled by the plugin; `theme-color` meta omitted), `hub/public/icons/icon-192.png` and `icon-512.png` (solid magenta `#ff00ff` squares generated by a small script; they are placeholders for the app icon Esme will choose), `hub/src/ui/UpdatePrompt.tsx` (a plain "A new version is ready. Reload." button using the plugin's register hook), `hub/README.md` (how to install on Mac Chrome and on a phone once hosted; note a phone needs a hosted HTTPS address from plan 3); Test `hub/src/pwa.test.ts` (reads the built `dist/manifest.webmanifest` and `dist/sw.js` after a build), plus an e2e check in `hub/e2e/core.spec.ts` that the page offers a manifest link and registers a service worker.

**Interfaces:** consumes the build; produces `dist/manifest.webmanifest`, `dist/sw.js`.

- [ ] **Step 1: Write failing tests:** the manifest parses as JSON with `name`, `short_name`, `display: "standalone"`, `start_url`, and icons of 192 and 512; `sw.js` exists; the precache list contains the main JS and CSS but no entry that matches `/\.json$|indexeddb|backup/i`; the manifest has no `theme_color`/`background_color` (no invented colours); an update prompt component renders the reload button when the hook reports a waiting worker.
- [ ] **Step 2: Run** after `npm run build`: `npx vitest run src/pwa.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the plugin config, icons script, prompt component, and mount the prompt in `AppShell`. The service worker must only precache static build assets; user data is never cached by it.
- [ ] **Step 4: Run** the full suite, `npm run build`, `npm run preview` (port 4173, strict) and check with Playwright that the app loads offline after first visit (`context.setOffline(true)` then reload).
- [ ] **Step 5: Commit** `feat(hub): installable offline app (manifest, service worker, placeholder icons)`.

### Task 6: Google Tasks import

**Files:** Create `hub/src/import/googleTasks.ts`, `hub/src/import/__fixtures__/googleTasks.json` (fictional); Modify `hub/src/ui/ImportPanel.tsx` (a second paste/file input "Google Tasks (JSON)"); Test `hub/src/import/googleTasks.test.ts`, `hub/src/ui/ImportPanel.test.tsx`.

**Interfaces:**
- Consumes: `Item`, `db`, `isValidISODate`.
- Produces: `parseGoogleTasks(raw: unknown): { items: ParsedGoogleTask[]; notes: { line: string; reason: string }[] }` where input is the shape `{ lists: { id: string; title: string; tasks: { id: string; title: string; notes?: string; due?: string; status: "needsAction" | "completed" }[] }[] }`; `due` is an RFC 3339 string whose DATE PART (first 10 chars) is used as-is, never converted through a timezone; only `needsAction` tasks are imported; `importGoogleTasks(raw: unknown, today: ISODate): Promise<{ added: number; alreadyHad: number; skipped: number; notes: { line: string; reason: string }[] }>` creating items in inbox with `source: { kind: "gtasks", key: "gtasks:" + task.id }` (extend `Item["source"]["kind"]` to include `"gtasks"`), `notes` from the task notes field, list title as a tag; idempotent exactly like `importBacklog` (existing keys untouched in any status), single transaction, malformed rows reported never thrown.

- [ ] **Step 1: Write failing tests:** `"parses needsAction tasks, ignores completed"`; `"due keeps its date part even when the time is late evening UTC"` (e.g. `"2026-11-01T23:30:00.000Z"` stays `"2026-11-01"`); `"importing twice adds nothing the second time"`; `"re-import does not reopen a task ticked in the app"`; `"malformed rows (missing id, empty title, bad due) are reported, not thrown"`; `"list title becomes a tag and notes are kept"`; UI: pasting the fixture shows `Added N, already had M, notes K`.
- [ ] **Step 2: Run** `npx vitest run src/import/googleTasks.test.ts src/ui/ImportPanel.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** the parser, importer and UI input.
- [ ] **Step 4: Run** tests and the full suite. Do NOT fetch Esme's real Google Tasks in this task: producing her export file is a separate step the controller does only after she confirms.
- [ ] **Step 5: Commit** `feat(hub): Google Tasks JSON import`.

---

## Self-review notes

- **Spec coverage:** backup and "core notes backed up elsewhere" (Task 1, first half; off-site and automatic copies arrive with plan 3), fast capture and nothing lost (Tasks 1-3), data-in from Obsidian Backlog and Google Tasks with manual triage made bearable (Tasks 3, 6), phone and Mac app (Task 5, phone hosting in plan 3), bug hunting (Task 4). Not covered here on purpose: Notes-app paste (plain text through the existing Backlog import box covers it; a dedicated importer if she wants it), Obsidian Goals.md import, phone layout design, hosting, sync.
- **Known risk carried forward:** the app stays on one browser's storage until plan 3; Task 1 makes that survivable, not safe forever.
