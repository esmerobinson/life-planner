# Sync server build report

Date: 2026-10-28. Contract: `docs/superpowers/specs/2026-10-28-sync-api.md` (copied byte-for-byte
from the hub-design-spec worktree as the first commit).

## What was built

- `sync/` is a self-contained package (private, ESM). The Worker itself has **no runtime dependencies**.
  Dev dependencies (exact versions, all at least about two weeks old): `wrangler@4.150.0`,
  `@cloudflare/vitest-plugin@1.4.1`, `vitest@4.1.12`, `typescript@5.9.3`,
  `@cloudflare/workers-types@5.20261028.1` and `@types/node@24.19.2`.
- `wrangler.jsonc`: name `esmeworld-sync`, `main: src/index.ts`, `compatibility_date: 2026-10-01`,
  one D1 binding `DB` with a placeholder database id (all zeros). It has no triggers, KV or routes.
- `migrations/0001_init.sql`: `rows` (PK `(tbl,id)`, index on `seq`), `meta` (seeded `seq = 0`),
  `auth_failures(ip, ts)` with an index on `ts` and an extra index on `(ip, ts)` for the per-IP query.
- `src/`: `index.ts` (router and auth pipeline), `auth.ts`, `ratelimit.ts`, `cors.ts`, `http.ts`, `sync.ts`,
  `export.ts`, `env.ts`.
- `shared/token.ts`: `deriveToken` / `hashToken`, which use WebCrypto only.
- `tools/set-passphrase.mjs`: a dependency-free helper with hidden input. It has a `--dry-run` mode.
- `README.md`: the endpoints, how to run the tests and the deploy steps for later.

## Test results

- `npm test` runs 173 tests in 8 files, and all pass:
  - **worker project** (workerd via Miniflare, real local D1): 145 tests in 5 files (auth/rate limit, http/CORS/routing, sync, export, token-in-workerd).
  - **node project**: 28 tests in 3 files (token vectors against Node crypto, the passphrase helper, a grep for logging).
- `npx tsc --noEmit` (Worker code and Worker tests) passes with 0 errors. `npx tsc --noEmit -p tsconfig.node.json`
  (vitest config, helper script with checkJs, Node tests) also passes with 0 errors. `npm run typecheck` runs both.
- The tests were written first and committed while failing on their assertions against stubs (139 of 155 failed;
  the ones that passed were the already-implemented token tests and assertions that a stub trivially meets).
  Mutation check: running the statements one by one instead of as one `db.batch` makes the
  multi-statement atomicity test fail, as intended.
- `wrangler deploy --dry-run --outdir /tmp/esmeworld-sync-dryrun --config <abs>/sync/wrangler.jsonc` worked
  offline with no login and produced a 16.5 KiB bundle. It ran with `WRANGLER_SEND_METRICS=false`, and
  wrangler's code skips the telemetry POST when that is set. Wrangler did print its telemetry
  banner, which is driven by the user's global config file.

**Miniflare D1 was used, not the fallback.** `@cloudflare/vitest-pool-workers` installs, but it is deprecated and
renamed to `@cloudflare/vitest-plugin`, so the renamed package is used. It works with Node 26 and vitest 4.
Every test starts from `reset()` followed by the real migrations (`applyD1Migrations`). No better-sqlite3 adapter exists.

## Design decisions

**Request pipeline.** The router runs in this order: route lookup (404), OPTIONS preflight (204), method (405
with `Allow`), auth, then body and validation. Auth comes before any body parsing, so unauthenticated
callers cannot make the server parse 5 MB. Every response gets `Cache-Control: no-store`,
`X-Content-Type-Options: nosniff` and `Vary: Origin`. The only logging is
`console.error("sync_worker_failure", error.name)` on unexpected errors. It never logs headers, bodies or messages.

**Auth.** The secret is trimmed and lowercased, and must be 64 hex characters. If it is missing or malformed,
every authenticated request gets `500 server_misconfigured` (fails closed, no failure recorded).
The presented `Bearer` token (strict regex, at most 256 chars) is SHA-256 hashed, even when the header is
absent, and compared to the secret with a no-early-exit XOR loop.

**Rate limiting (D1 `auth_failures`).**
- Order: per-IP check first, so a locked IP gets 429 even with the correct token.
- If the token is correct, the request proceeds.
- If the token is wrong or missing, the global cap is checked (429 if reached). Otherwise the failure is
  recorded and the server answers 401.
