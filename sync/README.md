# Esmeworld sync server

A small Cloudflare Worker + D1 database that lets every Esmeworld device (Mac app,
iPhone, browsers) keep a full local copy of `items` and `goals` and meet in one place.
One shared passphrase, per-row last-write-wins, nothing ever hard-deleted, free tier only.

The binding contract (v1.1) is [`docs/superpowers/specs/2026-10-28-sync-api.md`](../docs/superpowers/specs/2026-10-28-sync-api.md),
including the **client obligations** the app must follow. `BUILD-REPORT.md` explains the design
decisions, the security-review fixes and what has not been verified.

## Endpoints

- `GET /v1/health` (no auth): `200 {"ok":true,"version":1}`.
  Use it to check the Worker is up.
- `POST /v1/sync` (Bearer token, JSON): uploads changed rows (last write wins per row) and returns rows changed
  elsewhere since `cursor` (500 rows / 1 MiB of data per page, `hasMore`), plus the stored winner for any of
  the caller's changes that lost. `409 cursor_ahead` means the client must reset its cursor to 0.
- `GET /v1/export` (Bearer token): `{"exportedAt":…,"items":[…],"goals":[…]}` with every current row's data.
  Used for the nightly backup on the Mac.
- `GET /v1/pinterest-board?board=<user>/<board>` (Bearer token): the pins of a public Pinterest board, for the
  app's Vision board page, as `{"board":…,"fetchedAt":<ms>,"pins":[{"img":"https://i.pinimg.com/736x/…","link":"https://www.pinterest.com/pin/…"}]}`.
  The Worker reads `https://www.pinterest.com/<user>/<board>.rss` (no login; Pinterest's feed holds roughly the
  25 most recent pins) because browsers cannot (no CORS). It needs the sync token, so it is not an open proxy,
  and wrong tokens count toward the same rate limit as sync. `board` must match
  `^[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_-]{1,100}$` (`400 bad_board`). Upstream: 5 s timeout, at most 2 MB, redirects
  not followed; any failure is `502 pinterest_unavailable`. Only `https://i.pinimg.com/` images and
  `https://www.pinterest.com/` / `https://pinterest.com/` links are returned; anything else in the feed is dropped.
  Parsed boards are kept in the edge cache (Cache API) for 15 minutes. Caveat: Cloudflare does not keep Cache API
  entries for Workers served on `*.workers.dev`, so there every call reaches Pinterest; the app itself only asks
  when its own copy is older than 15 minutes or on "Refresh".

Errors are always `{"error":"<code>"}`. Every response carries `Cache-Control: no-store`.

Client limits:
- At most 500 changes and about 1 MB per request. The hard server caps are 2000 changes and 5 MiB,
  but small requests stay well inside the free plan's CPU budget.
- Every row's `data` must itself carry `id` and `updatedAt`. The export contains only `data`, so a
  restore needs them.

### Export caveats

- **A cut-off export still has status 200.** The status line is sent before streaming starts. The backup
  writer must parse the WHOLE body as JSON before replacing the previous backup file, and keep the old file
  if parsing fails.
- **About 49,000 rows at most.** The export reads 1000 rows per D1 query, and the free plan allows about
  50 D1 queries per request (one is used by the auth check). Beyond that the stream fails part-way, and the
  backup writer detects it as above. Paginating the export would be the fix if the data ever grows that large.

### Observability

`wrangler.jsonc` sets observability explicitly:
- Workers Logs are on, but only for our own log line (a fixed failure code).
- Invocation logs and traces are off: they record per-request metadata, and there is no switch to exclude
  request headers such as `Authorization` from them.
- Query strings are redacted.

`wrangler tail` still works for live debugging. Treat its output as sensitive.

## Layout

```
src/index.ts      router, auth pipeline, response headers
src/auth.ts       SHA-256 hex, constant-time compare, Bearer parsing
src/ratelimit.ts  failed-auth limits (per IPv4 / IPv6 /64 bucket, global cap) in D1 table auth_failures
src/cors.ts       exact-origin allow list
src/http.ts       limits, JSON/error helpers, capped body reading
src/sync.ts       validation, last-write-wins upserts, the paginated pull, returned winners
src/export.ts     streamed export
src/pinterest.ts  public Pinterest board feed -> pins (fetch, parse, filter, edge cache)
shared/token.ts   passphrase -> token -> hash (NFC, WebCrypto only; reusable by the client)
tools/set-passphrase.mjs   sets the SYNC_TOKEN_HASH secret (hidden input)
migrations/0001_init.sql   D1 schema
```