- The IP comes from `CF-Connecting-IP`. If the header is absent, all such callers share one `unknown` bucket.
- Each window is checked with one indexed query (`ORDER BY ts DESC LIMIT 1 OFFSET max-1`). The limit
  applies when the max-th most recent failure is inside the window. `Retry-After` is the seconds until
  that failure leaves the window.
- Attempts answered with 429 are **not** recorded. This means a lockout cannot be extended indefinitely,
  and writes stay bounded at about 100/hour under attack.
- Each failure write prunes rows older than one hour in the same batch.
- Only `(ip, ts)` is stored, never the token or its hash.

**Sync atomicity: one D1 `batch()` per request.** D1 runs the batch as a single transaction.
- Changes are serialized as `{"t","i","u","d": JSON text of data}`, grouped into JSON-array chunks of at most
  1.9 MB (D1 caps strings at 2 MB), and bound as **one parameter per chunk**.
- Each chunk is applied with one statement: `INSERT … SELECT FROM json_each(?) ORDER BY key ON CONFLICT DO
  UPDATE … WHERE newer OR (equal AND deviceId greater) RETURNING seq`. SQLite processes the rows in order,
  so duplicate ids inside one request resolve correctly.
- `RETURNING` counts the rows actually written (`applied`); `ignored = changes - applied`.
- A typical request is 3 statements: upsert, counter bump, pull. The worst case is about 2 per 1.9 MB plus 1.
  This keeps the statement count far below D1's per-invocation query limits, whereas one statement per
  change could be 2000+.
- A failure in any statement rolls everything back. Tests check this with a real SQLite trigger that aborts
  mid-statement, and with a failure in a later statement of a multi-statement batch.

**Sequence numbers.** A candidate row gets `seq = meta.seq + 1 + index in chunk`. After each chunk,
`meta.seq = MAX(meta.seq, MAX(rows.seq))`. Seqs are therefore unique and increase monotonically, with gaps
where a change was ignored. A replay that writes nothing leaves `meta` and `rows` byte-identical.

**Pull, cursor and pagination.**
- The pull is the last statement of the same batch, so it sees this request's writes consistently.
- It reads at most 501 candidate rows with `seq > cursor`, ordered by `seq`.
- A window `SUM(length(data))` withholds `data` (NULL) for rows past a 4 MiB budget. The first row is always
  included.
- The server returns up to 500 included rows. `hasMore` is true when any candidate was left out.
- `cursor` is the highest seq returned, or the request cursor if no rows are returned (as the contract says).
- Data is stored as JSON text and spliced verbatim into the response, so it round-trips byte-for-byte
  without being re-parsed.

**Exclusion rule (interpretation).** A row is hidden from the caller when `row.device_id = caller` **and** the
request contains a change with the same `(table, id, updatedAt)`.
- For rows written in this request, that is exactly the contract's rule.
- It also hides the caller's own rows when it *replays* an identical request. Without this, the contract's
  other promise (that a replay "returns the same rows") could not hold, because on replay nothing is
  "written in this request".
- It never hides a row another device wrote, and never hides the caller's rows from earlier requests that it
  is not resending.
- It is implemented in SQL (a materialized `json_each` CTE and a LEFT JOIN), so pagination counts are exact.

**Validation.** A request gets 400 if any of these fail; the whole request is rejected and nothing is applied:
- `deviceId` matches `^[A-Za-z0-9_-]{8,64}$`.
- `cursor` is a non-negative safe integer.
- `changes` is an array of at most 2000 items. Unknown top-level keys are ignored.
- Each change:
  - `table` is `items` or `goals`.
  - `id` is a well-formed string of 1 to 128 UTF-16 units.
  - `updatedAt` is a safe integer greater than 0 and at most server-now + 24 h.
  - `data` is a JSON object, not null or an array.
  - Its serialized D1 entry is at most 1,000,000 bytes (`row_too_large`).

Codes: `bad_json`, `bad_request`, `bad_device_id`, `bad_cursor`, `bad_changes`, `bad_change`,
`too_many_changes`, `row_too_large`. **Body over 5 MiB returns `413 payload_too_large`, not 400.** This is
checked from Content-Length and also enforced while streaming when the header is absent. A Content-Type
that is not JSON returns `415 unsupported_media_type`. Invalid UTF-8 returns `400 bad_json`.

**CORS.**
- Exact matches: `https://life-hub-eoy.pages.dev`, `esmeworld://app`, `http://127.0.0.1:5173` and
  `http://127.0.0.1:4173`.
- Previews: `https://<one lowercase DNS label>.life-hub-eoy.pages.dev`.
- The server echoes the origin, never `*`, and never sends credentials headers.
- Preflight is answered with 204 and Max-Age 600 on known paths only; unknown paths get 404.
- `Access-Control-Expose-Headers: Retry-After` is added so the browser client can read the 429 back-off.
  This is an addition to the contract.

**Export.** The export is a `ReadableStream` that pages with a primary-key keyset: 1000 rows or 4 MiB per
D1 query, whichever comes first. Memory and query count stay small. It is not a single snapshot if a sync
lands mid-export; every row still appears once. Data is spliced verbatim. The 50 MB figure from the
contract is not enforced, because silently truncating a backup would be worse.

**Passphrase helper.**
- It refuses to run without a TTY. It reads in raw mode with no echo and asks twice.
- It requires at least 16 characters (code points) and no leading or trailing spaces.
- It never echoes a rejected command-line argument, because it might be the passphrase.
- It derives the token and hash with duplicated WebCrypto code; tests prove it agrees with `shared/token.ts`.
- It spawns the **locally installed, pinned wrangler** (`node sync/node_modules/wrangler/bin/wrangler.js secret
  put SYNC_TOKEN_HASH --config <abs>`) from an empty `mkdtemp` directory that it removes afterwards, and
  pipes only the hash (no newline) to stdin. It sets `WRANGLER_SEND_METRICS=false`.
- Wrangler's output is shown only on failure, with the hash redacted. On success it prints only "Secret set.".
- Deviation from the brief: it does **not** use bare `npx wrangler`. From an empty temporary directory, npx
  would download an unpinned wrangler and could show an install prompt that reads stdin, which is where the
  hash is piped.

## What could NOT be verified

- **The real Cloudflare runtime and real D1.** All tests run against workerd and Miniflare's local D1
  (SQLite). Untested in production:
  - D1's statement and parameter limits: 2 MB strings, the 100 KB SQL length, and per-invocation query
    limits on the free plan. I believe a batch's statements count individually; this design keeps the
    count small either way.
  - Production SQLite support for `MATERIALIZED` CTEs, window functions, `RETURNING` on upserts and
    `json_each`. All of these are standard in SQLite 3.35 and later, and all work in Miniflare.
  - The real latency of a batch.
- **The free-plan CPU limit (10 ms per request).** Parsing and validating a multi-megabyte body may exceed
  it. Recommendation for the client: upload in batches of a few hundred changes.
- That `CF-Connecting-IP` is always present and trustworthy in production. It is documented as set by
  Cloudflare.
- The interactive hidden prompt and a real `wrangler secret put`. By design, the tests only cover the
  injected prompt and a fake wrangler. Nothing was deployed, created or logged in.

## Security concerns and notes for the client author

1. **Lost-edit risk with clock skew.** The response does not echo back the winner for an *ignored* change
   when that winner's seq is at or below the caller's cursor. The device keeps its local losing version and
   silently diverges. This happens when a device edits a row it has already received, with an `updatedAt`
   not greater than the stored one. **The client should set `updatedAt = max(Date.now(), previous
   updatedAt + 1)` on every local edit.** Alternatively, a future contract revision could have the server
   return current rows for every ignored change.
2. **Own writes come back once.** Because `cursor` is "the highest seq included", a device's own writes from
   request N (hidden then) are returned on request N+1 if nothing newer from others was included. This is
   harmless (identical content) but should be documented for the client. Advancing the cursor past excluded
   rows would avoid it, but that needs a contract change.
3. **A device clock more than 24 h fast** gets every request rejected (`bad_change`) until its clock is fixed.
   The client should surface this.
4. **Same deviceId, same updatedAt, different data:** the second write is ignored, which is the contract's
   tie-break. Clients must never reuse a timestamp for different content.
5. **The rate limit is per IP.**
   - An attacker on IPv6 can rotate addresses inside a /64 to get 5 tries per address. The global cap
     (100 failures/hour) still bounds online guessing.
   - Someone sharing Esme's IP (CGNAT, café wifi) can lock her out for up to 15 minutes. The global cap
     never blocks the correct token.
6. **No Unicode normalization of the passphrase** (per the contract: raw UTF-8). A passphrase with accented
   letters typed on two keyboards that produce different normalization forms would derive different tokens.
   Recommend an ASCII passphrase, or a contract amendment to NFC-normalize in both places.
7. **Dev-only `npm audit` findings** (undici, zod) are in the local test toolchain (miniflare/wrangler), not in
   the deployed Worker, which has no dependencies.
8. Error bodies never echo input. The secret, token and passphrase never appear in the repo; tests use
   `test-passphrase-not-real` and other obviously fake values.