## Tests

```sh
cd sync
npm ci
npm test            # vitest: Worker tests run in workerd/Miniflare with a real local D1
npm run typecheck   # tsc for the Worker code and for the Node-side code
```

Everything runs locally; no Cloudflare account is needed and nothing is contacted.

## Deploy steps (for later, with Esme present; the build agent never deploys)

Hard-won rules:

- **Never use the repo-root `wrangler.jsonc`.** It belongs to the legacy WhatsApp worker.
- Wrangler walks UP the directory tree to find a config when none is given, so a command run in
  the wrong place can silently target the legacy worker. **Always pass `--config` with the absolute
  path to `sync/wrangler.jsonc`**, and run wrangler from an empty directory.
- Use the wrangler installed in `sync/node_modules` (pinned version), not a bare `npx wrangler`
  from another directory (that would download an unpinned copy).

```sh
SYNC=/absolute/path/to/life-planner/sync      # adjust
WRANGLER="$SYNC/node_modules/.bin/wrangler"
CONFIG="$SYNC/wrangler.jsonc"
cd "$SYNC" && npm ci
cd "$(mktemp -d)"                              # an empty directory: nothing to pick up

"$WRANGLER" login                               # once, if not logged in

# 1. Create the database. If wrangler offers to add the binding to a config file for you,
#    answer NO, then paste the printed database_id into sync/wrangler.jsonc BY HAND, replacing the
#    00000000-… placeholder, and commit it (the id is not a secret).
"$WRANGLER" d1 create esmeworld-sync --config "$CONFIG"

# 2. Apply the schema to the real (remote) database.
"$WRANGLER" d1 migrations apply esmeworld-sync --remote --config "$CONFIG"

# 3. Deploy the Worker (it fails closed with 500 until the secret exists).
"$WRANGLER" deploy --config "$CONFIG"

# 4. Set a THROWAWAY smoke-test passphrase first (see the smoke test below). Hidden input, typed twice.
node "$SYNC/tools/set-passphrase.mjs"
```

### Post-deploy smoke test (with the throwaway passphrase), then reset

The helper never prints the token. For the smoke test only, derive the throwaway token yourself.
Never do this with the real passphrase.

```sh
URL=https://esmeworld-sync.<your-subdomain>.workers.dev
TOKEN=$(node -e "import('$SYNC/shared/token.ts').then(async m => console.log(await m.deriveToken('<throwaway passphrase>')))")
```

1. **Health:** `curl -sS $URL/v1/health` returns `{"ok":true,"version":1}` with `Cache-Control: no-store`.
2. **401:** `curl -sS -i $URL/v1/export` (no token) returns `401 {"error":"unauthorized"}`.
3. **Lockout:** step 2's tokenless request already counts as one failure, so from the same network
   four more requests with a wrong token return 401, and the next one (even with `$TOKEN`) returns
   `429` with `Retry-After`. Your own IP is then locked for 15 minutes; the reset in step 9 clears it.
4. **Bulk write:** POST 2000 small rows in one request (`deviceId` like `smoke-test-1`, `cursor` 0).
   Expect `applied: 2000`.
5. **Large body:** POST a body of about 4 MB (a few rows with big `data`). Expect 200, not a CPU-limit
   error (Cloudflare error 1102).
6. **Pull:** POST `{"deviceId":"smoke-test-2","cursor":0,"changes":[]}` and follow `cursor` while
   `hasMore`. Every row must arrive exactly once.
7. **Export:** `curl -sS -H "Authorization: Bearer $TOKEN" $URL/v1/export | node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))"`
   must parse.
8. **CPU:** while doing steps 4 to 7, watch `"$WRANGLER" tail esmeworld-sync --config "$CONFIG"` for CPU
   time and exceeded-limit outcomes.
9. **Reset** all smoke-test data and the counter, so real devices start clean:
   ```sh
   "$WRANGLER" d1 execute esmeworld-sync --remote --config "$CONFIG" \
     --command "DELETE FROM rows; DELETE FROM auth_failures; UPDATE meta SET value = 0 WHERE key = 'seq';"
   ```
10. **Real passphrase:** Esme runs `node "$SYNC/tools/set-passphrase.mjs"` again with the real
    passphrase. Nothing is printed but "Secret set.".
    - Optional rehearsal that touches nothing: add `--dry-run`; it prints only the hash length, 64.
    - Then `unset TOKEN`.

To change the passphrase later, run the helper again; every device then needs the new passphrase.
